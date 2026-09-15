import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame, span, line, frameToPlainText } from '../lib/frame.js';
import { renderAnsi } from '../lib/render-ansi.js';
import { renderTree, renderResultTree } from '../lib/render-tree.js';
import * as M from '../lib/machine.js';

function sampleFrame() {
  const fr = makeFrame(6);
  fr.lines.push(line(span('ab', { color: '#ff00aa', bold: true }), span('cd', { dim: true }), span('ef')));
  fr.lines.push(line(span('gh', { inverse: true }), span('ij', { bg: '#112233' }), span('kl')));
  return fr;
}

test('renderAnsi: stripping SGR codes recovers exactly frameToPlainText\'s output', () => {
  const fr = sampleFrame();
  const ansi = renderAnsi(fr);
  // eslint-disable-next-line no-control-regex
  const stripped = ansi.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(stripped, frameToPlainText(fr));
});

test('renderAnsi: truecolor emits 38;2/48;2, and the 256-color fallback stays in the 38;5/48;5 family', () => {
  const fr = sampleFrame();
  const tc = renderAnsi(fr, { truecolor: true });
  assert.match(tc, /\x1b\[[0-9;]*38;2;255;0;170m/);
  const c256 = renderAnsi(fr, { truecolor: false });
  assert.doesNotMatch(c256, /38;2;/);
  assert.match(c256, /38;5;\d+m/);
});

test('renderAnsi: a dim span renders as the flat gray override, not SGR faint (2)', () => {
  const fr = makeFrame(2);
  fr.lines.push(line(span('xx', { dim: true })));
  const out = renderAnsi(fr);
  assert.match(out, /38;2;153;153;153m/); // #999999
  assert.doesNotMatch(out, /\x1b\[2m/); // never SGR "faint"
});

test('renderAnsi: every real spin, at every phase/size sample, round-trips its plain text', () => {
  const st = M.pullLever(M.createState({}), 0, 7);
  const stopped = M.stop(st, 2000, 'answer');
  for (const t of [0, 500, 2100, 2900, 4000]) {
    for (const size of ['compact', 'standard', 'grand']) {
      const fr = M.frame(stopped, t, { size, columns: 90, info: { elapsedMs: t } });
      const ansi = renderAnsi(fr);
      // eslint-disable-next-line no-control-regex
      assert.equal(ansi.replace(/\x1b\[[0-9;]*m/g, ''), frameToPlainText(fr));
    }
  }
});

const ALLOWED_TEXT_PROPS = new Set(['color', 'backgroundColor', 'bold', 'dimColor', 'inverse']);
const ALLOWED_BOX_PROPS = new Set(['flexDirection']);

function walk(node, visit) {
  visit(node);
  for (const child of node.children || []) {
    if (typeof child === 'object' && child !== null) walk(child, visit);
  }
}

test('renderTree: root is a column Box, one Text wrapper per line, props are allow-listed only', () => {
  const fr = sampleFrame();
  const tree = renderTree(fr);
  assert.equal(tree.type, 'Box');
  assert.deepEqual(tree.props, { flexDirection: 'column' });
  assert.equal(tree.children.length, fr.lines.length);

  let textLeafCount = 0;
  walk(tree, (node) => {
    const allowed = node.type === 'Box' ? ALLOWED_BOX_PROPS : ALLOWED_TEXT_PROPS;
    if (node.props) {
      for (const key of Object.keys(node.props)) assert.ok(allowed.has(key), `disallowed prop ${key} on ${node.type}`);
    }
    if (node.type === 'Text' && Array.isArray(node.children) && typeof node.children[0] === 'string') textLeafCount++;
  });
  assert.ok(textLeafCount > 0);
});

test('renderTree: no line ever collapses to an empty children array', () => {
  const fr = makeFrame(3);
  fr.lines.push([]); // a pathological empty line
  fr.lines.push(line(span('abc')));
  const tree = renderTree(fr);
  for (const lineEl of tree.children) {
    assert.ok(Array.isArray(lineEl.children) && lineEl.children.length > 0);
  }
  assert.deepEqual(tree.children[0].children[0].children, [' ']);
});

test('renderTree: line count is preserved across every real phase/size sample', () => {
  const st = M.pullLever(M.createState({}), 0, 45); // a MEDALLION-ish seed is fine, any seed works here
  const stopped = M.stop(st, 2000, 'answer');
  for (const t of [0, 500, 2100, 2900, 4000]) {
    for (const size of ['compact', 'standard', 'grand']) {
      const fr = M.frame(stopped, t, { size, columns: 90, info: { elapsedMs: t } });
      const tree = renderTree(fr);
      assert.equal(tree.children.length, fr.lines.length);
    }
  }
});

test('renderResultTree renders a 1-line result Frame correctly', () => {
  let st = M.createState({});
  st = M.pullLever(st, 0, 7);
  st = M.stop(st, 2000, 'answer');
  const fr = M.resultLine(st, { columns: 60 });
  const tree = renderResultTree(fr);
  assert.equal(tree.children.length, 1);
});
