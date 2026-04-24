// Tiny safe evaluator for ActionSpec.available_when expressions.
// Grammar (subset of JS):
//   Expr     := Or
//   Or       := And ('||' And)*
//   And      := Unary ('&&' Unary)*
//   Unary    := '!' Unary | Primary
//   Primary  := '(' Expr ')' | Comparison | Path
//   Comparison := Path ('==' | '!=' | '>' | '<' | '>=' | '<=') Literal
//   Path     := ident ('.' ident)*
//   Literal  := number | 'true' | 'false' | 'null' | "'...'" | '"..."'
//
// No function calls. No arbitrary eval. Rejected tokens → error.

export interface Context {
  session: {
    open: boolean;
    streaming: boolean;
  };
  workbench: { tab: string };
  approvals: { pendingCount: number };
  gates: Record<string, 'green' | 'yellow' | 'red' | 'overridden'>;
}

type Tok = { t: string; v?: string | number | boolean | null };

function tokenize(src: string): Tok[] {
  const tokens: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      tokens.push({ t: c });
      i++;
      continue;
    }
    if (c === '!' && src[i + 1] === '=') {
      tokens.push({ t: '!=' });
      i += 2;
      continue;
    }
    if (c === '=' && src[i + 1] === '=') {
      tokens.push({ t: '==' });
      i += 2;
      continue;
    }
    if (c === '&' && src[i + 1] === '&') {
      tokens.push({ t: '&&' });
      i += 2;
      continue;
    }
    if (c === '|' && src[i + 1] === '|') {
      tokens.push({ t: '||' });
      i += 2;
      continue;
    }
    if (c === '>' || c === '<') {
      if (src[i + 1] === '=') {
        tokens.push({ t: c + '=' });
        i += 2;
        continue;
      }
      tokens.push({ t: c });
      i++;
      continue;
    }
    if (c === '!') {
      tokens.push({ t: '!' });
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) j++;
      tokens.push({ t: 'str', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      tokens.push({ t: 'num', v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_.]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      if (word === 'true' || word === 'false') {
        tokens.push({ t: 'bool', v: word === 'true' });
      } else if (word === 'null') {
        tokens.push({ t: 'null', v: null });
      } else {
        tokens.push({ t: 'ident', v: word });
      }
      i = j;
      continue;
    }
    throw new Error(`unexpected char at ${i}: ${c}`);
  }
  return tokens;
}

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek(): Tok | undefined {
    return this.toks[this.i];
  }
  eat(t: string): Tok {
    const cur = this.toks[this.i];
    if (!cur || cur.t !== t) throw new Error(`expected ${t} at ${this.i}`);
    this.i++;
    return cur;
  }
  parseExpr(ctx: Context): boolean {
    return this.parseOr(ctx);
  }
  parseOr(ctx: Context): boolean {
    let left = this.parseAnd(ctx);
    while (this.peek()?.t === '||') {
      this.eat('||');
      const right = this.parseAnd(ctx);
      left = left || right;
    }
    return left;
  }
  parseAnd(ctx: Context): boolean {
    let left = this.parseUnary(ctx);
    while (this.peek()?.t === '&&') {
      this.eat('&&');
      const right = this.parseUnary(ctx);
      left = left && right;
    }
    return left;
  }
  parseUnary(ctx: Context): boolean {
    if (this.peek()?.t === '!') {
      this.eat('!');
      return !this.parseUnary(ctx);
    }
    return this.parsePrimary(ctx);
  }
  parsePrimary(ctx: Context): boolean {
    const cur = this.peek();
    if (!cur) throw new Error('unexpected eof');
    if (cur.t === '(') {
      this.eat('(');
      const v = this.parseExpr(ctx);
      this.eat(')');
      return v;
    }
    if (cur.t === 'ident') {
      const path = this.readPath();
      const nxt = this.peek();
      if (nxt && ['==', '!=', '>', '<', '>=', '<='].includes(nxt.t)) {
        this.i++;
        const lit = this.readLiteral();
        return compare(resolve(ctx, path), nxt.t, lit);
      }
      // Bare identifier: truthy check.
      return Boolean(resolve(ctx, path));
    }
    throw new Error(`unexpected ${cur.t} at ${this.i}`);
  }
  readPath(): string[] {
    const head = this.eat('ident').v as string;
    const path = head.split('.');
    return path;
  }
  readLiteral(): unknown {
    const cur = this.toks[this.i];
    this.i++;
    if (!cur) throw new Error('expected literal');
    if (cur.t === 'str' || cur.t === 'num' || cur.t === 'bool' || cur.t === 'null')
      return cur.v;
    throw new Error(`expected literal, got ${cur.t}`);
  }
}

function resolve(ctx: Context, path: string[]): unknown {
  let cur: unknown = ctx;
  for (const p of path) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function compare(a: unknown, op: string, b: unknown): boolean {
  switch (op) {
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '>':
      return (a as number) > (b as number);
    case '<':
      return (a as number) < (b as number);
    case '>=':
      return (a as number) >= (b as number);
    case '<=':
      return (a as number) <= (b as number);
    default:
      throw new Error(`unknown op: ${op}`);
  }
}

/** Evaluate an `available_when` expression against context. Returns `true`
 * on parse errors to fail-open (never hides a denied action unexpectedly).
 * Caller already knows: available_when is advisory UX, not security. */
export function evaluate(expr: string | null | undefined, ctx: Context): boolean {
  if (!expr) return true;
  try {
    const toks = tokenize(expr);
    const p = new Parser(toks);
    const result = p.parseExpr(ctx);
    if (p.i !== toks.length) {
      // Unconsumed tokens — reject.
      throw new Error(`unconsumed tokens at ${p.i}`);
    }
    return result;
  } catch (e) {
    console.warn(`[predicate] parse error for "${expr}":`, e);
    return true;
  }
}
