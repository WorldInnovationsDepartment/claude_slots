import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame, span, line, hline, compose, assertRect, frameToPlainText, lineWidth, canvas, place, canvasToLine } from '../lib/frame.js';

test('makeFrame validates width', () => {
  assert.throws(() => makeFrame(0));
  assert.throws(() => makeFrame(-1));
  assert.throws(() => makeFrame('60'));
  assert.deepEqual(makeFrame(10), { width: 10, lines: [] });
});

test('span only carries style keys that are actually set', () => {
  assert.deepEqual(span('hi'), { text: 'hi' });
  assert.deepEqual(span('hi', { color: '#fff', bold: true }), { text: 'hi', color: '#fff', bold: true });
  assert.throws(() => span('a\nb'));
  assert.throws(() => span(42));
});

test('line flattens and drops falsy entries', () => {
  const s1 = span('a');
  const s2 = span('b');
  assert.deepEqual(line(s1, false, s2, null, undefined), [s1, s2]);
  assert.deepEqual(line([s1, s2]), [s1, s2]);
});

test('hline requires a single-width fill char and repeats it', () => {
  const l = hline(5, '=');
  assert.equal(lineWidth(l), 5);
  assert.equal(l[0].text, '=====');
  assert.throws(() => hline(3, '中'));
});

test('canvas/place/canvasToLine: styled runs merge, wide glyphs occupy two columns without a stray span', () => {
  let cv = canvas(6, ' ');
  cv = place(cv, 0, 'AB', { color: '#f00' });
  cv = place(cv, 4, '中', { color: '#0f0' });
  const l = canvasToLine(cv);
  assert.equal(lineWidth(l), 6);
  assert.equal(l.map((s) => s.text).join(''), 'AB  中');
  // no span should ever carry empty text (continuation cells are dropped, not emitted)
  assert.ok(l.every((s) => s.text.length > 0));
});

test('place throws on overflow', () => {
  const cv = canvas(4);
  assert.throws(() => place(cv, 3, 'AB'));
  assert.throws(() => place(cv, -1, 'A'));
});

test('compose builds one line from several placements, later placements win on overlap', () => {
  const l = compose(10, [
    { col: 0, text: '----------' },
    { col: 2, text: 'XX', style: { bold: true } },
  ]);
  assert.equal(lineWidth(l), 10);
  assert.equal(l.map((s) => s.text).join(''), '--XX------');
});

test('assertRect passes a true rectangle through and throws with a per-line diff otherwise', () => {
  const good = { width: 4, lines: [line(span('abcd'))] };
  assert.equal(assertRect(good), good);

  const bad = { width: 4, lines: [line(span('abcd')), line(span('ab'))] };
  assert.throws(() => assertRect(bad), /line 1: width 2 !== 4/);
});

test('frameToPlainText strips styling and joins with newlines', () => {
  const fr = makeFrame(3);
  fr.lines.push(line(span('a', { color: '#f00' }), span('bc')));
  fr.lines.push(line(span('def')));
  assert.equal(frameToPlainText(fr), 'abc\ndef');
});
