"""Claude Code hooks for this repo (wired up in settings.json). Reads the hook event as JSON on stdin."""

import json
import re
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTHON = str(ROOT / ".venv/bin/python")


def is_push(command: str) -> bool:
    """True if any shell segment of the command is a `git push` that is not a branch deletion."""
    for segment in re.split(r"&&|\|\||[;|\n]", command):
        try:
            tokens = shlex.split(segment)
        except ValueError:
            continue
        if tokens[:1] != ["git"] or "push" not in tokens[1:]:
            continue
        deleting = any(t in ("-d", "--delete") or t.startswith(":") for t in tokens)
        if not deleting:
            return True
    return False


def format_python(path_str: str) -> None:
    """Keep `ruff format --check` (part of make check) green after every Python edit."""
    path = Path(path_str).resolve()
    if path.suffix != ".py" or not path.is_relative_to(ROOT):
        return
    try:
        subprocess.run([PYTHON, "-m", "ruff", "format", "-q", "--force-exclude", str(path)], cwd=ROOT, check=False)  # noqa: S603
    except OSError:
        pass  # no .venv yet: nothing to format with


def guard_push() -> None:
    """CLAUDE.md: run make check before pushing. Block the push until it passes (fail closed)."""
    try:
        result = subprocess.run(["make", "check"], cwd=ROOT, capture_output=True, text=True, check=False)  # noqa: S603, S607
    except OSError as error:
        print(f"Could not run make check ({error}); not pushing.", file=sys.stderr)
        sys.exit(2)
    if result.returncode != 0:
        print("make check failed; fix it before pushing.\n" + (result.stdout + result.stderr)[-3000:], file=sys.stderr)
        sys.exit(2)


def main() -> None:
    event = json.load(sys.stdin)
    tool_input = event.get("tool_input", {})
    if event.get("hook_event_name") == "PostToolUse" and event.get("tool_name") in ("Edit", "Write"):
        format_python(tool_input.get("file_path", ""))
    elif event.get("hook_event_name") == "PreToolUse" and event.get("tool_name") == "Bash":
        if is_push(tool_input.get("command", "")):
            guard_push()


main()
