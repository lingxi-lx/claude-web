// The local model's tokenizer (ported from Magpie internal/pii/guard/tokenizer.go, MIT): its tokenizer.json as Hugging
// Face's tokenizers library runs it (XLM-RoBERTa's) — special tokens split out first, then SentencePiece's precompiled
// normalization, a split at whitespace, Metaspace's "▁", and a Unigram model over its pieces. Each token says which
// part of the text ([start, end), UTF-16 indexes) it came from, as the library's offsets do.

export interface Token { id: number; start: number; end: number }
interface NChar { r: string; s: number; e: number }
interface Special { text: string; id: number; lstrip: boolean }

const SPACE = /\s/u;
const utf8Len = (cp: string) => Buffer.byteLength(cp, 'utf8');
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export class Tokenizer {
  private pieces = new Map<string, number>();
  private scores: Float64Array;
  private maxLen = 0;
  private unk: number;
  private unkCost: number;
  private special: Special[] = [];
  private trie: Uint32Array;
  private norm: Buffer;

  constructor(json: any) {
    const model = json?.model;
    if (model?.type !== 'Unigram' || !Array.isArray(model.vocab) || !model.vocab.length) throw new Error(`tokenizer: a ${model?.type} model of ${model?.vocab?.length ?? 0} pieces`);
    this.scores = new Float64Array(model.vocab.length);
    this.unk = Number(model.unk_id ?? 0);
    let least = 0;
    model.vocab.forEach(([p, score]: [string, number], i: number) => {
      this.scores[i] = Number(score);
      if (!this.pieces.has(p)) this.pieces.set(p, i);
      this.maxLen = Math.max(this.maxLen, utf8Len(p));
      least = Math.min(least, this.scores[i]);
    });
    this.unkCost = least - 10;
    for (const a of json.added_tokens ?? []) if (a?.special) this.special.push({ text: String(a.content), id: Number(a.id), lstrip: !!a.lstrip });
    const n = json.normalizer ?? {};
    const cm: string | undefined = n.precompiled_charsmap ?? (Array.isArray(n.normalizers) ? n.normalizers.find((x: any) => x?.precompiled_charsmap)?.precompiled_charsmap : undefined);
    const raw = cm ? Buffer.from(cm, 'base64') : Buffer.alloc(0);
    if (raw.length < 4) throw new Error('tokenizer: no precompiled charsmap');
    const size = raw.readUInt32LE(0);
    if (size % 4 !== 0 || 4 + size > raw.length) throw new Error('tokenizer: bad precompiled charsmap');
    this.trie = new Uint32Array(size / 4);
    for (let i = 0; i < this.trie.length; i++) this.trie[i] = raw.readUInt32LE(4 + 4 * i);
    this.norm = raw.subarray(4 + size);
  }

  /** The text's tokens, without <s> and </s>. */
  encode(text: string): Token[] {
    const out: Token[] = [];
    let at = 0;
    while (at < text.length) {
      let [s, e, id] = this.nextSpecial(text, at);
      if (s < 0) { s = text.length; e = text.length; }
      this.encodePlain(out, text.slice(at, s), at);
      if (id >= 0) out.push({ id, start: s, end: e });
      at = e;
    }
    return out;
  }

  /** The first special token from `at` on (the longest there), with the whitespace before one that strips it. */
  private nextSpecial(text: string, at: number): [number, number, number] {
    let best = -1, end = -1, id = -1;
    for (const sp of this.special) {
      const i = text.indexOf(sp.text, at);
      if (i < 0) continue;
      let s = i;
      const e = i + sp.text.length;
      if (sp.lstrip) while (s > at && SPACE.test(text[s - 1])) s--;
      if (best < 0 || s < best || (s === best && e > end)) { best = s; end = e; id = sp.id; }
    }
    return [best, end, id];
  }

  private encodePlain(out: Token[], text: string, base: number) {
    if (!text) return;
    for (let piece of pretokenize(this.normalize(text, base))) {
      // Metaspace: spaces become ▁, the piece starts with one, and each ▁ starts a word of its own
      piece = piece.map((c) => (c.r === ' ' ? { ...c, r: '▁' } : c));
      if (piece[0].r !== '▁') piece = [{ r: '▁', s: piece[0].s, e: piece[0].e }, ...piece];
      let w = 0;
      for (let i = 1; i <= piece.length; i++) {
        if (i === piece.length || piece[i].r === '▁') { this.unigram(out, piece.slice(w, i)); w = i; }
      }
    }
  }

  /** SentencePiece's precompiled normalization: each grapheme of under 6 bytes looked up whole, else each character. */
  normalize(text: string, base: number): NChar[] {
    const out: NChar[] = [];
    const add = (part: string, at: number, to: string) => {
      const orig: [number, number][] = [];
      let i = 0;
      for (const cp of part) { orig.push([base + at + i, base + at + i + cp.length]); i += cp.length; }
      let k = 0;
      for (const r of to) { const o = orig[Math.min(k, orig.length - 1)]; out.push({ r, s: o[0], e: o[1] }); k++; }
    };
    for (const { segment: gr, index: at } of segmenter.segment(text)) {
      if (utf8Len(gr) < 6) {
        const to = this.transform(gr);
        if (to !== null) { add(gr, at, to); continue; }
      }
      let i = 0;
      for (const cp of gr) {
        const to = this.transform(cp);
        if (to !== null) add(cp, at + i, to);
        else out.push({ r: cp, s: base + at + i, e: base + at + i + cp.length });
        i += cp.length;
      }
    }
    return out;
  }

  /** What the charsmap maps the shortest key at the start of s to (null: no key). */
  private transform(s: string): string | null {
    const t = this.trie;
    const offset = (u: number) => ((u >>> 10) << ((u & (1 << 9)) >>> 6)) >>> 0;
    let pos = 0;
    if (pos >= t.length) return null;
    pos = (pos ^ offset(t[pos])) >>> 0;
    const bytes = Buffer.from(s, 'utf8');
    for (let i = 0; i < bytes.length; i++) {
      const c = bytes[i];
      if (c === 0) break;
      pos = (pos ^ c) >>> 0;
      if (pos >= t.length) return null;
      const u = t[pos];
      if (((u & 0x800000ff) >>> 0) !== c) return null;
      pos = (pos ^ offset(u)) >>> 0;
      if ((u >>> 8) & 1) {
        if (pos >= t.length) return null;
        const at = t[pos] & 0x7fffffff;
        if (at > this.norm.length) return null;
        let end = at;
        while (end < this.norm.length && this.norm[end] !== 0) end++;
        return this.norm.subarray(at, end).toString('utf8');
      }
    }
    return null;
  }

  /** The Viterbi best split of a word into pieces (on a tie the split found first); a run no piece has is one <unk>. */
  private unigram(out: Token[], word: NChar[]) {
    const n = word.length;
    const bytesAt = new Array<number>(n + 1);
    const strAt = new Array<number>(n + 1);
    let s = '';
    bytesAt[0] = 0;
    strAt[0] = 0;
    for (let i = 0; i < n; i++) { s += word[i].r; bytesAt[i + 1] = bytesAt[i] + utf8Len(word[i].r); strAt[i + 1] = s.length; }
    const best: { score: number; from: number; id: number; set: boolean }[] = Array.from({ length: n + 1 }, () => ({ score: 0, from: 0, id: 0, set: false }));
    best[0].set = true;
    for (let ci = 0; ci < n; ci++) {
      if (!best[ci].set) continue;
      const base = best[ci].score;
      let single = false;
      for (let cj = ci + 1; cj <= n && bytesAt[cj] - bytesAt[ci] <= this.maxLen; cj++) {
        const id = this.pieces.get(s.slice(strAt[ci], strAt[cj]));
        if (id === undefined) continue;
        const c = base + this.scores[id];
        const nd = best[cj];
        if (!nd.set || c > nd.score) best[cj] = { score: c, from: ci, id, set: true };
        if (cj === ci + 1) single = true;
      }
      if (!single) {
        const c = base + this.unkCost;
        const nd = best[ci + 1];
        if (!nd.set || c > nd.score) best[ci + 1] = { score: c, from: ci, id: this.unk, set: true };
      }
    }
    const rev: Token[] = [];
    for (let to = n; to > 0;) {
      const nd = best[to];
      rev.push({ id: nd.id, start: word[nd.from].s, end: word[to - 1].e });
      to = nd.from;
    }
    for (let i = rev.length - 1; i >= 0; i--) {
      const tk = rev[i];
      const last = out[out.length - 1];
      if (tk.id === this.unk && last && last.id === this.unk && i < rev.length - 1) { last.end = tk.end; continue; }
      out.push(tk);
    }
  }
}

/** Split at whitespace: a run of it is dropped, unless it follows a digit, when each of its characters is a piece. */
export function pretokenize(cs: NChar[]): NChar[][] {
  const out: NChar[][] = [];
  let w = -1;
  const flush = (i: number) => { if (w >= 0) { out.push(cs.slice(w, i)); w = -1; } };
  for (let i = 0; i < cs.length;) {
    if (!SPACE.test(cs[i].r)) { if (w < 0) w = i; i++; continue; }
    flush(i);
    let j = i;
    while (j < cs.length && SPACE.test(cs[j].r)) j++;
    if (i > 0 && cs[i - 1].r >= '0' && cs[i - 1].r <= '9') for (let k = i; k < j; k++) out.push([cs[k]]);
    i = j;
  }
  flush(cs.length);
  return out;
}
