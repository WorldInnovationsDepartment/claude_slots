#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Frame generator + width verifier for CLAUDE SLOTS - FINAL ART SPEC.
Every frame is built from fixed-width primitives (never hand-typed spacing),
then asserted rectangular before being printed. Output is transcribed
verbatim into FINAL-ART-SPEC.md.
"""

import sys

W = sys.stdout
def out(s=""):
    W.write(s + "\n")

# ---------------------------------------------------------------------------
# STANDARD chassis geometry (48 cols total, 46 interior)
# ---------------------------------------------------------------------------
STD_W = 48
STD_INT = STD_W - 2  # 46

CELL_W = 5           # reel cell interior width (STANDARD/COMPACT)
GCELL_W = 7           # reel cell interior width (GRAND)

REEL_GAP = 1          # spaces between adjacent reel boxes
LEFT_MARGIN_STD = 10  # spaces before reel bay, STANDARD

# Extra columns appended OUTSIDE the chassis's right border for the lever
# arm — reads as its own mounted mechanism, not part of the boxed interior.
LEVER_BAY_WIDTH = 2   # 1 gap column + 1 rod/knob column

def assert_rect(lines, width, label):
    bad = [i for i, l in enumerate(lines) if len(l) != width]
    if bad:
        raise AssertionError(f"{label}: lines {bad} not width {width}: "
                              f"{[len(lines[i]) for i in bad]}")
    return lines

def center(s, w):
    return s.center(w)

def ljust_rjust(left, right, w):
    """left-justify `left`, right-justify `right`, single computed gap."""
    gap = w - len(left) - len(right)
    if gap < 1:
        raise AssertionError(f"no room: {left!r} {right!r} in {w}")
    return left + (" " * gap) + right

# ---------------------------------------------------------------------------
# Reel-cell primitives
# ---------------------------------------------------------------------------
def box_top(hot, w=CELL_W):
    return ("╔" + "═" * w + "╗") if hot else ("┌" + "─" * w + "┐")

def box_bot(hot, w=CELL_W):
    return ("╚" + "═" * w + "╝") if hot else ("└" + "─" * w + "┘")

def box_mid(sym, hot, w=CELL_W):
    wall = "║" if hot else "│"
    return wall + center(sym, w) + wall

def reel_bay_row(kind, syms, hots, payline=False, w=CELL_W, gap=REEL_GAP):
    """kind: 'top'|'mid'|'bot'. syms/hots: length-3 lists (mid only needs syms)."""
    if kind == "top":
        cells = [box_top(hots[i], w) for i in range(3)]
    elif kind == "bot":
        cells = [box_bot(hots[i], w) for i in range(3)]
    else:
        cells = [box_mid(syms[i], hots[i], w) for i in range(3)]
    row = (" " * gap).join(cells)
    if payline:
        row = "▐" + row[1:-1] + "▌"
    return row

# ---------------------------------------------------------------------------
# Lever column (5 body rows: top, above, payline, below, bot)
# ---------------------------------------------------------------------------
def lever_glyphs(knob_row):
    """knob_row in 0..4. Rows above knob show rod '|', knob row shows '*',
    rows below knob show blank. knob_row=0 => idle/up (no rod, bare knob)."""
    g = []
    for r in range(5):
        if r < knob_row:
            g.append("│")
        elif r == knob_row:
            g.append("●")
        else:
            g.append(" ")
    return g

def lever_bay(glyph=" "):
    """2-column bay appended OUTSIDE the chassis's right border for the
    lever arm, instead of placed inside the interior. Always exactly
    LEVER_BAY_WIDTH columns whether or not a glyph is present, so every
    line in the frame stays the same total width."""
    return " " + glyph

# ---------------------------------------------------------------------------
# STANDARD frame builder
# ---------------------------------------------------------------------------
def std_frame(marquee_text, bulbs_left, bulbs_right,
              top_syms, pay_syms, bot_syms,
              hot_cols, knob_row, info_left, info_right,
              outer_hot=False):
    lines = []
    top_border = "╔" + "═" * STD_INT + "╗"
    bot_border = "╚" + "═" * STD_INT + "╝"
    sep = "╠" + "═" * STD_INT + "╣"

    marquee_full = f"{bulbs_left}  {marquee_text}  {bulbs_right}"
    lines.append(top_border + lever_bay())
    lines.append("║" + center(marquee_full, STD_INT) + "║" + lever_bay())
    lines.append(sep + lever_bay())

    lever = lever_glyphs(knob_row)

    def body(kind, syms, lever_glyph):
        reel = reel_bay_row(kind, syms, hot_cols, payline=(kind == "mid" and syms is pay_syms))
        content = (" " * LEFT_MARGIN_STD) + reel
        content = content + " " * (STD_INT - len(content))
        return "║" + content + "║" + lever_bay(lever_glyph)

    lines.append(body("top", [None]*3, lever[0]))
    lines.append(body("mid", top_syms, lever[1]))
    row_pay = reel_bay_row("mid", pay_syms, hot_cols, payline=True)
    content = (" " * LEFT_MARGIN_STD) + row_pay
    content = content + " " * (STD_INT - len(content))
    lines.append("║" + content + "║" + lever_bay(lever[2]))
    lines.append(body("mid", bot_syms, lever[3]))
    lines.append(body("bot", [None]*3, lever[4]))

    lines.append(sep + lever_bay())
    info = ljust_rjust(info_left, info_right, STD_INT)
    lines.append("║" + info + "║" + lever_bay())
    lines.append(bot_border + lever_bay())

    assert_rect(lines, STD_W + LEVER_BAY_WIDTH, "STANDARD:" + marquee_text[:12])
    return lines

def show(lines, tag):
    out(f"### {tag}")
    out("```")
    for l in lines:
        out(l)
    out("```")
    out(f"[width={len(lines[0])} rows={len(lines)}]")
    out()

# ---------------------------------------------------------------------------
# Symbols
# ---------------------------------------------------------------------------
CLAUDE = "✻"
MEDAL = "◆C◆"
TOOL = "BAR"
TEST = "★"
DIFF = "♦"
FILE = "♣"
TOKEN = "☼"
PROSE = "♥"

BULB_A = ("●○●○●", "●○●○●")
BULB_B = ("○●○●○", "○●○●○")
BULB_WIND = ("♦♣☼♠♥", "♦♣☼♠♥")
BULB_HOT = ("★●★●★", "★●★●★")
BULB_ALL_LIT = ("●●●●●", "●●●●●")
BULB_DARK = ("○○○○○", "○○○○○")
BULB_BLUR = ("▓▓▓▓▓", "▓▓▓▓▓")

TITLE = "Lucky Prompt"

# =============================================================================
out("<!-- === GENERATED STANDARD FRAMES (48 cols x 11 rows) === -->")
out()

# 1. IDLE A/B --------------------------------------------------------------
f = std_frame(TITLE, *BULB_A, [DIFF, FILE, TOKEN], [TEST, TOOL, PROSE], [PROSE, DIFF, FILE],
              [False,False,False], 0, "CREDITS: 097   LAST WIN: 008", "")
show(f, "IDLE-A")

f = std_frame(TITLE, *BULB_B, [DIFF, FILE, TOKEN], [TEST, TOOL, PROSE], [PROSE, DIFF, FILE],
              [False,False,False], 0, "CREDITS: 097   LAST WIN: 008", "")
show(f, "IDLE-B")

# 1b. ON THE HOUSE idle wink (0 credits) ------------------------------------
f = std_frame(TITLE, *BULB_A, [DIFF, FILE, TOKEN], [TEST, TOOL, PROSE], [PROSE, DIFF, FILE],
              [False,False,False], 0, "CREDITS: 000 · ON THE HOUSE", "")
show(f, "IDLE-ON-THE-HOUSE")

# 2. LEVER PULL --------------------------------------------------------------
for i, kr in enumerate([0,1,2,3,4]):
    f = std_frame(TITLE, *BULB_WIND, [DIFF, FILE, TOKEN], [TEST, TOOL, PROSE], [PROSE, DIFF, FILE],
                  [False,False,False], kr, "CREDITS: 096   LAST WIN: 008", "...")
    show(f, f"LEVER-PULL-t{i}-knob{kr}")

# 3. SPIN-UP -----------------------------------------------------------------
f = std_frame(TITLE, "▓▒░▒▓", "▓▒░▒▓", ["▒","▒","▒"], ["▓","▓","▓"], ["▒","▒","▒"],
              [False,False,False], 4, "SPINNING...  0:00   0 tok", "")
show(f, "SPIN-UP-1-reel1-winds")

f = std_frame(TITLE, "▒░▓░▒", "▒░▓░▒", ["▓","▒","▒"], ["▓","▓","▓"], ["▓","▒","▒"],
              [False,False,False], 4, "SPINNING...  0:00   0 tok", "")
show(f, "SPIN-UP-2-reel2-winds")

f = std_frame(TITLE, "░▓▒▓░", "░▓▒▓░", ["▓","▓","▓"], ["▓","▓","▓"], ["▓","▓","▓"],
              [False,False,False], 0, "SPINNING...  0:00   0 tok", "")
show(f, "SPIN-UP-3-reel3-winds-lever-back")

# 4. SPINNING ------------------------------------------------------------------
f = std_frame(TITLE, *BULB_BLUR, ["▓","▓","▓"], ["▓","▓","▓"], ["▓","▓","▓"],
              [False,False,False], 0, "SPINNING...  0:07   1.2k tok", "")
show(f, "SPINNING-steady-blur")

f = std_frame(TITLE, "▒▓▒▓▒", "▒▓▒▓▒", ["▒","▓","▒"], ["▒","▓","▒"], ["▒","▓","▒"],
              [False,False,False], 0, "SPINNING...  0:23   4.8k tok", "")
show(f, "SPINNING-speed-ease")

# glint scan-line sweep: 0-1-0-1-0 across the three reel columns, ░▒▓█ gradient
sweeps = [
    (["░","▓","▓"], ["▒","▓","▓"], ["░","▓","▓"]),
    (["▓","▒","▓"], ["▓","░","▓"], ["▓","▒","▓"]),
    (["▓","▓","░"], ["▓","▓","▒"], ["▓","▓","░"]),
]
for i, (t,m,b) in enumerate(sweeps, start=1):
    f = std_frame(TITLE, *BULB_A, t, m, b,
                  [False,False,False], 0, f"SPINNING...  1:0{i}   {i*3}.{i}k tok", "")
    show(f, f"SPINNING-glint-sweep-{i}-of-3")

f = std_frame(TITLE, *BULB_BLUR, ["▓","▓","▓"], ["▓","▓","▓"], ["▓","▓","▓"],
              [False,False,False], 0, "SPINNING...  4:47   62.0k tok", "")
show(f, "SPINNING-long-run")

# 5. STOPPING --------------------------------------------------------------
f = std_frame(TITLE, *BULB_ALL_LIT, [DIFF,"▓","▓"], [TEST,"▓","▓"], [PROSE,"▓","▓"],
              [False,False,False], 0, "WORKING...  DONE.  locking reel 1", "")
show(f, "STOPPING-1-reel1-locks(★)")

f = std_frame(TITLE, *BULB_ALL_LIT, [DIFF,TOOL,"▓"], [TEST,TOOL,"▓"], [PROSE,TOOL,"▓"],
              [False,False,False], 0, "WORKING...  DONE.  locking reel 2", "")
show(f, "STOPPING-2-reel2-locks(BAR)")

# NEAR-MISS overshoot special (payline settling to TEST TEST TOKEN, S=★ so illusory ★★★ for one frame)
f = std_frame(TITLE, *BULB_ALL_LIT, [DIFF,DIFF,"▒"], [TEST,TEST,TEST], [PROSE,PROSE,"▒"],
              [False,False,False], 0, "WORKING...  DONE.  locking reel 3", "")
show(f, "STOPPING-nearmiss-3a-OVERSHOOT(illusory-TEST-TEST-TEST)")

f = std_frame(TITLE, *BULB_ALL_LIT, [DIFF,DIFF,TEST], [TEST,TEST,TOKEN], [PROSE,PROSE,FILE],
              [False,False,False], 0, "CREDITS: 096   LAST WIN: 000", "")
show(f, "STOPPING-nearmiss-3b-SNAP(settles-TEST-TEST-TOKEN)")

# Normal reveal example: TRIPLE BAR (tool call) win, cells go hot immediately
f = std_frame(TITLE, *BULB_HOT, [PROSE,DIFF,CLAUDE], [TOOL,TOOL,TOOL], [FILE,TOKEN,DIFF],
              [True,True,True], 0, "CREDITS: 096   LAST WIN: 000", "")
show(f, "REVEAL-generic-example(TRIPLE-BAR-hot)")

out("<!-- === OUTCOME: JACKPOT ✻✻✻ === -->")
# JACKPOT frames -------------------------------------------------------------
f = std_frame("* * *  J A C K P O T  * * *", "★★★★★", "★★★★★",
              [PROSE,DIFF,FILE], [CLAUDE,CLAUDE,CLAUDE], [TOOL,TOOL,TOOL],
              [True,True,True], 0, "CREDITS: 096   LAST WIN: 000", "")
show(f, "JACKPOT-1-flash")

f = std_frame("J A C K P O T ! ! !", "  ●   ●", "●   ●  ",
              [PROSE,DIFF,FILE], [CLAUDE,CLAUDE,CLAUDE], [TOOL,TOOL,TOOL],
              [True,True,True], 0, "CREDITS: 096   LAST WIN: 000", "")
show(f, "JACKPOT-2-coin-rain-begins")

f = std_frame("J A C K P O T ! ! !", " ●  ● ", " ●  ●",
              [PROSE,DIFF,FILE], [CLAUDE,CLAUDE,CLAUDE], [TOOL,TOOL,TOOL],
              [True,True,True], 0, "CREDITS: 096   LAST WIN: 130", "*** PAYOUT ***")
show(f, "JACKPOT-3-payout-ticking(000-060-150-250)")

f = std_frame("J A C K P O T ! ! !", "  ●  ", "  ●  ",
              [PROSE,DIFF,FILE], [CLAUDE,CLAUDE,CLAUDE], [TOOL,TOOL,TOOL],
              [True,True,True], 0, "CREDITS: 346   LAST WIN: 250", "")
show(f, "JACKPOT-4-settle")

out("<!-- === OUTCOME: MEDALLION ◆C◆◆C◆◆C◆ === -->")
f = std_frame("S I G N A T U R E   C O M B O", "☆●☆●☆", "☆●☆●☆",
              [DIFF,TOKEN,FILE], [MEDAL,MEDAL,MEDAL], [PROSE,CLAUDE,TOOL],
              [True,True,True], 0, "CREDITS: 096   LAST WIN: 000", "")
show(f, "MEDALLION-1-lock")

f = std_frame("C L A U D E !", "  ☆    ", "    ☆  ",
              [DIFF,TOKEN,FILE], [MEDAL,MEDAL,MEDAL], [PROSE,CLAUDE,TOOL],
              [True,True,True], 0, "CREDITS: 096   LAST WIN: 077", "")
show(f, "MEDALLION-2-sunburst")

f = std_frame("S I G N A T U R E   C O M B O", "☆★☆★☆", "☆★☆★☆",
              [DIFF,TOKEN,FILE], [MEDAL,MEDAL,MEDAL], [PROSE,CLAUDE,TOOL],
              [True,True,True], 0, "CREDITS: 173   LAST WIN: 077", "")
show(f, "MEDALLION-3-hold")

out("<!-- === OUTCOME: TRIPLE (worked example: BAR / tool call) === -->")
f = std_frame(TITLE, *BULB_A, [PROSE,DIFF,CLAUDE], [TOOL,TOOL,TOOL], [FILE,TOKEN,DIFF],
              [True,True,True], 0, "CREDITS: 096   LAST WIN: 000", "")
show(f, "TRIPLE-BAR-1-pulse-bright")

f = std_frame(TITLE, *BULB_A, [PROSE,DIFF,CLAUDE], [TOOL,TOOL,TOOL], [FILE,TOKEN,DIFF],
              [False,False,False], 0, "CREDITS: 096   LAST WIN: 000", "")
show(f, "TRIPLE-BAR-2-pulse-dim")

f = std_frame(TITLE, *BULB_ALL_LIT, [PROSE,DIFF,CLAUDE], [TOOL,TOOL,TOOL], [FILE,TOKEN,DIFF],
              [True,True,True], 0, "CREDITS: 136   LAST WIN: 040", "")
show(f, "TRIPLE-BAR-3-settle(counter-000-015-040)")

out("<!-- === OUTCOME: DOUBLE (worked example: prose pair) === -->")
f = std_frame(TITLE, *BULB_A, [FILE,DIFF,TOKEN], [PROSE,PROSE,TOOL], [CLAUDE,FILE,DIFF],
              [True,True,False], 0, "CREDITS: 096   LAST WIN: 000", "")
show(f, "DOUBLE-1-pulse")

f = std_frame(TITLE, *BULB_A, [FILE,DIFF,TOKEN], [PROSE,PROSE,TOOL], [CLAUDE,FILE,DIFF],
              [False,False,False], 0, "CREDITS: 097   LAST WIN: 001", "")
show(f, "DOUBLE-2-settle")

out("<!-- === OUTCOME: NEAR MISS (continues from STOPPING overshoot) === -->")
f = std_frame(TITLE, *BULB_ALL_LIT, [DIFF,DIFF,TEST], [TEST,TEST,TOKEN], [PROSE,PROSE,FILE],
              [False,False,False], 0, "CREDITS: 096   LAST WIN: 000", "")
show(f, "NEARMISS-1-hold-visible")

f = std_frame(TITLE, *BULB_DARK, [DIFF,DIFF,TEST], [TEST,TEST,TOKEN], [PROSE,PROSE,FILE],
              [False,False,False], 0, "SO CLOSE...", "")
show(f, "NEARMISS-2-so-close")

f = std_frame(TITLE, *BULB_A, [DIFF,DIFF,TEST], [TEST,TEST,TOKEN], [PROSE,PROSE,FILE],
              [False,False,False], 0, "CREDITS: 096   LAST WIN: 000", "")
show(f, "NEARMISS-3-fade-to-idle")

out("<!-- === OUTCOME: LOSE === -->")
f = std_frame(TITLE, *BULB_DARK, [FILE,TEST,DIFF], [PROSE,TOOL,TOKEN], [DIFF,FILE,TEST],
              [False,False,False], 0, "CREDITS: 096   LAST WIN: 000", "")
show(f, "LOSE-1-dim")

f = std_frame(TITLE, *BULB_DARK, [FILE,TEST,DIFF], [PROSE,TOOL,TOKEN], [DIFF,FILE,TEST],
              [False,False,False], 0, "no dice, spin again?  o_o", "")
show(f, "LOSE-2-wistful")

f = std_frame(TITLE, *BULB_A, [FILE,TEST,DIFF], [PROSE,TOOL,TOKEN], [DIFF,FILE,TEST],
              [False,False,False], 0, "CREDITS: 096   LAST WIN: 000", "")
show(f, "LOSE-3-relight")

out("<!-- === OUTCOME: ABORTED (esc pressed) === -->")
f = std_frame(TITLE, "▓▒░", "░▒▓", ["▓","░","▒"], ["▒","▓","░"], ["░","▒","▓"],
              [False,False,False], 3, "esc pressed — brake engaged...", "")
show(f, "ABORTED-1-brake-jam")

f = std_frame("I N T E R R U P T E D", "◆ ◆", "◆ ◆", ["—","—","—"], ["—","—","—"], ["—","—","—"],
              [False,False,False], 4, "CREDITS: 097   spin refunded", "")
show(f, "ABORTED-2-settled")

out("<!-- === OUTCOME: ERROR === -->")
f = std_frame(TITLE, "▓▒░", "░▒▓", ["░","░","░"], ["░","░","░"], ["░","░","░"],
              [False,False,False], 3, "hmm, something jammed...", "")
show(f, "ERROR-1-void-blur")

f = std_frame("* * *  E R R O R  * * *", "░ ░", "░ ░", ["—","—","—"], ["—","—","—"], ["—","—","—"],
              [False,False,False], 4, "CREDITS: 096   spin refunded", "")
show(f, "ERROR-2-settled")

out()
out("<!-- === COMPACT (<=40 cols, 1-2 lines) === -->")
COMPACT_W = 40

def compact(s):
    if len(s) > COMPACT_W:
        raise AssertionError(f"compact line too long ({len(s)}): {s!r}")
    return s + " " * (COMPACT_W - len(s))

def show_compact(lines, tag):
    out(f"### {tag}")
    out("```")
    for l in lines:
        out(l)
    out("```")
    out(f"[width<= {COMPACT_W}, each line len={[len(l) for l in lines]}]")
    out()

show_compact([compact("✻   ♦ BAR ✻   cr:097"),
              compact("win:008")], "COMPACT-IDLE")

show_compact([compact("✻   ♦ BAR ✻   cr:000"),
              compact("ON THE HOUSE")], "COMPACT-ON-THE-HOUSE")

show_compact([compact("✻  [▓▓▓ spinning]  cr:096"),
              compact("0:07  1.2k tok")], "COMPACT-SPINNING")

show_compact([compact("♦ BAR ✻ * cr:097 win:008 *")], "ULTRA-COMPACT-IDLE(<=36)")
show_compact([compact("[spinning 0:07 1.2k tok] cr:096")], "ULTRA-COMPACT-SPINNING(<=36)")

show_compact([compact("✻  [✻ ✻ ✻]  JACKPOT +250"),
              compact("cr:346  * * * CLAUDING * * *")], "COMPACT-JACKPOT")

show_compact([compact("✻ [◆C◆|◆C◆|◆C◆] SIGNATURE"),
              compact("cr:173  +77  so claude")], "COMPACT-MEDALLION")

show_compact([compact("✻ [BAR|BAR|BAR] TRIPLE +40")], "COMPACT-TRIPLE")
show_compact([compact("✻ [♥|♥|BAR]  DOUBLE +1")], "COMPACT-DOUBLE")
show_compact([compact("✻ [★|★|☼]  so close...")], "COMPACT-NEARMISS")
show_compact([compact("✻ [♣|★|♦]  no win  cr:096")], "COMPACT-LOSE")
show_compact([compact("✻ [—|—|—]  INTERRUPTED")], "COMPACT-ABORTED")
show_compact([compact("✻ [—|—|—]  ERROR  cr:096")], "COMPACT-ERROR")

out()
out("<!-- === GRAND (<=56 cols, <=11 rows) === -->")
GRAND_W = 56
GRAND_INT = GRAND_W - 2  # 54
LEFT_MARGIN_GRAND = 14

def grand_frame(marquee_text, bulbs_left, bulbs_right,
                top_syms, pay_syms, bot_syms,
                hot_cols, knob_row, info_left, info_right):
    lines = []
    top_border = "╔" + "═" * GRAND_INT + "╗"
    bot_border = "╚" + "═" * GRAND_INT + "╝"
    sep = "╠" + "═" * GRAND_INT + "╣"
    marquee_full = f"{bulbs_left}  {marquee_text}  {bulbs_right}"
    lines.append(top_border + lever_bay())
    lines.append("║" + center(marquee_full, GRAND_INT) + "║" + lever_bay())
    lines.append(sep + lever_bay())
    lever = lever_glyphs(knob_row)

    def body(kind, syms, lever_glyph):
        reel = reel_bay_row(kind, syms, hot_cols, payline=False, w=GCELL_W)
        content = (" " * LEFT_MARGIN_GRAND) + reel
        content = content + " " * (GRAND_INT - len(content))
        return "║" + content + "║" + lever_bay(lever_glyph)

    lines.append(body("top", [None]*3, lever[0]))
    lines.append(body("mid", top_syms, lever[1]))
    row_pay = reel_bay_row("mid", pay_syms, hot_cols, payline=True, w=GCELL_W)
    content = (" " * LEFT_MARGIN_GRAND) + row_pay
    content = content + " " * (GRAND_INT - len(content))
    lines.append("║" + content + "║" + lever_bay(lever[2]))
    lines.append(body("mid", bot_syms, lever[3]))
    lines.append(body("bot", [None]*3, lever[4]))
    lines.append(sep + lever_bay())
    info = ljust_rjust(info_left, info_right, GRAND_INT)
    lines.append("║" + info + "║" + lever_bay())
    lines.append(bot_border + lever_bay())
    assert_rect(lines, GRAND_W + LEVER_BAY_WIDTH, "GRAND:" + marquee_text[:12])
    return lines

f = grand_frame(TITLE, "★●○●○●○★", "★●○●○●○★",
                [DIFF, FILE, TOKEN], [TEST, TOOL, PROSE], [PROSE, DIFF, FILE],
                [False,False,False], 0,
                "CREDITS: 0346   LAST WIN: 0250", "")
show(f, "GRAND-IDLE")

f = grand_frame(TITLE, "░▓▒▓░", "░▓▒▓░",
                ["▓","▓","▓"], ["▓","▓","▓"], ["▓","▓","▓"],
                [False,False,False], 0,
                "SPINNING...  0:47   6.2k tok", "")
show(f, "GRAND-SPINNING")

f = grand_frame("* * *   J A C K P O T   * * *", "☆★☆★☆★☆", "☆★☆★☆★☆",
                [PROSE,DIFF,FILE], [CLAUDE,CLAUDE,CLAUDE], [TOOL,TOOL,TOOL],
                [True,True,True], 0,
                "CREDITS: 0346   LAST WIN: 0250   coin rain", "")
show(f, "GRAND-JACKPOT")

out()
out("ALL FRAMES VERIFIED RECTANGULAR.")
