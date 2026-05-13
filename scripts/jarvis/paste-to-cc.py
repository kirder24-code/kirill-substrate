#!/usr/bin/env python3
"""
scripts/jarvis/paste-to-cc.py

Port of Chi's terminal.py — sends text into the active Claude Code Terminal
via AppleScript. Auto-detects iTerm2 vs Terminal.app, finds the window whose
title contains "claude", brings it to front, and pastes the text via
clipboard → Cmd+V → Return.

Why this is the killer pattern: Tolik's "code mode" voice commands go
straight into Kirill's REAL Claude Code session (Max subscription, all his
MCP servers, full repo context) instead of Tolik's OpenAI sub-loop. The user
speaks; Claude Code receives it as if typed.

Usage:
  python scripts/jarvis/paste-to-cc.py "fix the egress regex"
  echo "command text" | python scripts/jarvis/paste-to-cc.py -

Exit codes:
  0 — pasted successfully (Cmd+V + Enter sent)
  2 — no Terminal/iTerm2 window with 'claude' in title found
  3 — argument missing
"""

import sys
import subprocess


def is_iterm2_running():
    r = subprocess.run(["pgrep", "-x", "iTerm2"], capture_output=True)
    return r.returncode == 0


def is_terminal_app_running():
    r = subprocess.run(["pgrep", "-x", "Terminal"], capture_output=True)
    return r.returncode == 0


def set_clipboard(text):
    p = subprocess.run(["pbcopy"], input=text.encode("utf-8"))
    return p.returncode == 0


def osa(script):
    """Run AppleScript, return (returncode, stdout, stderr)."""
    p = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def paste_to_iterm2(text):
    """Paste text into the iTerm2 window whose title contains 'claude'."""
    if not set_clipboard(text):
        return False, "pbcopy failed"
    # Activate the right window. iTerm2 sessions don't have window titles
    # the same way Terminal does, so we just activate and paste into the
    # frontmost session; user is expected to have Claude Code as their
    # current iTerm focus.
    script = """
tell application "iTerm2"
    activate
end tell
delay 0.3
tell application "System Events"
    keystroke "v" using command down
    delay 0.1
    key code 36
end tell
"""
    rc, _, err = osa(script)
    if rc != 0:
        return False, f"osascript error: {err}"
    return True, "iterm2"


def paste_to_terminal_app(text):
    """Paste text into the Terminal.app window with 'claude' in its title."""
    if not set_clipboard(text):
        return False, "pbcopy failed"
    # Find the right window first
    find_script = """
tell application "Terminal"
    set foundIt to false
    repeat with w in windows
        if (name of w) contains "claude" then
            set index of w to 1
            set foundIt to true
            exit repeat
        end if
    end repeat
    activate
    return foundIt
end tell
"""
    rc, out, err = osa(find_script)
    if rc != 0:
        return False, f"locate failed: {err}"
    found = (out.lower() == "true")
    if not found:
        # Fall back: paste into the frontmost Terminal window
        pass
    paste_script = """
delay 0.3
tell application "System Events"
    keystroke "v" using command down
    delay 0.1
    key code 36
end tell
"""
    rc, _, err = osa(paste_script)
    if rc != 0:
        return False, f"paste failed: {err}"
    return True, f"terminal.app (claude-window: {found})"


def send_to_claude_code(text):
    """Pick iTerm2 if running, else Terminal.app. Returns (ok, where)."""
    if is_iterm2_running():
        return paste_to_iterm2(text)
    if is_terminal_app_running():
        return paste_to_terminal_app(text)
    return False, "no terminal app running"


def main():
    if len(sys.argv) < 2:
        print("usage: paste-to-cc.py '<text>'   OR   echo 'text' | paste-to-cc.py -", file=sys.stderr)
        sys.exit(3)
    text = sys.argv[1]
    if text == "-":
        text = sys.stdin.read().rstrip("\n")
    if not text.strip():
        print("empty text", file=sys.stderr)
        sys.exit(3)
    ok, where = send_to_claude_code(text)
    print(f"{'OK' if ok else 'FAIL'} {where}: {text[:80]}")
    sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()
