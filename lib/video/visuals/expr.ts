/**
 * A tiny, safe recursive-descent evaluator for single-variable math
 * expressions (+ - * / ^, parens, unary minus, sin/cos/tan/sqrt/abs/exp/log,
 * and the variable `x`). Deliberately not `Function()`/`eval()` — plotter
 * content ultimately traces back to LLM output, and compiling that as JS
 * would be a code-injection vector.
 */

type Token = { kind: "num"; value: number } | { kind: "ident"; value: string } | { kind: "op"; value: string };

const FUNCS: Record<string, (n: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  log: Math.log,
};

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ kind: "num", value: Number(src.slice(i, j)) });
      i = j;
    } else if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9]/.test(src[j])) j++;
      tokens.push({ kind: "ident", value: src.slice(i, j) });
      i = j;
    } else if ("+-*/^()".includes(c)) {
      tokens.push({ kind: "op", value: c });
      i++;
    } else {
      throw new Error(`Unexpected character in expression: '${c}'`);
    }
  }
  return tokens;
}

/** Compiles `expr` (a function of `x`) into `(x: number) => number`, throwing on malformed or unsupported input. */
export function compileExpression(expr: string): (x: number) => number {
  const tokens = tokenize(expr);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parsePrimary(x: number): number {
    const tok = next();
    if (!tok) throw new Error("Unexpected end of expression.");
    if (tok.kind === "num") return tok.value;
    if (tok.kind === "ident") {
      if (tok.value === "x") return x;
      if (tok.value === "pi") return Math.PI;
      if (tok.value === "e") return Math.E;
      if (FUNCS[tok.value] && peek()?.value === "(") {
        next();
        const arg = parseExpr(x);
        if (peek()?.value !== ")") throw new Error("Expected ')' after function argument.");
        next();
        return FUNCS[tok.value](arg);
      }
      throw new Error(`Unknown identifier: ${tok.value}`);
    }
    if (tok.value === "(") {
      const v = parseExpr(x);
      if (peek()?.value !== ")") throw new Error("Expected ')'.");
      next();
      return v;
    }
    throw new Error(`Unexpected token: ${tok.value}`);
  }

  function parsePow(x: number): number {
    const base = parsePrimary(x);
    if (peek()?.value === "^") {
      next();
      return Math.pow(base, parseUnary(x)); // right-associative; exponent may itself be negative (2^-1)
    }
    return base;
  }

  // Unary minus binds looser than "^" so "-x^2" parses as -(x^2), matching
  // standard math/Python convention rather than (-x)^2.
  function parseUnary(x: number): number {
    if (peek()?.value === "-") {
      next();
      return -parsePow(x);
    }
    if (peek()?.value === "+") {
      next();
      return parsePow(x);
    }
    return parsePow(x);
  }

  function parseTerm(x: number): number {
    let v = parseUnary(x);
    while (peek()?.kind === "op" && (peek()!.value === "*" || peek()!.value === "/")) {
      const op = next() as { value: string };
      const rhs = parseUnary(x);
      v = op.value === "*" ? v * rhs : v / rhs;
    }
    return v;
  }

  function parseExpr(x: number): number {
    let v = parseTerm(x);
    while (peek()?.kind === "op" && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = next() as { value: string };
      const rhs = parseTerm(x);
      v = op.value === "+" ? v + rhs : v - rhs;
    }
    return v;
  }

  return (x: number) => {
    pos = 0;
    const value = parseExpr(x);
    if (pos !== tokens.length) throw new Error(`Unexpected trailing input at token ${pos} in expression: ${expr}`);
    return value;
  };
}
