export type SelectNode = { kind: 'col'; name: string } | { kind: 'star' } | { kind: 'rel'; name: string; children: SelectNode[] };

export class SelectParseError extends Error {}

const TOKEN_RE = /\s*(?:([A-Za-z_][A-Za-z0-9_]*)|(\*)|([(),]))/y;

type Token = { kind: 'ident'; value: string } | { kind: 'star' } | { kind: 'punct'; value: '(' | ')' | ',' };

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  const src = s.trimEnd();
  let pos = 0;
  while (pos < src.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m) throw new SelectParseError('invalid select');
    if (m[1]) out.push({ kind: 'ident', value: m[1] });
    else if (m[2]) out.push({ kind: 'star' });
    else out.push({ kind: 'punct', value: m[3] as '(' | ')' | ',' });
    pos = TOKEN_RE.lastIndex;
  }
  return out;
}

export function parseSelect(s: string): SelectNode[] {
  const tokens = tokenize(s);
  let i = 0;
  const peek = () => tokens[i];
  const isPunct = (t: Token | undefined, v: string) => t?.kind === 'punct' && t.value === v;

  function list(depth: number): SelectNode[] {
    const nodes: SelectNode[] = [];
    for (;;) {
      const t = tokens[i++];
      if (!t) throw new SelectParseError('invalid select');
      if (t.kind === 'star') nodes.push({ kind: 'star' });
      else if (t.kind === 'ident') {
        if (isPunct(peek(), '(')) {
          if (depth > 0) throw new SelectParseError('nested relation');
          i++;
          const children = list(depth + 1);
          if (!isPunct(tokens[i++], ')')) throw new SelectParseError('invalid select');
          nodes.push({ kind: 'rel', name: t.value, children });
        } else nodes.push({ kind: 'col', name: t.value });
      } else throw new SelectParseError('invalid select');
      if (!isPunct(peek(), ',')) return nodes;
      i++;
    }
  }

  const nodes = list(0);
  if (i !== tokens.length) throw new SelectParseError('invalid select');
  return nodes;
}
