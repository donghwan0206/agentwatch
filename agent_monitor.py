#!/usr/bin/env python3
"""LAN-accessible monitor for local LLM and coding-agent processes."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import socket
import sqlite3
import subprocess
import threading
import time
from contextlib import closing
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
DEFAULT_DB = APP_DIR / "data" / "agentwatch.sqlite3"


AGENT_RULES = [
    {
        "key": "openclaw",
        "name": "OpenClaw",
        "accent": "#f59e0b",
        "patterns": [r"\bopenclaw\b", r"\bopen-claw\b", r"\bopenclo\b"],
    },
    {
        "key": "hermes",
        "name": "Hermes",
        "accent": "#ef4444",
        "patterns": [r"\bhermes\b"],
    },
    {
        "key": "codex",
        "name": "OpenAI Codex",
        "accent": "#10a37f",
        "patterns": [r"\bcodex\b", r"@openai/(?:codex|codex-cli)", r"openai.*codex"],
    },
    {
        "key": "claude",
        "name": "Claude Code",
        "accent": "#c15f3c",
        "patterns": [r"\bclaude(?:-code)?\b", r"@anthropic-ai/claude-code", r"anthropic.*claude"],
    },
    {
        "key": "gemini",
        "name": "Gemini CLI",
        "accent": "#4f7cff",
        "patterns": [r"\bgemini\b", r"\bgemini-cli\b", r"@google/gemini-cli", r"google.*gemini"],
    },
    {
        "key": "chatgpt",
        "name": "ChatGPT",
        "accent": "#22b8cf",
        "patterns": [r"\bchatgpt\b", r"\bopenai chatgpt\b"],
    },
    {
        "key": "opencode",
        "name": "OpenCode",
        "accent": "#8b5cf6",
        "patterns": [r"\bopencode\b", r"\bopen-code\b"],
    },
    {
        "key": "aider",
        "name": "Aider",
        "accent": "#14b8a6",
        "patterns": [r"\baider\b", r"\baider-chat\b", r"\s-m\s+aider\b"],
    },
    {
        "key": "goose",
        "name": "Goose",
        "accent": "#f97316",
        "patterns": [r"@block/goose", r"\bgoose(?:\.exe)?\b", r"\bgoose\s+run\b"],
    },
    {
        "key": "cursor-agent",
        "name": "Cursor Agent",
        "accent": "#facc15",
        "patterns": [r"\bcursor-agent\b", r"\bcursor\s+agent\b", r"\bcursor\s+--agent\b"],
    },
    {
        "key": "qwen-code",
        "name": "Qwen Code",
        "accent": "#06b6d4",
        "patterns": [r"\bqwen-code\b", r"@qwen-code/qwen-code", r"\bqwen\s+code\b"],
    },
    {
        "key": "ollama",
        "name": "Ollama",
        "accent": "#111827",
        "patterns": [r"\bollama\b"],
    },
    {
        "key": "lmstudio",
        "name": "LM Studio",
        "accent": "#ec4899",
        "patterns": [r"\blm\s+studio\b", r"\blm-studio\b", r"\blmstudio\b"],
    },
    {
        "key": "llamacpp",
        "name": "llama.cpp",
        "accent": "#84cc16",
        "patterns": [r"\bllama\.cpp\b", r"\bllama-server\b", r"\bllama-cli\b"],
    },
]


SECRET_RE = re.compile(
    r"(?i)\b(api[_-]?key|token|secret|password|authorization|bearer)[=:]\S+"
)
WHITESPACE_RE = re.compile(r"\s+")
TURN_USAGE_RE = re.compile(r"turn_id=([^\s}]+).*?total_usage_tokens=(\d+)")
MODEL_RE = re.compile(r"model=([^\s}]+)")


CODEX_STATE_DB_CANDIDATES = [
    Path.home() / ".codex" / "state_5.sqlite",
    Path.home() / ".codex" / "sqlite" / "state_5.sqlite",
]
CODEX_LOG_DB_CANDIDATES = [
    Path.home() / ".codex" / "logs_2.sqlite",
    Path.home() / ".codex" / "sqlite" / "logs_2.sqlite",
]
USAGE_CACHE: dict[str, Any] = {"key": None, "ts": 0, "value": None}
USAGE_CACHE_LOCK = threading.Lock()


@dataclass
class ProcessInfo:
    pid: int
    ppid: int
    cpu: float
    memory: float
    elapsed: str
    command: str
    args: str


def sanitize_command(value: str) -> str:
    home = str(Path.home())
    safe = value.replace(home, "~")
    safe = SECRET_RE.sub(lambda match: f"{match.group(1)}=<redacted>", safe)
    safe = WHITESPACE_RE.sub(" ", safe).strip()
    if len(safe) > 220:
        return safe[:217] + "..."
    return safe


def load_processes() -> list[ProcessInfo]:
    try:
        output = subprocess.check_output(
            ["ps", "-axo", "pid=,ppid=,pcpu=,pmem=,etime=,comm=,args="],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError):
        return []

    processes: list[ProcessInfo] = []
    for line in output.splitlines():
        parts = line.strip().split(None, 6)
        if len(parts) < 7:
            continue
        pid, ppid, cpu, memory, elapsed, command, args = parts
        try:
            processes.append(
                ProcessInfo(
                    pid=int(pid),
                    ppid=int(ppid),
                    cpu=float(cpu),
                    memory=float(memory),
                    elapsed=elapsed,
                    command=Path(command).name,
                    args=args,
                )
            )
        except ValueError:
            continue
    return processes


def detect_provider(process: ProcessInfo) -> dict[str, Any] | None:
    haystack = f"{process.command} {process.args}".lower()
    for rule in AGENT_RULES:
        for pattern in rule["patterns"]:
            if re.search(pattern, haystack, re.IGNORECASE):
                return rule
    return None


def summarize_processes(processes: list[ProcessInfo]) -> dict[str, Any]:
    by_provider: dict[str, dict[str, Any]] = {
        rule["key"]: {
            "key": rule["key"],
            "name": rule["name"],
            "accent": rule["accent"],
            "status": "offline",
            "processCount": 0,
            "cpu": 0.0,
            "memory": 0.0,
            "processes": [],
        }
        for rule in AGENT_RULES
    }

    for process in processes:
        rule = detect_provider(process)
        if not rule:
            continue

        provider = by_provider[rule["key"]]
        provider["processCount"] += 1
        provider["cpu"] += process.cpu
        provider["memory"] += process.memory
        provider["processes"].append(
            {
                "pid": process.pid,
                "cpu": round(process.cpu, 2),
                "memory": round(process.memory, 2),
                "elapsed": process.elapsed,
                "command": sanitize_command(process.args or process.command),
            }
        )

    for provider in by_provider.values():
        provider["cpu"] = round(provider["cpu"], 2)
        provider["memory"] = round(provider["memory"], 2)
        provider["processes"] = sorted(
            provider["processes"], key=lambda item: item["cpu"], reverse=True
        )
        provider["status"] = provider_status(provider)

    visible = sorted(
        by_provider.values(),
        key=lambda item: (item["status"] == "offline", -item["cpu"], item["name"]),
    )
    total_cpu = round(sum(item["cpu"] for item in visible), 2)
    total_mem = round(sum(item["memory"] for item in visible), 2)
    active_count = sum(item["processCount"] for item in visible)
    score = min(100, round(total_cpu * 1.8 + active_count * 8))

    return {
        "timestamp": int(time.time()),
        "hostname": socket.gethostname(),
        "localIps": local_ips(),
        "activity": {
            "score": score,
            "status": activity_status(score, active_count),
            "activeProcessCount": active_count,
            "totalCpu": total_cpu,
            "totalMemory": total_mem,
        },
        "providers": visible,
    }


def provider_status(provider: dict[str, Any]) -> str:
    if provider["processCount"] == 0:
        return "offline"
    if provider["cpu"] >= 15:
        return "busy"
    if provider["cpu"] >= 1:
        return "active"
    return "idle"


def activity_status(score: int, active_count: int) -> str:
    if active_count == 0:
        return "quiet"
    if score >= 55:
        return "busy"
    if score >= 18:
        return "active"
    return "idle"


def local_ips() -> list[str]:
    ips: set[str] = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            ips.add(sock.getsockname()[0])
    except OSError:
        pass

    try:
        for family, _, _, _, sockaddr in socket.getaddrinfo(socket.gethostname(), None):
            if family == socket.AF_INET:
                ip = sockaddr[0]
                if not ip.startswith("127."):
                    ips.add(ip)
    except OSError:
        pass

    return sorted(ips)


def first_existing(paths: list[Path]) -> Path | None:
    for path in paths:
        if path.exists():
            return path
    return None


def connect_readonly(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=0.5)
    conn.row_factory = sqlite3.Row
    return conn


def local_day(ts: int) -> str:
    return dt.datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


def collect_codex_usage(days: int = 90) -> dict[str, Any]:
    log_db = first_existing(CODEX_LOG_DB_CANDIDATES)
    state_db = first_existing(CODEX_STATE_DB_CANDIDATES)
    now = int(time.time())
    since = now - max(1, min(days, 366)) * 86400

    usage = {
        "provider": "codex",
        "name": "OpenAI Codex",
        "source": "not_found",
        "updatedAt": now,
        "totals": {
            "todayTokens": 0,
            "last7DaysTokens": 0,
            "last30DaysTokens": 0,
            "observedTokens": 0,
            "threadTotalTokens": 0,
            "threadCount": 0,
        },
        "daily": [],
        "quotas": [],
        "threads": [],
        "notes": [],
    }

    if log_db:
        usage["source"] = str(log_db).replace(str(Path.home()), "~")
        usage["daily"] = collect_codex_daily_usage(log_db, since)
        usage["quotas"] = collect_codex_rate_limits(log_db)
    else:
        usage["notes"].append("Codex log database was not found.")

    if state_db:
        thread_summary = collect_codex_thread_summary(state_db)
        usage["totals"].update(thread_summary["totals"])
        usage["threads"] = thread_summary["threads"]
    else:
        usage["notes"].append("Codex state database was not found.")

    daily = usage["daily"]
    today = local_day(now)
    usage["totals"]["todayTokens"] = sum(item["tokens"] for item in daily if item["date"] == today)
    usage["totals"]["last7DaysTokens"] = sum(item["tokens"] for item in daily[-7:])
    usage["totals"]["last30DaysTokens"] = sum(item["tokens"] for item in daily[-30:])
    usage["totals"]["observedTokens"] = sum(item["tokens"] for item in daily)
    return usage


def collect_cached_usage(days: int = 90, ttl_seconds: int = 30) -> dict[str, Any]:
    now = int(time.time())
    key = f"codex:{days}"
    with USAGE_CACHE_LOCK:
        cached_value = USAGE_CACHE["value"]
        effective_ttl = ttl_seconds
        if isinstance(cached_value, dict) and not cached_value.get("quotas"):
            effective_ttl = 5
        if (
            USAGE_CACHE["key"] == key
            and cached_value is not None
            and now - USAGE_CACHE["ts"] < effective_ttl
        ):
            return cached_value

    usage = collect_codex_usage(days)
    with USAGE_CACHE_LOCK:
        USAGE_CACHE.update({"key": key, "ts": now, "value": usage})
    return usage


def collect_codex_daily_usage(log_db: Path, since: int) -> list[dict[str, Any]]:
    by_turn: dict[str, dict[str, Any]] = {}
    try:
        with closing(connect_readonly(log_db)) as conn:
            rows = conn.execute(
                """
                SELECT ts, feedback_log_body
                FROM logs
                WHERE ts >= ?
                  AND feedback_log_body LIKE '%total_usage_tokens=%'
                  AND target = 'codex_core::session::turn'
                  AND feedback_log_body NOT LIKE '%ToolCall:%'
                ORDER BY ts ASC
                LIMIT 50000
                """,
                (since,),
            ).fetchall()
    except sqlite3.Error:
        return []

    for row in rows:
        body = row["feedback_log_body"] or ""
        match = TURN_USAGE_RE.search(body)
        if not match:
            continue
        turn_id, tokens = match.groups()
        model_match = MODEL_RE.search(body)
        model = model_match.group(1) if model_match else "unknown"
        token_count = int(tokens)
        current = by_turn.get(turn_id)
        if current is None or token_count > current["tokens"]:
            by_turn[turn_id] = {
                "ts": row["ts"],
                "date": local_day(row["ts"]),
                "model": model,
                "tokens": token_count,
            }

    days: dict[str, dict[str, Any]] = {}
    for item in by_turn.values():
        day = days.setdefault(
            item["date"],
            {"date": item["date"], "tokens": 0, "turns": 0, "models": {}},
        )
        day["tokens"] += item["tokens"]
        day["turns"] += 1
        day["models"][item["model"]] = day["models"].get(item["model"], 0) + item["tokens"]

    return [days[key] for key in sorted(days)]


def collect_codex_thread_summary(state_db: Path) -> dict[str, Any]:
    try:
        with closing(connect_readonly(state_db)) as conn:
            totals = conn.execute(
                """
                SELECT COUNT(*) AS thread_count, COALESCE(SUM(tokens_used), 0) AS total_tokens
                FROM threads
                WHERE model_provider = 'openai'
                """
            ).fetchone()
            rows = conn.execute(
                """
                SELECT id, title, model, tokens_used, updated_at
                FROM threads
                WHERE model_provider = 'openai'
                ORDER BY updated_at DESC
                LIMIT 8
                """
            ).fetchall()
    except sqlite3.Error:
        return {"totals": {"threadTotalTokens": 0, "threadCount": 0}, "threads": []}

    threads = [
        {
            "id": row["id"],
            "title": row["title"] or "Untitled",
            "model": row["model"] or "unknown",
            "tokens": row["tokens_used"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]
    return {
        "totals": {
            "threadTotalTokens": int(totals["total_tokens"] or 0),
            "threadCount": int(totals["thread_count"] or 0),
        },
        "threads": threads,
    }


def collect_codex_rate_limits(log_db: Path) -> list[dict[str, Any]]:
    try:
        with closing(connect_readonly(log_db)) as conn:
            rows = conn.execute(
                """
                SELECT ts, feedback_log_body
                FROM logs
                WHERE target = 'log'
                  AND feedback_log_body LIKE 'Received message {"type":"codex.rate_limits"%'
                ORDER BY ts DESC, ts_nanos DESC
                LIMIT 20
                """
            ).fetchall()
    except sqlite3.Error:
        return []

    for row in rows:
        payload = parse_json_payload(row["feedback_log_body"] or "")
        if payload.get("type") != "codex.rate_limits":
            continue
        return normalize_rate_limits(payload, row["ts"])
    return []


def parse_json_payload(value: str) -> dict[str, Any]:
    start = value.find("{")
    if start < 0:
        return {}
    try:
        return json.loads(value[start:])
    except json.JSONDecodeError:
        return {}


def normalize_rate_limits(payload: dict[str, Any], observed_at: int) -> list[dict[str, Any]]:
    rate_limits = payload.get("rate_limits") or {}
    quotas = []
    for key, label in (("primary", "5시간"), ("secondary", "1주")):
        limit = rate_limits.get(key)
        if isinstance(limit, dict):
            quotas.append(normalize_limit(label, key, limit, observed_at, payload.get("plan_type")))

    additional = payload.get("additional_rate_limits") or {}
    for name, limits in sorted(additional.items()):
        if not isinstance(limits, dict):
            continue
        primary = limits.get("primary")
        if isinstance(primary, dict):
            quotas.append(normalize_limit(name, "model", primary, observed_at, payload.get("plan_type")))

    return quotas


def normalize_limit(
    label: str, kind: str, limit: dict[str, Any], observed_at: int, plan_type: str | None
) -> dict[str, Any]:
    used_percent = int(limit.get("used_percent") or 0)
    reset_at = int(limit.get("reset_at") or 0)
    return {
        "label": label,
        "kind": kind,
        "planType": plan_type or "unknown",
        "usedPercent": used_percent,
        "remainingPercent": max(0, 100 - used_percent),
        "windowMinutes": limit.get("window_minutes"),
        "resetAt": reset_at,
        "resetAfterSeconds": max(0, reset_at - observed_at) if reset_at else None,
        "limitReached": bool(limit.get("limit_reached")),
        "allowed": bool(limit.get("allowed", True)),
        "observedAt": observed_at,
    }


class SnapshotStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with closing(self._connect()) as conn, conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS snapshots (
                    ts INTEGER PRIMARY KEY,
                    activity_score INTEGER NOT NULL,
                    activity_status TEXT NOT NULL,
                    active_process_count INTEGER NOT NULL,
                    total_cpu REAL NOT NULL,
                    total_memory REAL NOT NULL,
                    providers_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts INTEGER NOT NULL,
                    level TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    message TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
                """
            )

    def add_snapshot(self, snapshot: dict[str, Any]) -> None:
        activity = snapshot["activity"]
        with self.lock, closing(self._connect()) as conn, conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO snapshots
                (ts, activity_score, activity_status, active_process_count, total_cpu, total_memory, providers_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    snapshot["timestamp"],
                    activity["score"],
                    activity["status"],
                    activity["activeProcessCount"],
                    activity["totalCpu"],
                    activity["totalMemory"],
                    json.dumps(snapshot["providers"]),
                ),
            )

    def add_event(self, level: str, provider: str, message: str, ts: int | None = None) -> None:
        with self.lock, closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO events (ts, level, provider, message) VALUES (?, ?, ?, ?)",
                (ts or int(time.time()), level, provider, message),
            )

    def latest_snapshot(self) -> dict[str, Any] | None:
        with self.lock, closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT * FROM snapshots ORDER BY ts DESC LIMIT 1"
            ).fetchone()
        return self._row_to_snapshot(row) if row else None

    def history(self, minutes: int = 180) -> list[dict[str, Any]]:
        since = int(time.time()) - max(1, min(minutes, 24 * 60)) * 60
        with self.lock, closing(self._connect()) as conn:
            rows = conn.execute(
                """
                SELECT ts, activity_score, activity_status, active_process_count, total_cpu, total_memory
                FROM snapshots
                WHERE ts >= ?
                ORDER BY ts ASC
                LIMIT 1440
                """,
                (since,),
            ).fetchall()
        return [dict(row) for row in rows]

    def events(self, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 300))
        with self.lock, closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT ts, level, provider, message FROM events ORDER BY ts DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def _row_to_snapshot(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "timestamp": row["ts"],
            "hostname": socket.gethostname(),
            "localIps": local_ips(),
            "activity": {
                "score": row["activity_score"],
                "status": row["activity_status"],
                "activeProcessCount": row["active_process_count"],
                "totalCpu": row["total_cpu"],
                "totalMemory": row["total_memory"],
            },
            "providers": json.loads(row["providers_json"]),
        }


