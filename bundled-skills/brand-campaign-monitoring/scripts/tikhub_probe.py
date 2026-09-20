#!/usr/bin/env python3
"""Run read-only TikHub smoke probes without exposing the API token."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path


from enterprise_proxy import request as proxy_request, ProxyError
SENSITIVE_KEY = re.compile(
    r"(?:authorization|cookie|(?:^|_)token(?:$|_)|secret|password|xsec|signature|signed|play_?url|download_?url)",
    re.IGNORECASE,
)


SEED_PROBES = [
    {"id": "douyin.search", "platform": "douyin", "method": "POST", "path": "/api/v1/douyin/search/fetch_general_search_v2", "json": {"keyword": "扫地机器人", "cursor": 0}},
    {"id": "xiaohongshu.search", "platform": "xiaohongshu", "method": "GET", "path": "/api/v1/xiaohongshu/app_v2/search_notes", "params": {"keyword": "扫地机器人", "page": 1}},
    {"id": "bilibili.search", "platform": "bilibili", "method": "GET", "path": "/api/v1/bilibili/web/fetch_general_search", "params": {"keyword": "扫地机器人", "order": "totalrank", "page": 1, "page_size": 10}},
    {"id": "weibo.search", "platform": "weibo", "method": "GET", "path": "/api/v1/weibo/web/fetch_search", "params": {"keyword": "扫地机器人", "page": 1, "search_type": "1"}},
    {"id": "zhihu.search", "platform": "zhihu", "method": "GET", "path": "/api/v1/zhihu/web/fetch_article_search_v3", "params": {"keyword": "扫地机器人", "offset": "0", "limit": "10"}},
    {"id": "kuaishou.feed", "platform": "kuaishou", "method": "GET", "path": "/api/v1/kuaishou/app/fetch_selection_feed"},
    {"id": "wechat_search.article", "platform": "wechat_search", "method": "POST", "path": "/api/v1/wechat_search/v2/fetch_search", "json": {"keyword": "扫地机器人", "business_type": "article", "raw": False}},
    {"id": "wechat_search.video", "platform": "wechat_search", "method": "POST", "path": "/api/v1/wechat_search/v2/fetch_search_videos", "json": {"keyword": "扫地机器人", "raw": False}},
    {"id": "tiktok.search", "platform": "tiktok", "method": "GET", "path": "/api/v1/tiktok/web/fetch_general_search", "params": {"keyword": "robot vacuum", "offset": 0}},
    {"id": "instagram.search", "platform": "instagram", "method": "GET", "path": "/api/v1/instagram/v1/fetch_search", "params": {"query": "robot vacuum"}},
    {"id": "youtube.search", "platform": "youtube", "method": "GET", "path": "/api/v1/youtube/web_v2/get_general_search_v2", "params": {"keyword": "robot vacuum", "type": "video"}},
    {"id": "reddit.search", "platform": "reddit", "method": "GET", "path": "/api/v1/reddit/app/fetch_dynamic_search", "params": {"query": "robot vacuum", "search_type": "post", "sort": "RELEVANCE", "need_format": True}},
    {"id": "twitter.search", "platform": "twitter", "method": "GET", "path": "/api/v1/twitter/web/fetch_search_timeline", "params": {"keyword": "robot vacuum", "search_type": "Top"}},
    {"id": "threads.search", "platform": "threads", "method": "GET", "path": "/api/v1/threads/web/search_top", "params": {"query": "robot vacuum"}},
    {"id": "linkedin.company", "platform": "linkedin", "method": "GET", "path": "/api/v1/linkedin/web_v2/get_company_profile", "params": {"url": "https://www.linkedin.com/company/openai/"}},
    {"id": "telegram.channel", "platform": "telegram", "method": "GET", "path": "/api/v1/telegram/web/fetch_channel_info", "params": {"channel": "durov"}},
    {"id": "lemon8.search", "platform": "lemon8", "method": "GET", "path": "/api/v1/lemon8/app/fetch_search", "params": {"query": "robot vacuum"}},
    {"id": "xigua.search", "platform": "xigua", "method": "GET", "path": "/api/v1/xigua/app/v2/search_video", "params": {"keyword": "扫地机器人", "offset": 0}},
    {"id": "pipixia.search", "platform": "pipixia", "method": "GET", "path": "/api/v1/pipixia/app/fetch_search", "params": {"keyword": "扫地机器人", "offset": "0"}},
]


def sanitize(value):
    if isinstance(value, dict):
        return {
            key: ("[REDACTED]" if SENSITIVE_KEY.search(str(key)) else sanitize(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        parsed = urllib.parse.urlsplit(value)
        if parsed.netloc.lower() == "mp.weixin.qq.com":
            return value
        query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        safe_query = [(key, item) for key, item in query if not SENSITIVE_KEY.search(key)]
        return urllib.parse.urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(safe_query), "")
        )
    return value


def summarize(payload):
    data = payload.get("data") if isinstance(payload, dict) else None
    result = {
        "top_code": payload.get("code") if isinstance(payload, dict) else None,
        "message": str(payload.get("message", ""))[:240] if isinstance(payload, dict) else "",
        "request_id": payload.get("request_id") if isinstance(payload, dict) else None,
        "data_type": type(data).__name__,
    }
    if isinstance(data, list):
        result["data_count"] = len(data)
        if data and isinstance(data[0], dict):
            result["sample_keys"] = sorted(data[0].keys())[:40]
    elif isinstance(data, dict):
        result["data_keys"] = sorted(data.keys())[:60]
        for key in ("items", "list", "data", "results", "feeds", "aweme_list"):
            child = data.get(key)
            if isinstance(child, list):
                result["nested_list_key"] = key
                result["nested_count"] = len(child)
                if child and isinstance(child[0], dict):
                    result["sample_keys"] = sorted(child[0].keys())[:40]
                break
    return result


def run_probe(probe, timeout):
    started = time.time()
    try:
        payload = proxy_request("tikhub", probe["method"], probe["path"],
            query=probe.get("params", {}), body=probe.get("json"), timeout=timeout)
        return {**probe, "http_status": 200, "elapsed_s": round(time.time() - started, 3),
                "summary": summarize(payload), "safe_payload": sanitize(payload)}
    except ProxyError as error:
        return {**probe, "http_status": error.status, "elapsed_s": round(time.time() - started, 3), "error": str(error)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--probes-file", help="Optional JSON array of probe definitions")
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--timeout", type=int, default=80)
    args = parser.parse_args()
    probes = SEED_PROBES
    if args.probes_file:
        probes = json.loads(Path(args.probes_file).read_text(encoding="utf-8"))
        if not isinstance(probes, list):
            raise ValueError("probes file must contain a JSON array")
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(run_probe, probe, args.timeout) for probe in probes]
        results = [future.result() for future in futures]
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    for item in results:
        summary = item.get("summary", {})
        print(f"{item['id']} http={item.get('http_status')} code={summary.get('top_code')} data={summary.get('data_type')} count={summary.get('data_count', summary.get('nested_count', '-'))} error={item.get('error', '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
