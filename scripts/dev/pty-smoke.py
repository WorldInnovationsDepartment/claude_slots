#!/usr/bin/env python3
"""Claude Slots — live PTY smoke test for the mod.

Drives a real `claude` process through a pseudo-terminal (winsize 120x40 by
default, TERM=xterm-256color, COLORTERM=truecolor), sends one prompt, waits,
sends /exit, and always kills the child. Launches with
  --plugin-dir <repo root>
so hooks/hooks.json's "modules": ["./slots.js"] loads as a mod (mods are on
by default since Claude Code 2.1.287; no env flag).

Usage:
  python3 pty-smoke.py --tui default    --prompt "..." --seconds 30 --out /tmp/run1
  python3 pty-smoke.py --tui fullscreen --prompt "..." --seconds 30 --out /tmp/run2

Output:
  <out>.bin              raw PTY capture
  <out>.stripped.txt      ANSI/control codes stripped
  <out>.timeline.json     {timeline:[[t_rel, label], ...], exit_code, args, sprite_checks}
  <out>.screens.txt       (with pyte installed) periodic reconstructions of the screen

The marker counted in the stripped capture is `▀` (U+2580), the half-block
cell every sprite row is made of: it never appears elsewhere in the UI, so
its presence is the signal that the machine actually rendered.

With `pyte` importable, the screen is reconstructed every --snapshot-every
seconds and each snapshot is checked for the sprite rectangle: a block of 10
consecutive rows that each hold a run of 40 `▀` cells in the same columns.
A snapshot with `▀` rows but no clean 40x10 block is reported as a partial
sprite (stale text inside the rectangle, or a torn redraw).
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

try:
    import pyte  # type: ignore
except Exception:  # pragma: no cover - optional
    pyte = None

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_CLAUDE_BIN = os.path.expanduser("~/.local/bin/claude")
MARKER = "▀"

ANSI_RE = re.compile(rb'\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][A-Za-z0-9]|[=>NM])')
OTHER_CTRL_RE = re.compile(rb'[\x00-\x08\x0b\x0c\x0e-\x1f]')


def strip_ansi(data: bytes) -> bytes:
    data = ANSI_RE.sub(b'', data)
    data = OTHER_CTRL_RE.sub(b'', data)
    return data


def set_winsize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def sprite_check(lines, width=40, height=10):
    """Return (status, detail) for one screen snapshot."""
    runs = []  # (row, start_col) of a run of >= width markers
    marker_rows = []
    for r, line in enumerate(lines):
        if MARKER not in line:
            continue
        marker_rows.append(r)
        m = re.search(MARKER + "{%d,}" % width, line)
        if m:
            runs.append((r, m.start()))
    if not marker_rows:
        return "none", {}
    # find a vertical block of `height` consecutive rows sharing a start column
    by_col = {}
    for r, c in runs:
        by_col.setdefault(c, []).append(r)
    for c, rows in by_col.items():
        rows = sorted(rows)
        streak = 1
        for i in range(1, len(rows)):
            streak = streak + 1 if rows[i] == rows[i - 1] + 1 else 1
            if streak >= height:
                top = rows[i] - height + 1
                block = [ln[c:c + width] for ln in lines[top:top + height]]
                clean = all(len(b) == width and set(b) == {MARKER} for b in block)
                return ("clean" if clean else "dirty"), {"top": top, "col": c}
    return "partial", {"marker_rows": marker_rows, "runs": runs}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tui", choices=["default", "fullscreen"], default="default")
    ap.add_argument("--prompt", default="Count from 1 to 40, one number per line, then say done.")
    ap.add_argument("--seconds", type=float, default=30.0, help="capture seconds after sending the prompt")
    ap.add_argument("--prompt2", default=None, help="a second prompt sent after --seconds, waited for another --seconds")
    ap.add_argument("--out", required=True, help="output path prefix")
    ap.add_argument("--plugin-dir", default=REPO_ROOT)
    ap.add_argument("--claude-bin", default=DEFAULT_CLAUDE_BIN)
    ap.add_argument("--columns", type=int, default=120)
    ap.add_argument("--rows", type=int, default=40)
    ap.add_argument("--boot-wait", type=float, default=6.0)
    ap.add_argument("--interrupt-after", type=float, default=None, help="seconds after the prompt to send ESC")
    ap.add_argument("--extra-settings", default=None, help="JSON object merged into the --settings payload")
    ap.add_argument("--snapshot-every", type=float, default=0.5)
    ap.add_argument("--excerpt-lines", type=int, default=25)
    ap.add_argument("--model", default="haiku")
    ap.add_argument("--debug", action="store_true", help="pass --debug to claude")
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
    for k in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS"):
        env.pop(k, None)
    env.update({"TERM": "xterm-256color", "COLORTERM": "truecolor", "COLUMNS": str(args.columns), "LINES": str(args.rows)})

    settings = {"tui": args.tui, "spinnerTipsEnabled": False}
    if args.extra_settings:
        settings.update(json.loads(args.extra_settings))
    cmd = [args.claude_bin, "--plugin-dir", args.plugin_dir, "--model", args.model, "--settings", json.dumps(settings)]
    if args.debug:
        cmd.append("--debug")
    log(f"launching tui={args.tui} plugin_dir={args.plugin_dir}")

    proc = subprocess.Popen(cmd, stdin=slave_fd, stdout=slave_fd, stderr=slave_fd, cwd=REPO_ROOT, env=env, preexec_fn=os.setsid, close_fds=True)
    os.close(slave_fd)

    cap = open(args.out + ".bin", "wb")
    screen = stream = None
    if pyte is not None:
        screen = pyte.Screen(args.columns, args.rows)
        stream = pyte.ByteStream(screen)
    snapshots = []  # (t_rel, phase_label, status, detail, lines)
    last_snap = [0.0]

    def snapshot(label):
        if screen is None:
            return
        lines = screen.display
        status, detail = sprite_check(lines)
        snapshots.append((round(time.time() - t_start, 3), label, status, detail, list(lines)))

    def pump(duration, label):
        end = time.time() + duration
        while time.time() < end:
            remaining = end - time.time()
            r, _, _ = select.select([master_fd], [], [], min(0.2, max(0.0, remaining)))
            if master_fd in r:
                try:
                    data = os.read(master_fd, 65536)
                except OSError:
                    break
                if not data:
                    break
                cap.write(data)
                cap.flush()
                if stream is not None:
                    stream.feed(data)
            if time.time() - last_snap[0] >= args.snapshot_every:
                last_snap[0] = time.time()
                snapshot(label)
        log(f"pump done ({label})")

    try:
        pump(args.boot_wait, "boot")
        snapshot("pre-prompt")
        log(f"sending prompt: {args.prompt!r}")
        os.write(master_fd, args.prompt.encode() + b"\r")
        pump(0.3, "post-send")
        if args.interrupt_after is not None:
            pump(args.interrupt_after, "turn")
            log("sending ESC (interrupt)")
            os.write(master_fd, b"\x1b")
            pump(max(0.0, args.seconds - args.interrupt_after), "post-interrupt")
        else:
            pump(args.seconds, "turn")
        if args.prompt2:
            snapshot("between-prompts")
            log(f"sending prompt 2: {args.prompt2!r}")
            os.write(master_fd, args.prompt2.encode() + b"\r")
            pump(0.3, "post-send-2")
            pump(args.seconds, "turn-2")
        snapshot("end-of-wait")
        log("sending /exit")
        os.write(master_fd, b"/exit\r")
        pump(3.0, "post-exit")
    finally:
        cap.close()
        try:
            proc.terminate()
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

    raw = open(args.out + ".bin", "rb").read()
    stripped = strip_ansi(raw)
    with open(args.out + ".stripped.txt", "wb") as f:
        f.write(stripped)

    checks = [{"t": t, "label": lb, "status": st, "detail": d} for (t, lb, st, d, _) in snapshots]
    with open(args.out + ".timeline.json", "w") as f:
        json.dump({"timeline": timeline, "exit_code": proc.returncode, "args": vars(args), "sprite_checks": checks}, f, indent=2)
    if snapshots:
        with open(args.out + ".screens.txt", "w") as f:
            for (t, lb, st, d, lines) in snapshots:
                f.write(f"===== t={t} {lb} sprite={st} {json.dumps(d)} =====\n")
                f.write("\n".join(ln.rstrip() for ln in lines) + "\n\n")

    text = stripped.decode("utf-8", errors="replace")
    lines = text.splitlines()
    marker_lines = sum(1 for ln in lines if MARKER in ln)
    non_blank = [ln for ln in lines if ln.strip()]
    n = args.excerpt_lines
    print(f"CAPTURE={args.out}.bin")
    print(f"STRIPPED={args.out}.stripped.txt")
    print(f"TIMELINE={args.out}.timeline.json")
    print(f"EXIT_CODE={proc.returncode}")
    print(f"MARKER_LINES={marker_lines} MARKER_TOTAL={text.count(MARKER)}")
    print(f"RESULT_LINES={sum(1 for ln in lines if '◈' in ln and 'balance' in ln)}")
    if snapshots:
        summary = {}
        for (_, lb, st, _, _) in snapshots:
            summary.setdefault(lb, {}).setdefault(st, 0)
            summary[lb][st] += 1
        print(f"SPRITE_CHECKS={json.dumps(summary)}")
    print("--- head ---")
    print("\n".join(non_blank[:n]))
    print("--- tail ---")
    print("\n".join(non_blank[-n:]))


if __name__ == "__main__":
    main()