class Monitor:
    def __init__(self, store: SnapshotStore, interval: float) -> None:
        self.store = store
        self.interval = interval
        self.stop_event = threading.Event()
        self.last_status: dict[str, str] = {}

    def start(self) -> threading.Thread:
        thread = threading.Thread(target=self.run, name="agent-monitor", daemon=True)
        thread.start()
        return thread

    def run(self) -> None:
        while not self.stop_event.is_set():
            snapshot = summarize_processes(load_processes())
            self.store.add_snapshot(snapshot)
            self._record_status_changes(snapshot)
            self.stop_event.wait(self.interval)

    def _record_status_changes(self, snapshot: dict[str, Any]) -> None:
        ts = snapshot["timestamp"]
        for provider in snapshot["providers"]:
            previous = self.last_status.get(provider["key"])
            current = provider["status"]
            self.last_status[provider["key"]] = current
            if previous is None or previous == current:
                continue
            if previous == "offline" and current != "offline":
                self.store.add_event(
                    "info",
                    provider["name"],
                    f"{provider['name']} detected ({provider['processCount']} process)",
                    ts,
                )
            elif current == "offline":
                self.store.add_event("info", provider["name"], f"{provider['name']} stopped", ts)
            else:
                self.store.add_event(
                    "debug",
                    provider["name"],
                    f"{provider['name']} changed from {previous} to {current}",
                    ts,
                )


