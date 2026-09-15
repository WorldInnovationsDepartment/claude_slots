// Claude Slots — RenderElement tree renderer (lib/render-tree.js), Tier 1
//
// Pure ESM, zero dependencies. Frame -> the plain-data element tree a
// function-hooks `ui.render` handler returns (docs/ARCHITECTURE.md §2, and
// claude-code.d.ts's RenderElement/TextProps): a column Box containing one
// Text wrapper per line, each wrapping one Text child per span. Only the
// allow-listed Text props are ever emitted — `color`, `backgroundColor`,
// `bold`, `dimColor`, `inverse` — and only when actually set, since the
// scanner/validator rejects a tree carrying any other prop. A line with no
// spans still emits one Text child (a single space) so it can never
// collapse and shift the rows below it.

function textElement(text, style = {}) {
  const props = {};
  if (style.color) props.color = style.color;
  if (style.bg) props.backgroundColor = style.bg;
  if (style.bold) props.bold = true;
  if (style.dim) props.dimColor = true;
  if (style.inverse) props.inverse = true;
  const el = { type: 'Text', children: [text] };
  if (Object.keys(props).length) el.props = props;
  return el;
}

/**
 * @param {import('./frame.js').Frame} frame
 * @returns {{type:'Box', props:{flexDirection:'column'}, children: object[]}}
 */
export function renderTree(frame) {
  const children = frame.lines.map((lineSpans) => {
    const spanEls = lineSpans.length ? lineSpans.map((s) => textElement(s.text, s)) : [textElement(' ')];
    return { type: 'Text', children: spanEls };
  });
  return { type: 'Box', props: { flexDirection: 'column' }, children };
}

/**
 * Convenience alias for rendering a single-line result Frame (§12) — a
 * transcript result line is structurally just a 1-line Frame, so this is
 * `renderTree` under another name for call sites that want to be explicit
 * about rendering a result rather than a live animation frame.
 * @param {import('./frame.js').Frame} frame
 */
export function renderResultTree(frame) {
  return renderTree(frame);
}
