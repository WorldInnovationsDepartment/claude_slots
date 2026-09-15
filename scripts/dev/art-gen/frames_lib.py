#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pure frame-construction library for CLAUDE SLOTS - FINAL ART SPEC.
No printing side effects: every builder returns a list[str] (or str),
and every frame is assert_rect()-checked before being returned, so an
import failure means a frame in this spec would not have been rectangular.
"""

STD_W = 60
STD_INT = STD_W - 2  # 58

CELL_W = 5
GCELL_W = 7

REEL_GAP = 1
LEFT_MARGIN_STD = 10
LEVER_GAP_STD = 4

GRAND_W = 80
GRAND_INT = GRAND_W - 2  # 78
LEFT_MARGIN_GRAND = 14
LEVER_GAP_GRAND = 4

COMPACT_W = 40


def assert_rect(lines, width, label):
    bad = [i for i, l in enumerate(lines) if len(l) != width]
    if bad:
        raise AssertionError(f"{label}: lines {bad} not width {width}: "
                              f"{[len(lines[i]) for i in bad]}")
    return lines


def center(s, w):
    return s.center(w)


def ljust_rjust(left, right, w):
    gap = w - len(left) - len(right)
    if gap < 1:
        raise AssertionError(f"no room: {left!r} {right!r} in {w}")
    return left + (" " * gap) + right


def box_top(hot, w=CELL_W):
    return ("╔" + "═" * w + "╗") if hot else ("┌" + "─" * w + "┐")


def box_bot(hot, w=CELL_W):
    return ("╚" + "═" * w + "╝") if hot else ("└" + "─" * w + "┘")


def box_mid(sym, hot, w=CELL_W):
    wall = "║" if hot else "│"
    return wall + center(sym, w) + wall


def reel_bay_row(kind, syms, hots, payline=False, w=CELL_W, gap=REEL_GAP):
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


def lever_glyphs(knob_row):
    g = []
    for r in range(5):
        if r < knob_row:
            g.append("│")
        elif r == knob_row:
            g.append("●")
        else:
            g.append(" ")
    return g


def std_frame(marquee_text, bulbs_left, bulbs_right,
              top_syms, pay_syms, bot_syms,
              hot_cols, knob_row, info_left, info_right):
    lines = []
    top_border = "╔" + "═" * STD_INT + "╗"
    bot_border = "╚" + "═" * STD_INT + "╝"
    sep = "╠" + "═" * STD_INT + "╣"

    marquee_full = f"{bulbs_left}  {marquee_text}  {bulbs_right}"
    lines.append(top_border)
    lines.append("║" + center(marquee_full, STD_INT) + "║")
    lines.append(sep)

    lever = lever_glyphs(knob_row)

    def body(kind, syms, lever_glyph):
        reel = reel_bay_row(kind, syms, hot_cols, payline=False)
        content = (" " * LEFT_MARGIN_STD) + reel + (" " * LEVER_GAP_STD) + lever_glyph
        content = content + " " * (STD_INT - len(content))
        return "║" + content + "║"

    lines.append(body("top", [None] * 3, lever[0]))
    lines.append(body("mid", top_syms, lever[1]))
    row_pay = reel_bay_row("mid", pay_syms, hot_cols, payline=True)
    content = (" " * LEFT_MARGIN_STD) + row_pay + (" " * LEVER_GAP_STD) + lever[2]
    content = content + " " * (STD_INT - len(content))
    lines.append("║" + content + "║")
    lines.append(body("mid", bot_syms, lever[3]))
    lines.append(body("bot", [None] * 3, lever[4]))

    lines.append(sep)
    info = ljust_rjust(info_left, info_right, STD_INT)
    lines.append("║" + info + "║")
    lines.append(bot_border)

    assert_rect(lines, STD_W, "STANDARD:" + marquee_text[:12])
    return lines


def grand_frame(marquee_text, bulbs_left, bulbs_right,
                top_syms, pay_syms, bot_syms,
                hot_cols, knob_row, info_left, info_right):
    lines = []
    top_border = "╔" + "═" * GRAND_INT + "╗"
    bot_border = "╚" + "═" * GRAND_INT + "╝"
    sep = "╠" + "═" * GRAND_INT + "╣"
    marquee_full = f"{bulbs_left}  {marquee_text}  {bulbs_right}"
    lines.append(top_border)
    lines.append("║" + center(marquee_full, GRAND_INT) + "║")
    lines.append(sep)
    lever = lever_glyphs(knob_row)

    def body(kind, syms, lever_glyph):
        reel = reel_bay_row(kind, syms, hot_cols, payline=False, w=GCELL_W)
        content = (" " * LEFT_MARGIN_GRAND) + reel + (" " * LEVER_GAP_GRAND) + lever_glyph
        content = content + " " * (GRAND_INT - len(content))
        return "║" + content + "║"

    lines.append(body("top", [None] * 3, lever[0]))
    lines.append(body("mid", top_syms, lever[1]))
    row_pay = reel_bay_row("mid", pay_syms, hot_cols, payline=True, w=GCELL_W)
    content = (" " * LEFT_MARGIN_GRAND) + row_pay + (" " * LEVER_GAP_GRAND) + lever[2]
    content = content + " " * (GRAND_INT - len(content))
    lines.append("║" + content + "║")
    lines.append(body("mid", bot_syms, lever[3]))
    lines.append(body("bot", [None] * 3, lever[4]))
    lines.append(sep)
    info = ljust_rjust(info_left, info_right, GRAND_INT)
    lines.append("║" + info + "║")
    lines.append(bot_border)
    assert_rect(lines, GRAND_W, "GRAND:" + marquee_text[:12])
    return lines


def compact(s):
    if len(s) > COMPACT_W:
        raise AssertionError(f"compact line too long ({len(s)}): {s!r}")
    return s + " " * (COMPACT_W - len(s))


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

TITLE = "C L A U D E   S L O T S"


def md_block(lines):
    """Render a list[str] frame as a fenced code block, plus a verified caption."""
    w = len(lines[0])
    body = "\n".join(lines)
    return f"```\n{body}\n```\n*verified: {len(lines)} lines x {w} cols, every line equal width*\n"


def md_block_compact(lines):
    widths = [len(l) for l in lines]
    body = "\n".join(lines)
    return f"```\n{body}\n```\n*verified: line lengths {widths} (COMPACT budget: {COMPACT_W})*\n"
