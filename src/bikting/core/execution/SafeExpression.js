/** A deliberately small arithmetic parser. It never evaluates JavaScript. */
export function parseExpression(source) {
  if (typeof source !== 'string' || !source.trim()) throw new TypeError('An expression is required.');
  if (source.length > 1000) throw new RangeError('Expressions are limited to 1000 characters.');
  const tokens = tokenize(source.trim().replaceAll('×', '*').replaceAll('÷', '/'));
  let cursor = 0;
  const peek = () => tokens[cursor];
  const consume = () => tokens[cursor++];
  function expression() {
    let node = term();
    while (peek() === '+' || peek() === '-') { const operator = consume(); node = { type: 'binary', operator, left: node, right: term() }; }
    return node;
  }
  function term() {
    let node = unary();
    while (['*', '/', '%'].includes(peek())) { const operator = consume(); node = { type: 'binary', operator, left: node, right: unary() }; }
    return node;
  }
  function unary() {
    if (peek() === '+' || peek() === '-') return { type: 'unary', operator: consume(), value: unary() };
    return power();
  }
  function power() {
    let node = primary();
    if (peek() === '^') { consume(); node = { type: 'binary', operator: '^', left: node, right: unary() }; }
    return node;
  }
  function primary() {
    const token = consume();
    if (token === '(') { const node = expression(); if (consume() !== ')') throw new SyntaxError('Missing closing parenthesis.'); return node; }
    if (typeof token !== 'string') throw new SyntaxError('Unexpected end of expression.');
    if (/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token)) return { type: 'number', value: Number(token) };
    if (/^[a-z_]\w*$/i.test(token)) return { type: 'variable', name: token };
    throw new SyntaxError(`Unexpected token: ${token}`);
  }
  const ast = expression();
  if (cursor !== tokens.length) throw new SyntaxError(`Unexpected token: ${tokens[cursor]}`);
  return ast;
}

export function evaluateExpression(source, variables = {}) {
  const ast = typeof source === 'string' ? parseExpression(source) : source;
  return evaluateAst(ast, variables);
}

export function evaluateAst(node, variables) {
  if (node.type === 'number') return node.value;
  if (node.type === 'variable') {
    if (!Object.hasOwn(variables, node.name) || !Number.isFinite(Number(variables[node.name]))) throw new ReferenceError(`Missing numeric variable: ${node.name}`);
    return Number(variables[node.name]);
  }
  if (node.type === 'unary') { const value = evaluateAst(node.value, variables); return node.operator === '-' ? -value : value; }
  const left = evaluateAst(node.left, variables);
  const right = evaluateAst(node.right, variables);
  if ((node.operator === '/' || node.operator === '%') && right === 0) throw new RangeError('Division by zero.');
  const result = ({ '+': () => left + right, '-': () => left - right, '*': () => left * right, '/': () => left / right, '%': () => left % right, '^': () => left ** right })[node.operator]?.();
  if (!Number.isFinite(result)) throw new RangeError('Expression result is not finite.');
  return result;
}

function tokenize(source) {
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:([eE][+-]?\d+))?|([a-z_]\w*)|([()+\-*/%^]))/iy;
  let position = 0;
  while (position < source.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(source);
    if (!match) throw new SyntaxError(`Unsupported expression token at position ${position}.`);
    tokens.push(match[1] ? `${match[1]}${match[2] ?? ''}` : match[3] ?? match[4]);
    if (tokens.length > 256) throw new RangeError('Expressions are limited to 256 tokens.');
    position = pattern.lastIndex;
  }
  return tokens;
}