class AgentWatchHandler(SimpleHTTPRequestHandler):
    server_version = "AgentWatch/0.1"

    def __init__(self, *args: Any, directory: str | None = None, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    @property
    def store(self) -> SnapshotStore:
        return self.server.store  # type: ignore[attr-defined]

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/snapshot":
            snapshot = self.store.latest_snapshot() or summarize_processes(load_processes())
            self.write_json(snapshot)
            return
        if parsed.path == "/api/history":
            minutes = int(parse_qs(parsed.query).get("minutes", ["180"])[0])
            self.write_json({"history": self.store.history(minutes)})
            return
        if parsed.path == "/api/events":
            limit = int(parse_qs(parsed.query).get("limit", ["100"])[0])
            self.write_json({"events": self.store.events(limit)})
            return
        if parsed.path == "/api/usage":
            days = int(parse_qs(parsed.query).get("days", ["90"])[0])
            self.write_json({"usage": [collect_cached_usage(days)]})
            return
        if parsed.path == "/healthz":
            self.write_json({"ok": True, "time": int(time.time())})
            return
        super().do_GET()

    def write_json(self, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] {self.address_string()} {format % args}")


class AgentWatchServer(ThreadingHTTPServer):
    store: SnapshotStore


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Monitor LLM agent processes over the local network.")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address. Use 0.0.0.0 for LAN access.")
    parser.add_argument("--port", default=8765, type=int, help="HTTP port.")
    parser.add_argument("--interval", default=2.0, type=float, help="Snapshot interval in seconds.")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="SQLite database path.")
    parser.add_argument("--once", action="store_true", help="Print one snapshot as JSON and exit.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.once:
        print(json.dumps(summarize_processes(load_processes()), indent=2))
        return 0

    store = SnapshotStore(Path(args.db))
    monitor = Monitor(store, args.interval)
    monitor.start()

    server = AgentWatchServer((args.host, args.port), AgentWatchHandler)
    server.store = store

    urls = [f"http://127.0.0.1:{args.port}"]
    urls.extend(f"http://{ip}:{args.port}" for ip in local_ips())
    print("AgentWatch is running:")
    for url in dict.fromkeys(urls):
        print(f"  {url}")
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        monitor.stop_event.set()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
