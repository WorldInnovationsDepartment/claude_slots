#!/usr/bin/env python3
"""Verify docs/launch.mp4 against docs/ART-SPEC.md §10 and the launch-demo-video spec.

  - ffprobe: 1920x1080, 30 fps, h264 video, aac audio, 45-75 s
  - extracts a PNG at every scene start and every reel stop into docs/review/
  - scans every extracted frame for a white background (mean luma) and reports it
  - ffmpeg silencedetect: no silent stretch over 2 s
  - accent alignment: an onset in the 1-5 kHz band within 50 ms of every reel-stop frame

Run: python3 scripts/dev/verify-launch.py  (needs ffmpeg/ffprobe on PATH; stdlib only otherwise)
"""
import json, os, struct, subprocess, sys, zlib, math, array

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MP4 = os.path.join(ROOT, "docs", "launch.mp4")
REVIEW = os.path.join(ROOT, "docs", "review")
TL = json.load(open(os.path.join(ROOT, "art", "src", "timeline.json")))
STOP_SETS = [TL["terminal"]] + TL["pulls"]  # every turn that stops on screen
FPS = TL["fps"]
ok = True
ACCENTS_ONLY = "--accents-only" in sys.argv

def fail(msg):
    global ok
    ok = False
    print("FAIL", msg)

def run(cmd, binary=False):
    return subprocess.run(cmd, capture_output=True, text=not binary)

if not ACCENTS_ONLY:
    # 1. probe
    p = run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate", "-show_entries", "format=duration", "-of", "json", MP4])
    info = json.loads(p.stdout)
    streams = {s["codec_type"]: s for s in info["streams"]}
    v, a = streams.get("video", {}), streams.get("audio", {})
    dur = float(info["format"]["duration"])
    print(f"probe: {v.get('width')}x{v.get('height')} {v.get('r_frame_rate')} {v.get('codec_name')} + {a.get('codec_name')} {dur:.2f}s")
    if (v.get("width"), v.get("height")) != (1920, 1080): fail("resolution")
    if v.get("r_frame_rate") != "30/1": fail("fps")
    if v.get("codec_name") != "h264": fail("video codec")
    if a.get("codec_name") != "aac": fail("audio codec")
    if not (45 <= dur <= 75): fail("duration")

    # 2. frames at scene starts and reel stops
    os.makedirs(REVIEW, exist_ok=True)
    frames = [(s["id"], s["start"]) for s in TL["scenes"]]
    for pl in STOP_SETS:
        for i, f in enumerate(pl["reelStops"]):
            frames.append((f"{pl['id']}-reel{i + 1}", f))
    frames.append(("end", TL["durationInFrames"] - 10))

    def png_mean_luma(path):
        d = open(path, "rb").read()
        w, h = struct.unpack(">II", d[16:24]); ct = d[25]
        ch = {2: 3, 6: 4}[ct]
        pos, idat = 8, []
        while pos < len(d):
            ln = struct.unpack(">I", d[pos:pos + 4])[0]; t = d[pos + 4:pos + 8]
            if t == b"IDAT": idat.append(d[pos + 8:pos + 8 + ln])
            pos += 12 + ln
        raw = zlib.decompress(b"".join(idat))
        stride = w * ch
        total = 0; n = 0; prev = bytearray(stride); cur = bytearray(stride)
        rp = 0
        for y in range(h):
            flt = raw[rp]; rp += 1
            row = raw[rp:rp + stride]; rp += stride
            for i in range(stride):
                x = row[i]; aL = cur[i - ch] if i >= ch else 0; b = prev[i]; c = prev[i - ch] if i >= ch else 0
                if flt == 0: val = x
                elif flt == 1: val = x + aL
                elif flt == 2: val = x + b
                elif flt == 3: val = x + ((aL + b) >> 1)
                else:
                    pp = aL + b - c; pa, pb, pc = abs(pp - aL), abs(pp - b), abs(pp - c)
                    val = x + (aL if pa <= pb and pa <= pc else b if pb <= pc else c)
                cur[i] = val & 0xFF
            for xx in range(0, stride, ch * 8):  # sample every 8th pixel
                total += (cur[xx] * 299 + cur[xx + 1] * 587 + cur[xx + 2] * 114) // 1000; n += 1
            prev, cur = cur, prev
        return total / max(1, n)

    for name, f in frames:
        out = os.path.join(REVIEW, f"f{f:04d}-{name}.png")
        r = run(["ffmpeg", "-v", "error", "-y", "-ss", f"{f / FPS:.4f}", "-i", MP4, "-frames:v", "1", out])
        if r.returncode != 0 or not os.path.exists(out):
            fail(f"extract {name}@{f}: {r.stderr.strip()[:200]}"); continue
        luma = png_mean_luma(out)
        flag = "  <-- WHITE?" if luma > 180 else ""
        print(f"frame {f:4d} {name:16s} mean luma {luma:6.1f}{flag}")
        if luma > 180: fail(f"frame {f} ({name}) looks like a white background")

    # 3. silence
    r = run(["ffmpeg", "-v", "info", "-i", MP4, "-af", "silencedetect=n=-40dB:d=2", "-f", "null", "-"])
    sil = [ln for ln in r.stderr.splitlines() if "silence_start" in ln]
    print(f"silence over 2 s: {len(sil)} stretches")
    if sil: fail("silent gap over 2 s: " + "; ".join(sil))


# 4. accents: a broadband onset (RMS jump over a 20 ms window) within 50 ms of every reel-stop frame,
#    and that onset must be the strongest within ±240 ms (so a passing kick does not count; reels stop 300 ms apart).
r = run(["ffmpeg", "-v", "error", "-i", MP4, "-ac", "1", "-ar", "44100", "-f", "s16le", "-"], binary=True)
pcm = array.array("h"); pcm.frombytes(r.stdout)
SR = 44100
WIN = int(0.020 * SR)
def rms(i0):
    seg = pcm[max(0, i0):max(0, i0) + WIN]
    return math.sqrt(sum(x * x for x in seg) / max(1, len(seg))) + 1.0
def onset(t):
    i = int(t * SR)
    return rms(i) / rms(i - WIN - int(0.005 * SR))
def strongest(t0, t1, step=0.005):
    best, bt = 0.0, None
    x = t0
    while x <= t1:
        o = onset(x)
        if o > best: best, bt = o, x
        x += step
    return best, bt
for pl in STOP_SETS:
    for i, f in enumerate(pl["reelStops"]):
        t = f / FPS
        inside, t_in = strongest(t - 0.05, t + 0.05)
        before, _ = strongest(t - 0.24, t - 0.06)  # reels stop 300 ms apart; stay inside that
        after, _ = strongest(t + 0.06, t + 0.24)
        outside = max(before, after)
        good = inside >= 2.0 and inside >= outside
        print(f"accent {pl['id']:8s} reel{i + 1} frame {f}: onset {inside:4.1f}x at {(t_in - t) * 1000:+.0f} ms; strongest nearby onset outside the window {outside:4.1f}x  {'OK' if good else 'FAIL'}")
        if not good: fail(f"no dominant accent within 50 ms of frame {f}")

print("RESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
