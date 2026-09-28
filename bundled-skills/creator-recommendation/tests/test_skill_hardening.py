import json
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate_creator_output.py"
GUARD = ROOT / "scripts" / "tikhub_guard.py"
CLIENT = ROOT / "scripts" / "tikhub_readonly.py"
sys.path.insert(0, str(ROOT / "scripts"))
CLIENT_SPEC = importlib.util.spec_from_file_location("creator_tikhub_readonly", CLIENT)
CLIENT_MODULE = importlib.util.module_from_spec(CLIENT_SPEC)
assert CLIENT_SPEC and CLIENT_SPEC.loader
CLIENT_SPEC.loader.exec_module(CLIENT_MODULE)


def run_json_tool(script: Path, payload: dict, *args: str) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "input.json"
        source.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(script), "--input", str(source), *args],
            text=True,
            capture_output=True,
            check=False,
        )


def valid_creator_output() -> dict:
    return {
        "requested_platforms": ["douyin", "xiaohongshu"],
        "platform_gaps": [
            {
                "platform": "xiaohongshu",
                "reason": "未取得可验证报价，保留公开内容候选待补数",
            }
        ],
        "creators": [
            {
                "creator_key": "douyin:70001",
                "platform": "douyin",
                "tier": "优先测试",
                "profile": {
                    "followers": 120000,
                    "followers_captured_at": "2026-09-21T10:00:00+08:00",
                },
                "recent_posts": {
                    "sample_size": 10,
                    "median_views": 220000,
                    "view_range": {"min": 12000, "max": 900000},
                    "stability_metric": {
                        "name": "min_max_ratio",
                        "formula": "min_views/max_views",
                        "value": 0.0133,
                    },
                },
                "audience": {"status": "unavailable"},
                "asset_reuse_evidence": [],
                "commercial_capability": {
                    "recommendation_fit_score": 82,
                    "commercial_capability_score": None,
                    "commercial_evidence_coverage": 60,
                    "recommended_roles": ["场景种草"],
                    "dimensions": {"audience_fit": {"score": None}},
                },
            }
        ],
    }


class EndpointContractTests(unittest.TestCase):
    def test_contract_captures_search_semantics_and_current_status(self) -> None:
        contract_path = ROOT / "references" / "tikhub-endpoints.json"
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
        endpoints = {item["path"]: item for item in contract["endpoints"]}

        search = endpoints["/api/v1/douyin/xingtu_v2/search_creator"]
        self.assertEqual(search["method"], "GET")
        self.assertEqual(search["parameters"]["seach_type"]["default"], 3)
        self.assertIn("按内容", search["parameters"]["seach_type"]["meaning"])
        self.assertEqual(search["last_verified_at"], "2026-09-21")

        audience = endpoints[
            "/api/v1/douyin/xingtu_v2/get_author_audience_distribution"
        ]
        self.assertEqual(audience["status"], "failed")
        self.assertEqual(audience["last_failure_at"], "2026-09-21")

        link = endpoints["/api/v1/douyin/xingtu_v2/get_author_link_info"]
        self.assertEqual(link["id_contract"]["parameter"], "o_author_id")
        self.assertEqual(link["id_contract"]["preferred_source"], "star_id")

    def test_skill_requires_preflight_and_executable_validation(self) -> None:
        text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("输入门禁", text)
        self.assertIn("双对象语义健康检查", text)
        self.assertIn("python3 scripts/validate_creator_output.py", text)
        self.assertIn("禁止在执行脚本中读取", text)


