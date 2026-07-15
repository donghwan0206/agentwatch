import unittest
import sqlite3
import tempfile
from pathlib import Path

from agent_monitor import (
    ProcessInfo,
    collect_codex_daily_usage,
    normalize_rate_limits,
    sanitize_command,
    summarize_processes,
)


def proc(pid, command, args, cpu=0.2):
    return ProcessInfo(
        pid=pid,
        ppid=1,
        cpu=cpu,
        memory=0.4,
        elapsed="00:01",
        command=command,
        args=args,
    )


class DetectorTest(unittest.TestCase):
    def test_detects_common_agent_cli_processes(self):
        snapshot = summarize_processes(
            [
                proc(101, "node", "node /usr/local/bin/codex --model gpt-5", 4.2),
                proc(102, "node", "node ./node_modules/@anthropic-ai/claude-code/cli.js", 0.1),
                proc(103, "node", "node /usr/bin/gemini", 16.0),
                proc(104, "python", "python worker.py", 8.0),
            ]
        )

        providers = {item["key"]: item for item in snapshot["providers"]}
        self.assertEqual(providers["codex"]["status"], "active")
        self.assertEqual(providers["claude"]["status"], "idle")
        self.assertEqual(providers["gemini"]["status"], "busy")
        self.assertEqual(snapshot["activity"]["activeProcessCount"], 3)

    def test_detects_more_agent_and_local_model_runtimes(self):
        snapshot = summarize_processes(
            [
                proc(201, "python", "python -m aider --model gpt-5", 1.0),
                proc(202, "node", "node ./node_modules/@block/goose/dist/cli.js run", 1.0),
                proc(203, "cursor-agent", "cursor-agent --workspace .", 1.0),
                proc(204, "node", "npx @qwen-code/qwen-code", 1.0),
                proc(205, "ollama", "ollama serve", 1.0),
                proc(206, "LM Studio", "LM Studio Helper", 1.0),
                proc(207, "llama-server", "llama-server -m model.gguf", 1.0),
            ]
        )

        providers = {item["key"]: item for item in snapshot["providers"]}
        for key in [
            "aider",
            "goose",
            "cursor-agent",
            "qwen-code",
            "ollama",
            "lmstudio",
            "llamacpp",
        ]:
            self.assertEqual(providers[key]["status"], "active", key)

    def test_redacts_home_and_secrets_from_commands(self):
        home = str(Path.home())
        command = sanitize_command(f"{home}/project codex api_key=sk-test token=abc123")

        self.assertNotIn(home, command)
        self.assertIn("~/project", command)
        self.assertIn("api_key=<redacted>", command)
        self.assertIn("token=<redacted>", command)


class UsageTest(unittest.TestCase):
    def test_collects_daily_usage_by_turn_max(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "logs.sqlite"
            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    "CREATE TABLE logs (ts INTEGER, target TEXT, feedback_log_body TEXT)"
                )
                conn.executemany(
                    "INSERT INTO logs (ts, target, feedback_log_body) VALUES (?, ?, ?)",
                    [
                        (
                            1783152000,
                            "codex_core::session::turn",
                            "turn_id=turn-a model=gpt-5.5 post sampling token usage total_usage_tokens=100",
                        ),
                        (
                            1783152010,
                            "codex_core::session::turn",
                            "turn_id=turn-a model=gpt-5.5 post sampling token usage total_usage_tokens=130",
                        ),
                        (
                            1783152020,
                            "codex_core::session::turn",
                            "turn_id=turn-b model=gpt-5.4 post sampling token usage total_usage_tokens=70",
                        ),
                    ],
                )

            daily = collect_codex_daily_usage(db_path, 1783150000)

        self.assertEqual(len(daily), 1)
        self.assertEqual(daily[0]["tokens"], 200)
        self.assertEqual(daily[0]["turns"], 2)

    def test_normalizes_rate_limit_percentages(self):
        quotas = normalize_rate_limits(
            {
                "plan_type": "prolite",
                "rate_limits": {
                    "primary": {
                        "allowed": True,
                        "limit_reached": False,
                        "used_percent": 5,
                        "window_minutes": 300,
                        "reset_at": 1783165000,
                    },
                    "secondary": {
                        "allowed": True,
                        "limit_reached": False,
                        "used_percent": 16,
                        "window_minutes": 10080,
                        "reset_at": 1783389970,
                    },
                },
            },
            1783155000,
        )

        self.assertEqual(quotas[0]["label"], "5시간")
        self.assertEqual(quotas[0]["remainingPercent"], 95)
        self.assertEqual(quotas[1]["label"], "1주")
        self.assertEqual(quotas[1]["remainingPercent"], 84)


if __name__ == "__main__":
    unittest.main()
