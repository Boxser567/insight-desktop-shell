#!/usr/bin/env python3
"""Shared enterprise-proxy client helpers for ppt-maker-new.

The distributed package contains no credentials and has no PyYAML dependency.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from ppt_proxy import image_data_url, request

DEFAULT_BASE = "enterprise-proxy:ppt-text"
DEFAULT_MODEL = "gpt-5.6-sol"


def is_safe_asset_src(value: str) -> bool:
    """Return whether a model-authored asset path stays relative and local."""
    raw = str(value or "").strip()
    normalized = raw.replace("\\", "/")
    if not normalized or "\x00" in normalized:
        return False
    if normalized.startswith(("/", "@", "http://", "https://")):
        return False
    if re.match(r"^[A-Za-z]:/", normalized):
        return False
    return all(part not in {"", ".", ".."} for part in normalized.split("/"))


def resolve_asset_target(assets_dir: Path, value: str) -> Path:
    """Resolve a safe asset path and enforce containment, including symlinks."""
    if not is_safe_asset_src(value):
        raise ValueError(f"unsafe asset path: {value!r}")
    root = assets_dir.resolve()
    target = (root / value).resolve()
    if not target.is_relative_to(root):
        raise ValueError(f"unsafe asset path: {value!r}")
    return target


def extract_json(text: str) -> Any:
    """Return the first valid JSON object or array from a model response."""
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    decoder = json.JSONDecoder()
    for index, char in enumerate(cleaned):
        if char not in "[{":
            continue
        try:
            value, _ = decoder.raw_decode(cleaned[index:])
            return value
        except json.JSONDecodeError:
            continue
    raise ValueError("model response contains no valid JSON object or array")


class ModelText(str):
    """String-compatible response with immutable-per-call provider diagnostics."""
    def __new__(cls, response):
        value = super().__new__(cls, response['content'])
        value.metadata = {k: response.get(k) for k in
                          ('usage', 'finish_reason', 'response_id', 'model', 'requested_max_tokens')}
        return value


def response_metadata(response):
    source = response if isinstance(response, dict) else getattr(response, 'metadata', {})
    usage = source.get('usage')
    return {'provider_usage': usage if isinstance(usage, dict) and usage else None,
            **{key: source.get(key) for key in
               ('finish_reason', 'response_id', 'model', 'requested_max_tokens')}}


def sol(
    prompt: str,
    *,
    model: str | None = None,
    max_tokens: int = 22000,
    timeout: int = 900,
    base_url: str | None = None,
) -> str:
    return ModelText(sol_response(
        prompt, model=model, max_tokens=max_tokens, timeout=timeout, base_url=base_url,
    ))


class RequestNotSubmitted(ValueError):
    """Adapter proves it failed before opening the provider connection."""


def _prepare_sol_request(
    prompt: str,
    *,
    model: str | None = None,
    max_tokens: int = 22000,
    timeout: int = 900,
    base_url: str | None = None,
    image_paths: list[Path] | None = None,
) -> dict[str, Any]:
    """Build a credential-free request body for the enterprise backend."""
    if base_url is not None:
        raise RequestNotSubmitted(
            "PPT endpoint is controlled by the enterprise backend; base_url is not supported"
        )
    body = {
        "model": model or DEFAULT_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
    }
    if image_paths:
        content = [{'type': 'text', 'text': prompt}]
        for path in image_paths:
            content.append({'type': 'image_url', 'image_url': {
                'url': image_data_url(Path(path)),
                'detail': 'high'}})
        body['messages'][0]['content'] = content
    return body


def sol_response(prompt: str, *, model=None, max_tokens=22000, timeout=900,
                 base_url=None, image_paths=None) -> dict[str, Any]:
    try:
        body = _prepare_sol_request(
            prompt, model=model, max_tokens=max_tokens, timeout=timeout,
            base_url=base_url, image_paths=image_paths,
        )
    except RequestNotSubmitted:
        raise
    except Exception as exc:
        raise RequestNotSubmitted(str(exc)) from exc
    from call_budget import reserve_call
    payload = request(
        'ppt-text', '/chat/completions', body,
        timeout=timeout, before_send=reserve_call,
    )
    try:
        choice = payload["choices"][0]
        content = choice["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("model response does not contain choices[0].message.content") from exc
    return {
        "content": content,
        "finish_reason": choice.get("finish_reason"),
        "usage": payload.get("usage") or {},
        "response_id": payload.get("id"),
        "model": payload.get("model") or body["model"],
        "requested_max_tokens": max_tokens,
    }