class CreatorValidatorTests(unittest.TestCase):
    def test_accepts_partial_evidence_as_priority_test_with_platform_gap(self) -> None:
        result = run_json_tool(VALIDATOR, valid_creator_output())
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_rejects_priority_invite_when_audience_is_missing(self) -> None:
        payload = valid_creator_output()
        payload["creators"][0]["tier"] = "优先邀约"
        result = run_json_tool(VALIDATOR, payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("audience", result.stdout + result.stderr)

    def test_rejects_missing_requested_platform_without_gap(self) -> None:
        payload = valid_creator_output()
        payload["platform_gaps"] = []
        result = run_json_tool(VALIDATOR, payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("xiaohongshu", result.stdout + result.stderr)

    def test_rejects_asset_reuse_tier_without_existing_asset(self) -> None:
        payload = valid_creator_output()
        payload["creators"][0]["tier"] = "素材复用优先"
        result = run_json_tool(VALIDATOR, payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("asset_reuse_evidence", result.stdout + result.stderr)

    def test_rejects_metric_name_formula_mismatch(self) -> None:
        payload = valid_creator_output()
        payload["creators"][0]["recent_posts"]["stability_metric"][
            "name"
        ] = "median_max_ratio"
        result = run_json_tool(VALIDATOR, payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stability_metric", result.stdout + result.stderr)

    def test_rejects_forbidden_transient_fields(self) -> None:
        payload = valid_creator_output()
        payload["creators"][0]["cache_url"] = "https://example.invalid/cache"
        result = run_json_tool(VALIDATOR, payload)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cache_url", result.stdout + result.stderr)


class CanaryTests(unittest.TestCase):
    def test_rejects_identical_payloads_for_two_different_creators(self) -> None:
        left = {"code": 200, "data": {"link_spread_index": {"value": 75.55}}}
        right = {"code": 200, "data": {"link_spread_index": {"value": 75.55}}}
        with tempfile.TemporaryDirectory() as tmp:
            left_path = Path(tmp) / "left.json"
            right_path = Path(tmp) / "right.json"
            left_path.write_text(json.dumps(left), encoding="utf-8")
            right_path.write_text(json.dumps(right), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(GUARD),
                    "canary",
                    "--left",
                    str(left_path),
                    "--right",
                    str(right_path),
                    "--core-field",
                    "data.link_spread_index",
                ],
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("identical", (result.stdout + result.stderr).lower())


class ReadonlyClientTests(unittest.TestCase):
    def test_dry_run_applies_content_search_default_without_credentials(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(CLIENT),
                "--contract",
                str(ROOT / "references" / "tikhub-endpoints.json"),
                "--path",
                "/api/v1/douyin/xingtu_v2/search_creator",
                "--query",
                "keyword=雪糕",
                "--dry-run",
            ],
            text=True,
            capture_output=True,
            check=False,
            env={},
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("seach_type=3", result.stdout)
        self.assertNotIn("config.toml", CLIENT.read_text(encoding="utf-8"))
        self.assertNotIn("TIKHUB_API_KEY", CLIENT.read_text(encoding="utf-8"))
        self.assertIn("enterprise_proxy", CLIENT.read_text(encoding="utf-8"))

    def test_live_call_uses_enterprise_proxy_and_sanitizes_output(self) -> None:
        observed = {}

        def fake_proxy(connection, method, path, **kwargs):
            observed.update(connection=connection, method=method, path=path, **kwargs)
            return {
                "code": 200,
                "cache_url": "https://example.invalid/cache",
                "data": {"items": [1], "xsec_token": "secret"},
            }

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "response.json"
            argv = [
                str(CLIENT),
                "--contract", str(ROOT / "references" / "tikhub-endpoints.json"),
                "--path", "/api/v1/douyin/xingtu_v2/search_creator",
                "--query", "keyword=雪糕",
                "--output", str(output),
            ]
            with patch.object(CLIENT_MODULE, "proxy_request", side_effect=fake_proxy), patch.object(sys, "argv", argv):
                result = CLIENT_MODULE.main()
            self.assertEqual(result, 0)
            cleaned = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(observed["connection"], "tikhub")
        self.assertEqual(observed["method"], "GET")
        self.assertEqual(observed["query"]["keyword"], "雪糕")
        serialized = json.dumps(cleaned)
        self.assertNotIn("cache_url", serialized)
        self.assertNotIn("xsec_token", serialized)


if __name__ == "__main__":
    unittest.main()
