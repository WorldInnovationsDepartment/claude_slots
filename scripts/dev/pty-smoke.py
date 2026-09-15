#!/usr/bin/env python3
"""Claude Slots — unified live PTY smoke test for both tiers.

Drives a real `claude` process through a pseudo-terminal (winsize 120x40 by
default, TERM=xterm-256color, COLORTERM=truecolor), sends one prompt, waits,
sends /exit, and always kills the child. Adapted from the fh2/sl-plugin
spike harnesses in this scratchpad (fh_pty_harness.py, pty_harness.py) into
one CLI other agents can call without re-deriving PTY plumbing.

Usage:
  python3 pty-smoke.py --tier 1 --tui default   --prompt "..." --seconds 30 --out /tmp/run1
  python3 pty-smoke.py --tier 2 --tui fullscreen --prompt "..." --seconds 30 --out /tmp/run2

Tier 1: sets CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1, launches with
  --plugin-dir <repo root> --debug
so hooks/hooks.json's "modules": ["./slots.js"] loads as a function-hooks
module (docs/ARCHITECTURE.md §1, §4).

Tier 2: leaves the function-hooks flag UNSET and passes a --settings JSON
that points statusLine at bin/claude-slots-statusline.js with
refreshInterval:1 (docs/ARCHITECTURE.md §5) — the same shape
bin/claude-slots-setup.js --apply would install.

Output (for either tier):
  <out>.bin              raw PTY capture
  <out>.stripped.txt      ANSI/control codes stripped (strip_ansi.py's regex)
  <out>.timeline.json     {timeline:[[t_rel, label], ...], exit_code, args}
Prints to stdout: paths to the three files, an excerpt of the stripped
capture (first/last N lines), and a count of lines containing --marker
(default: the "CLAUDE SLOTS" wordmark baked into every chassis frame per
docs/ART-SPEC.md — a tier-agnostic signal that the machine actually
rendered, since both the Tier 1 render tree and the Tier 2 statusLine draw
that literal wordmark).
"""
import argparse
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_CLAUDE_BIN = os.path.expanduser("~/.local/bin/claude")

ANSI_RE = re.compile(rb'\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][A-Za-z0-9]|[=>NM])')
OTHER_CTRL_RE = re.compile(rb'[\x00-\x08\x0b\x0c\x0e-\x1f]')


def strip_ansi(data: bytes) -> bytes:
    data = ANSI_RE.sub(b'', data)
    data = OTHER_CTRL_RE.sub(b'', data)
    return data


