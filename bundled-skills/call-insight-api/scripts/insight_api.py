#!/usr/bin/env python3
"""Discover models and invoke Insight via the authenticated enterprise JS proxy."""

from __future__ import annotations

import argparse
import copy
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.request import Request, urlopen


from enterprise_proxy import request as enterprise_request

CONNECTION = "call-insight-api"
DEFAULT_ENDPOINT = "/v1/proxy"
DEFAULT_CATALOG_URL = (
    "https://game-ai-admin-test.oss-cn-guangzhou.aliyuncs.com/"
    "model_node_setting/model_params_with_mode.json"
)
ASYNC_TASK_TYPES = {
    "text_to_video": (
        "async_text_to_video_create",
        "async_text_to_video_get_result",
    ),
    "image_to_video": (
        "async_image_to_video_create",
        "async_image_to_video_get_result",
    ),
    "reference_image_to_video": (
        "async_reference_image_to_video_create",
        "async_reference_image_to_video_get_result",
    ),
    "first_last_frame_to_video": (
        "async_first_last_frame_to_video_create",
        "async_first_last_frame_to_video_get_result",
    ),
}
# API Manager capabilities confirmed by the service owner but not yet exposed by
# the live model catalog. Merge these with catalog-declared task types so the
# compatibility entry can be removed once the catalog catches up.
CONFIRMED_TASK_TYPES_BY_MODEL = {
    "gemini-2.5-flash": ("audio_parsing", "video_parsing"),
}
CATALOG_PATH = (
    Path(__file__).resolve().parent.parent / "references" / "model_params.json"
)


@dataclass(frozen=True)
class ModelEntry:
    modality: str
    task_type: str
    model_key: str
    canonical_model_id: str
    spec: Dict[str, Any]


def is_insight_model(entry: ModelEntry) -> bool:
    identifiers = (
        entry.model_key,
        entry.canonical_model_id,
        str(entry.spec.get("model_name", "")),
    )
    return any(value.lower().startswith("insight") for value in identifiers)


def validate_catalog(catalog: Any) -> Dict[str, Any]:
    if not isinstance(catalog, dict):
        raise ValueError("Model catalog must be a JSON object")
    for modality in ("text", "image", "video", "audio"):
        if not isinstance(catalog.get(modality), dict):
            raise ValueError(f"Model catalog is missing the {modality!r} object")
    return catalog


