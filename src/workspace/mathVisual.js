/** Render a signed result on a scale using only the verified calculator output. */
export function renderMathResult(container, expression, value) {
  container.replaceChildren();
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 560 180');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${expression} equals ${value}; marker on a number line from ${Math.min(0, value)} to ${Math.max(0, value)}`);
  svg.style.cssText = 'width:100%;max-width:560px;height:auto';
  const make = (tag, attributes, label) => {
    const node = document.createElementNS(namespace, tag);
    for (const [key, entry] of Object.entries(attributes)) node.setAttribute(key, String(entry));
    if (label !== undefined) node.textContent = label;
    svg.append(node); return node;
  };
  make('text', { x: 20, y: 42, fill: 'currentColor', 'font-size': 20 }, `${expression} = ${value}`);
  make('line', { x1: 55, y1: 110, x2: 505, y2: 110, stroke: '#789', 'stroke-width': 3 });
  const start = Math.min(0, value), end = Math.max(0, value);
  const position = (number) => start === end ? 280 : 55 + ((number - start) / (end - start)) * 450;
  make('circle', { cx: position(0), cy: 110, r: 6, fill: '#789' });
  make('text', { x: position(0), y: 142, fill: 'currentColor', 'text-anchor': 'middle' }, '0');
  if (value !== 0) {
    make('circle', { cx: position(value), cy: 110, r: 9, fill: '#4cc9a4' });
    make('text', { x: position(value), y: 87, fill: 'currentColor', 'text-anchor': 'middle' }, String(value));
  }
  container.append(svg);
}