def set_winsize(fd, rows, cols):
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def build_settings(args):
    settings = {"tui": args.tui, "spinnerTipsEnabled": False}
    if args.tier == 2:
        statusline_script = os.path.join(REPO_ROOT, "bin", "claude-slots-statusline.js")
        settings["statusLine"] = {
            "type": "command",
            "command": f'node "{statusline_script}"',
            "refreshInterval": 1,
        }
    if args.extra_settings:
        settings.update(json.loads(args.extra_settings))
    return json.dumps(settings)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tier", type=int, choices=[1, 2], required=True)
    ap.add_argument("--tui", choices=["default", "fullscreen"], default="default")
    ap.add_argument("--prompt", default="Count from 1 to 20, one number per line, then say done.")
    ap.add_argument("--seconds", type=float, default=30.0, help="total capture seconds after sending the prompt (includes any extra-wait)")
    ap.add_argument("--out", required=True, help="output path prefix; writes <out>.bin/.stripped.txt/.timeline.json")
    ap.add_argument("--plugin-dir", default=REPO_ROOT)
    ap.add_argument("--claude-bin", default=DEFAULT_CLAUDE_BIN)
    ap.add_argument("--columns", type=int, default=120)
    ap.add_argument("--rows", type=int, default=40)
    ap.add_argument("--boot-wait", type=float, default=6.0)
    ap.add_argument("--interrupt-after", type=float, default=None, help="seconds after sending the prompt to send ESC (interrupt test)")
    ap.add_argument("--extra-settings", default=None, help="JSON object merged into the built --settings payload")
    ap.add_argument("--marker", default="CLAUDE SLOTS", help="substring to count occurrences of in the stripped capture")
    ap.add_argument("--excerpt-lines", type=int, default=25, help="how many head/tail lines of the stripped capture to print")
    ap.add_argument("--model", default="haiku")
    args = ap.parse_args()

    timeline = []
    t_start = time.time()

    def log(msg):
        rel = round(time.time() - t_start, 3)
        timeline.append([rel, msg])
        sys.stderr.write(f"[{rel:8.3f}] {msg}\n")
        sys.stderr.flush()

    master_fd, slave_fd = pty.openpty()
    set_winsize(slave_fd, args.rows, args.columns)

    env = dict(os.environ)
    env.pop("CLAUDECODE", None)
    env.pop("CLAUDE_CODE_ENTRYPOINT", None)
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["COLUMNS"] = str(args.columns)
    env["LINES"] = str(args.rows)

    if args.tier == 1:
        env["CLAUDE_CODE_ENABLE_FUNCTION_HOOKS"] = "1"
        log("env CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 (tier 1)")
    else:
        env.pop("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS", None)
        log("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS unset (tier 2)")

    settings_json = build_settings(args)

    cmd = [args.claude_bin, "--plugin-dir", args.plugin_dir, "--model", args.model, "--settings", settings_json]
    if args.tier == 1:
        cmd.append("--debug")

    log(f"launching tier={args.tier} tui={args.tui} plugin_dir={args.plugin_dir}")

    proc = subprocess.Popen(
        cmd,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        cwd=REPO_ROOT,
        env=env,
        preexec_fn=os.setsid,
        close_fds=True,
    )
    os.close(slave_fd)

    bin_path = args.out + ".bin"
    cap = open(bin_path, "wb")

    def pump(duration, label=None):
        end = time.time() + duration
        got_any = False
        while time.time() < end:
            remaining = end - time.time()
            if remaining <= 0:
                break
            r, _, _ = select.select([master_fd], [], [], min(0.2, remaining))
            if master_fd in r:
                try:
                    data = os.read(master_fd, 65536)
                except OSError:
                    break
                if not data:
                    break
                cap.write(data)
                cap.flush()
                got_any = True
        if label:
            log(f"pump done ({label}), got_any={got_any}")

    try:
        log(f"waiting for boot ({args.boot_wait}s)")
        pump(args.boot_wait, "boot")

        log(f"sending prompt: {args.prompt!r}")
        os.write(master_fd, args.prompt.encode() + b"\r")
        pump(0.3, "post-send-flush")

        if args.interrupt_after is not None:
            log(f"waiting {args.interrupt_after}s before interrupt")
            pump(args.interrupt_after, "pre-interrupt-wait")
            log("sending ESC (interrupt)")
            os.write(master_fd, b"\x1b")
            pump(0.3, "post-esc-flush")
            remaining = max(0.0, args.seconds - args.interrupt_after)
            log(f"waiting remainder ({remaining}s)")
            pump(remaining, "post-interrupt-wait")
        else:
            log(f"waiting for response ({args.seconds}s)")
            pump(args.seconds, "response-wait")

        log("sending /exit")
        os.write(master_fd, b"/exit\r")
        pump(3.0, "post-exit-wait")

    finally:
        cap.close()
        try:
            proc.terminate()
        except Exception:
            pass
        try:
            proc.wait(timeout=5)
        except Exception:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                pass
        try:
            os.close(master_fd)
        except OSError:
            pass

    log(f"exit_code={proc.returncode}")

    with open(bin_path, "rb") as f:
        raw = f.read()
    stripped = strip_ansi(raw)
    stripped_path = args.out + ".stripped.txt"
    with open(stripped_path, "wb") as f:
        f.write(stripped)

    timeline_path = args.out + ".timeline.json"
    with open(timeline_path, "w") as f:
        json.dump(
            {
                "timeline": timeline,
                "exit_code": proc.returncode,
                "args": {k: v for k, v in vars(args).items()},
            },
            f,
            indent=2,
        )

    lines = stripped.decode("utf-8", errors="replace").splitlines()
    marker_count = sum(1 for ln in lines if args.marker in ln)
    non_blank = [ln for ln in lines if ln.strip()]
    n = args.excerpt_lines
    head = non_blank[:n]
    tail = non_blank[-n:] if len(non_blank) > n else []

    print(f"CAPTURE={bin_path}")
    print(f"STRIPPED={stripped_path}")
    print(f"TIMELINE={timeline_path}")
    print(f"EXIT_CODE={proc.returncode}")
    print(f"MARKER={args.marker!r} COUNT={marker_count}")
    print(f"NON_BLANK_LINES={len(non_blank)}")
    print("--- head ---")
    print("\n".join(head))
    if tail:
        print("--- tail ---")
        print("\n".join(tail))


if __name__ == "__main__":
    main()