def load_catalog() -> Dict[str, Any]:
    catalog_url = os.environ.get(
        "INSIGHT_MODEL_CATALOG_URL", DEFAULT_CATALOG_URL
    ).strip()
    timeout = float(os.environ.get("INSIGHT_MODEL_CATALOG_TIMEOUT", "15"))
    if not catalog_url:
        raise ValueError("INSIGHT_MODEL_CATALOG_URL must not be empty")
    if timeout <= 0:
        raise ValueError("INSIGHT_MODEL_CATALOG_TIMEOUT must be positive")
    request = Request(catalog_url, headers={"User-Agent": "call-insight-api/1.0"})
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8-sig")
        catalog = validate_catalog(json.loads(raw))
        print(
            json.dumps(
                {"event": "catalog_loaded", "source": catalog_url},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return catalog
    except (OSError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        print(
            json.dumps(
                {
                    "event": "catalog_fallback",
                    "source": str(CATALOG_PATH),
                    "reason": str(exc),
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        with CATALOG_PATH.open("r", encoding="utf-8") as handle:
            return validate_catalog(json.load(handle))


def text_task_types(model_key: str, spec: Dict[str, Any]) -> List[str]:
    task_types = ["text_chat"]
    declared = spec.get("supported_task_types") or []
    if isinstance(declared, list):
        task_types.extend(
            item.strip() for item in declared if isinstance(item, str) and item.strip()
        )

    identifiers = {
        model_key.lower(),
        str(spec.get("canonical_model_id", model_key)).lower(),
    }
    for identifier in identifiers:
        task_types.extend(CONFIRMED_TASK_TYPES_BY_MODEL.get(identifier, ()))

    return list(dict.fromkeys(task_types))


def iter_models(catalog: Dict[str, Any]) -> Iterable[ModelEntry]:
    for modality, group in catalog.items():
        if modality == "text":
            for model_key, spec in group.items():
                for task_type in text_task_types(model_key, spec):
                    yield ModelEntry(
                        modality=modality,
                        task_type=task_type,
                        model_key=model_key,
                        canonical_model_id=spec.get("canonical_model_id", model_key),
                        spec=spec,
                    )
            continue
        for mode, section in group.items():
            task_type = (
                "text_to_speech" if modality == "audio" and mode == "tts" else mode
            )
            for model_key, spec in (section.get("models") or {}).items():
                yield ModelEntry(
                    modality=modality,
                    task_type=task_type,
                    model_key=model_key,
                    canonical_model_id=spec.get("canonical_model_id", model_key),
                    spec=spec,
                )


def find_models(
    entries: Iterable[ModelEntry],
    model: Optional[str] = None,
    task_type: Optional[str] = None,
    modality: Optional[str] = None,
    search: Optional[str] = None,
) -> List[ModelEntry]:
    found = []
    needle = (search or "").lower()
    for entry in entries:
        if model and model not in (entry.model_key, entry.canonical_model_id):
            continue
        if task_type and task_type != entry.task_type:
            continue
        if modality and modality != entry.modality:
            continue
        if needle:
            haystack = " ".join(
                [
                    entry.model_key,
                    entry.canonical_model_id,
                    entry.spec.get("model_name", ""),
                    entry.spec.get("description", ""),
                ]
            ).lower()
            if needle not in haystack:
                continue
        found.append(entry)
    return found


def parameter_definitions(entry: ModelEntry) -> Dict[str, Dict[str, Any]]:
    definitions = dict(entry.spec.get("parameters") or {})
    # The source JSON intentionally uses the historical spelling "senoir_parameters".
    definitions.update(entry.spec.get("senoir_parameters") or {})
    return definitions


def parameter_defaults(entry: ModelEntry) -> Dict[str, Any]:
    defaults: Dict[str, Any] = {}
    for name, definition in parameter_definitions(entry).items():
        if definition.get("type") == "set":
            continue
        if "default" in definition:
            defaults[name] = definition["default"]
    return defaults


def parse_key_value(item: str) -> tuple[str, Any]:
    if "=" not in item:
        raise ValueError(f"Expected KEY=VALUE, got: {item}")
    key, raw = item.split("=", 1)
    key = key.strip()
    if not key:
        raise ValueError(f"Empty key in: {item}")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        value = raw
    return key, value


def validate_parameter(name: str, value: Any, definition: Dict[str, Any]) -> None:
    param_type = definition.get("type")
    if param_type == "choices":
        choices = [item.get("value") for item in definition.get("choices", [])]
        if value not in choices:
            raise ValueError(f"{name} must be one of {choices!r}; got {value!r}")
    elif param_type == "number":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError(f"{name} must be a number; got {value!r}")
        minimum = definition.get("min")
        maximum = definition.get("max")
        if minimum is not None and value < minimum:
            raise ValueError(f"{name} must be >= {minimum}; got {value}")
        if maximum is not None and value > maximum:
            raise ValueError(f"{name} must be <= {maximum}; got {value}")


def apply_overrides(
    entry: ModelEntry,
    raw_items: List[str],
    allow_unknown: bool,
) -> Dict[str, Any]:
    values = parameter_defaults(entry)
    definitions = parameter_definitions(entry)
    for item in raw_items:
        name, value = parse_key_value(item)
        definition = definitions.get(name)
        if definition is None and not allow_unknown:
            raise ValueError(
                f"Unknown parameter {name!r}. Use the show command or "
                "--allow-unknown-param for provider-specific fields."
            )
        if definition is not None:
            validate_parameter(name, value, definition)
        values[name] = value
    return values


def add_nested(target: Dict[str, Any], dotted_key: str, value: Any) -> None:
    parts = dotted_key.split(".")
    current = target
    for part in parts[:-1]:
        child = current.get(part)
        if not isinstance(child, dict):
            child = {}
            current[part] = child
        current = child
    current[parts[-1]] = value


def camera_prompt(params: Dict[str, Any]) -> str:
    camera = params.pop("cameraControl", None)
    if not isinstance(camera, dict) or not camera.get("enable"):
        return ""
    labels = {
        "camera": "摄像机",
        "shot": "镜头",
        "aperture": "光圈",
        "focalLength": "焦距",
    }
    segments = [f"{labels[key]}{camera[key]}" for key in labels if camera.get(key)]
    return f"({'，'.join(segments)})." if segments else ""


def build_payload(
    entry: ModelEntry, args: argparse.Namespace
) -> tuple[Dict[str, Any], int]:
    params = apply_overrides(entry, args.param, args.allow_unknown_param)
    prompt = args.prompt or ""
    prefix = camera_prompt(params)
    if prefix:
        prompt = prefix + prompt

    max_prompt = entry.spec.get("maxPrompt")
    if max_prompt and len(prompt) > int(max_prompt):
        raise ValueError(
            f"Prompt length {len(prompt)} exceeds model limit {max_prompt}"
        )

    count = int(args.count if args.count is not None else params.get("gen_count", 1))
    params.pop("gen_count", None)
    if count < 1:
        raise ValueError("count must be at least 1")

    data: Dict[str, Any] = {"prompt": prompt}
    if args.image_url:
        data["image_url_list"] = args.image_url
    if args.video_url:
        data["video_url_list"] = args.video_url
    if args.audio_url:
        data["audio_url_list"] = args.audio_url
    if args.voice_url:
        data["voice_url_list"] = args.voice_url

    if entry.modality == "text":
        data["chat_params"] = params
        data["chat_params"].setdefault("search_resource", False)
    elif entry.modality == "image":
        data.setdefault("image_url_list", [])
        data["image_params"] = params
    elif entry.modality == "video":
        data.setdefault("image_url_list", [])
        data.setdefault("video_url_list", [])
        data.setdefault("audio_url_list", [])
        mappings = {
            "enableRealPerson": "enable_real_person",
            "enableAudio": "enable_audio",
        }
        data["video_params"] = {
            mappings.get(key, key): value for key, value in params.items()
        }
    elif entry.task_type == "text_to_speech":
        data.setdefault("audio_url_list", [])
        data.setdefault("voice_url_list", [])
        mappings = {
            "voiceId": "voice_id",
            "language_boost": "language",
            "vol": "volume",
            "pitch": "intonation",
        }
        data["audio_params"] = {
            mappings.get(key, key): value for key, value in params.items()
        }
    else:
        data.setdefault("audio_url_list", [])
        data["audio_params"] = params

    for item in args.data:
        key, value = parse_key_value(item)
        add_nested(data, key, value)

    payload = {
        "model_id": entry.canonical_model_id,
        "task_type": entry.task_type,
        "data": data,
    }
    validate_assets(entry.task_type, data)
    return payload, count


def validate_assets(task_type: str, data: Dict[str, Any]) -> None:
    images = data.get("image_url_list") or []
    videos = data.get("video_url_list") or []
    audios = data.get("audio_url_list") or []
    if task_type == "first_last_frame_to_video" and len(images) < 2:
        raise ValueError(
            "first_last_frame_to_video requires at least two --image-url values"
        )
    if task_type in {
        "image_to_video",
        "reference_image_to_video",
        "reference_image_to_image",
    }:
        if not images:
            raise ValueError(f"{task_type} requires at least one --image-url")
    if task_type == "video_to_video" and not videos:
        raise ValueError("video_to_video requires at least one --video-url")
    if task_type == "video_parsing" and not videos:
        raise ValueError("video_parsing requires at least one --video-url")
    if task_type == "audio_to_audio" and not audios:
        raise ValueError("audio_to_audio requires at least one --audio-url")
    if task_type == "audio_parsing" and not audios:
        raise ValueError("audio_parsing requires at least one --audio-url")


def post_json(endpoint: str, payload: Dict[str, Any], timeout: float) -> Dict[str, Any]:
    if endpoint not in {
        "/v1/proxy",
        "/v1/proxy_async_create",
        "/v1/proxy_async_get_result",
    }:
        raise ValueError("Only backend-configured Insight paths are allowed")
    result = enterprise_request(
        CONNECTION, "POST", endpoint, body=payload, timeout=timeout
    )
    if not isinstance(result, dict) or result.get("code") != 0:
        raise RuntimeError(f"API error: {result}")
    return result


def use_async_execution(entry: ModelEntry, execution: str) -> bool:
    if execution == "sync":
        return False
    if execution == "async":
        if entry.task_type not in ASYNC_TASK_TYPES:
            raise ValueError(f"No async task mapping for {entry.task_type}")
        return True
    return entry.task_type in ASYNC_TASK_TYPES


def async_endpoints(args: argparse.Namespace, endpoint: str) -> tuple[str, str]:
    return "/v1/proxy_async_create", "/v1/proxy_async_get_result"


def poll_task(
    task_id: str, result_task_type: str, args: argparse.Namespace
) -> Dict[str, Any]:
    deadline = time.monotonic() + args.poll_timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError(
                f"Async polling timed out; preserve task_id={task_id}, do not create again"
            )
        result = post_json(
            "/v1/proxy_async_get_result",
            {"task_type": result_task_type, "task_id": task_id},
            min(args.async_request_timeout, remaining),
        )
        status = str(result.get("status", "")).lower()
        if status == "success":
            return {**result, "task_id": task_id}
        if status == "failed":
            raise RuntimeError(f"Async task failed: {result.get('message', '')}")
        if status != "running":
            raise RuntimeError(f"Unexpected async status {status!r}")
        time.sleep(min(args.poll_interval, max(0, deadline - time.monotonic())))


def execute_async_call(
    payload: Dict[str, Any],
    args: argparse.Namespace,
    endpoint: str,
) -> Dict[str, Any]:
    if args.poll_interval < 0:
        raise ValueError("poll interval must be >= 0")
    if args.poll_timeout <= 0:
        raise ValueError("poll timeout must be > 0")
    if args.async_request_timeout <= 0:
        raise ValueError("async request timeout must be > 0")
    create_task_type, result_task_type = ASYNC_TASK_TYPES[payload["task_type"]]
    create_endpoint, result_endpoint = async_endpoints(args, endpoint)
    create_payload = copy.deepcopy(payload)
    create_payload["task_type"] = create_task_type
    created = post_json(
        create_endpoint,
        create_payload,
        args.async_request_timeout,
    )
    task_ids = (created.get("data") or {}).get("task_id_list") or []
    if not isinstance(task_ids, list) or not task_ids:
        raise RuntimeError("Async create succeeded but returned no local task ID")
    task_id = str(task_ids[0])
    print(
        json.dumps(
            {"event": "async_created", "task_id": task_id},
            ensure_ascii=False,
        ),
        file=sys.stderr,
        flush=True,
    )

    return poll_task(task_id, result_task_type, args)


def cmd_models(args: argparse.Namespace, entries: List[ModelEntry]) -> int:
    found = find_models(
        entries,
        task_type=args.task_type,
        modality=args.modality,
        search=args.search,
    )
    found.sort(key=lambda item: not is_insight_model(item))
    rows = [
        {
            "modality": item.modality,
            "task_type": item.task_type,
            "model_key": item.model_key,
            "model_id": item.canonical_model_id,
            "model_name": item.spec.get("model_name", ""),
            "description": item.spec.get("description", ""),
            "free": is_insight_model(item),
            "defaults": parameter_defaults(item),
        }
        for item in found
    ]
    print(json.dumps(rows, ensure_ascii=False, indent=2))
    return 0


def resolve_one(args: argparse.Namespace, entries: List[ModelEntry]) -> ModelEntry:
    found = find_models(entries, model=args.model, task_type=args.task_type)
    if not found:
        raise ValueError(
            f"No catalog entry for model={args.model!r}, task_type={args.task_type!r}"
        )
    if len(found) > 1:
        choices = [f"{item.task_type}:{item.model_key}" for item in found]
        raise ValueError(f"Model is ambiguous; add --task-type. Choices: {choices}")
    return found[0]


def cmd_show(args: argparse.Namespace, entries: List[ModelEntry]) -> int:
    entry = resolve_one(args, entries)
    output = {
        "modality": entry.modality,
        "task_type": entry.task_type,
        "model_key": entry.model_key,
        "model_id": entry.canonical_model_id,
        "free": is_insight_model(entry),
        "model": entry.spec,
        "effective_defaults": parameter_defaults(entry),
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


def cmd_call(args: argparse.Namespace, entries: List[ModelEntry]) -> int:
    entry = resolve_one(args, entries)
    payload, count = build_payload(entry, args)
    endpoint = DEFAULT_ENDPOINT
    use_async = use_async_execution(entry, args.execution)
    if args.dry_run:
        if use_async:
            create_task_type, result_task_type = ASYNC_TASK_TYPES[entry.task_type]
            create_endpoint, result_endpoint = async_endpoints(args, endpoint)
            create_payload = copy.deepcopy(payload)
            create_payload["task_type"] = create_task_type
            preview = {
                "execution": "async",
                "count": count,
                "create": {
                    "endpoint": create_endpoint,
                    "payload": create_payload,
                },
                "poll": {
                    "endpoint": result_endpoint,
                    "payload": {
                        "task_type": result_task_type,
                        "task_id": "<local-task-id-from-create-response>",
                    },
                    "interval_seconds": args.poll_interval,
                    "timeout_seconds": args.poll_timeout,
                    "request_timeout_seconds": args.async_request_timeout,
                },
            }
        else:
            preview = {
                "execution": "sync",
                "endpoint": endpoint,
                "count": count,
                "payload": payload,
            }
        preview["connection"] = CONNECTION
        print(json.dumps(preview, ensure_ascii=False, indent=2))
        return 0

    if use_async:
        results = [execute_async_call(payload, args, endpoint) for _ in range(count)]
    else:
        results = [
            post_json(
                endpoint,
                payload,
                args.timeout,
            )
            for _ in range(count)
        ]
    output: Any = results[0] if count == 1 else {"code": 0, "results": results}
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    models = subparsers.add_parser("models", help="List and search catalog models")
    models.add_argument("--modality", choices=["text", "image", "audio", "video"])
    models.add_argument("--task-type")
    models.add_argument("--search")

    show = subparsers.add_parser(
        "show", help="Show one model and its accepted parameters"
    )
    show.add_argument("--model", required=True)
    show.add_argument("--task-type")

    call = subparsers.add_parser(
        "call", help="Build and send via enterprise proxy; backend signs"
    )
    call.add_argument("--model", required=True)
    call.add_argument("--task-type")
    call.add_argument("--prompt", default="")
    call.add_argument("--image-url", action="append", default=[])
    call.add_argument("--video-url", action="append", default=[])
    call.add_argument("--audio-url", action="append", default=[])
    call.add_argument("--voice-url", action="append", default=[])
    call.add_argument("--param", action="append", default=[], metavar="KEY=JSON_VALUE")
    call.add_argument("--data", action="append", default=[], metavar="PATH=JSON_VALUE")
    call.add_argument("--allow-unknown-param", action="store_true")
    call.add_argument("--count", type=int)
    call.add_argument(
        "--execution",
        choices=["auto", "sync", "async"],
        default="auto",
        help="auto uses async create/poll for supported video generation tasks",
    )
    call.add_argument("--poll-interval", type=float, default=10.0)
    call.add_argument("--poll-timeout", type=float, default=3600.0)
    call.add_argument("--async-request-timeout", type=float, default=120.0)
    call.add_argument("--timeout", type=float, default=1250)
    call.add_argument("--dry-run", action="store_true")
    poll = subparsers.add_parser(
        "poll",
        help="Resume an existing video task without submitting another generation",
    )
    poll.add_argument("--task-id", required=True)
    poll.add_argument("--task-type", required=True, choices=list(ASYNC_TASK_TYPES))
    poll.add_argument("--poll-interval", type=float, default=10)
    poll.add_argument("--poll-timeout", type=float, default=3600)
    poll.add_argument("--async-request-timeout", type=float, default=120)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command in {"call", "poll"}:
            for key in ("poll_interval", "poll_timeout", "async_request_timeout"):
                value = getattr(args, key)
                if not __import__("math").isfinite(value) or value <= 0:
                    raise ValueError(f"{key} must be positive and finite")
            if args.async_request_timeout > 1250:
                raise ValueError("async request timeout must not exceed 1250")
        if args.command == "poll":
            print(
                json.dumps(
                    poll_task(args.task_id, ASYNC_TASK_TYPES[args.task_type][1], args),
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 0
        entries = list(iter_models(load_catalog()))
        if args.command == "models":
            return cmd_models(args, entries)
        if args.command == "show":
            return cmd_show(args, entries)
        if args.command == "call":
            return cmd_call(args, entries)
        parser.error(f"Unknown command: {args.command}")
    except (ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
