"""Claude Code hooks for this repo (wired up in settings.json). Reads the hook event as JSON on stdin."""

import json
import re
import subprocess
import sys

event = json.load(sys.stdin)
tool_input = event.get("tool_input", {})

if event.get("hook_event_name") == "PostToolUse":
    # Keep `ruff format --check` (part of make check) green after every Python edit.
    path = tool_input.get("file_path", "")
    if path.endswith(".py"):
        subprocess.run([".venv/bin/python", "-m", "ruff", "format", "-q", path], check=False)  # noqa: S603
elif re.search(r"\bgit\s+push\b", tool_input.get("command", "")):
    # CLAUDE.md: run make check before pushing. Block the push until it passes.
    result = subprocess.run(["make", "check"], capture_output=True, text=True, check=False)  # noqa: S603, S607
    if result.returncode != 0:
        print("make check failed; fix it before pushing.\n" + (result.stdout + result.stderr)[-3000:], file=sys.stderr)
        sys.exit(2)
