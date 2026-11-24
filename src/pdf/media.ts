// Sounds and videos embedded in a PDF's annotations, read straight from the file's bytes.
// The engine keeps these annotations when it saves but does not read them, so this is a small
// reader of its own: it finds the objects it needs, never rewrites anything, and gives up
// quietly (an empty list) on what it cannot read, such as an encrypted file.
//
// Covered: a Screen (or Movie, Link, Widget) annotation whose Rendition action plays a media
// clip (LibreOffice, Acrobat), a Movie annotation's file, a Sound annotation (its raw samples
// wrapped as WAV), a RichMedia annotation's assets, and a FileAttachment annotation holding a
// sound or a video.

import type { Box } from "./protocol";

/** One playable thing on a page. */
export interface PdfMediaInfo {
  /** Page index, from 0. */
  page: number;
  /** Position in the page's annotation list. */
  index: number;
  subtype: string;
  /** Where it is drawn: points from the page's top-left, y down (as the engine's boxes). */
  view: Box;
  name: string;
  mime: string;
  kind: "audio" | "video";
}

export interface PdfMedia {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

type Obj = null | boolean | number | string | Name | Ref | Obj[] | Dict | Stream;
class Name { constructor(readonly v: string) {} }
class Ref { constructor(readonly n: number, readonly g: number) {} }
type Dict = Map<string, Obj>;
interface Stream { dict: Dict; start: number; end: number; data?: Uint8Array }

const isDict = (o: Obj): o is Dict => o instanceof Map;
const isStream = (o: Obj): o is Stream => !!o && typeof o === "object" && "dict" in o && "start" in o;
const nameOf = (o: Obj) => (o instanceof Name ? o.v : null);

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

/** The objects of one PDF file, read lazily. */
class Reader {
  private readonly at = new Map<number, number>();
  private readonly inStream = new Map<number, [number, number]>();
  private readonly cache = new Map<number, Obj>();
  private readonly streamsDecoded = new Map<number, Map<number, Obj>>();
  readonly text: string;
  private p = 0;

  constructor(private readonly b: Uint8Array) {
    this.text = new TextDecoder("latin1").decode(b);
    // Every "N G obj" in the file; a later one (an incremental update) wins.
    for (const m of this.text.matchAll(/(?:^|[\s>\]])(\d+)\s+(\d+)\s+obj\b/g)) {
      this.at.set(Number(m[1]), m.index! + m[0].indexOf(m[1]!));
    }
  }

  get encrypted(): boolean {
    return /\/Encrypt\s/.test(this.text.slice(-4096)) || /trailer[\s\S]{0,400}\/Encrypt/.test(this.text);
  }

  /** The catalog, from the last trailer or cross-reference stream, else any /Type /Catalog. */
  async root(): Promise<Dict | null> {
    const ref = [...this.text.matchAll(/\/Root\s+(\d+)\s+(\d+)\s+R/g)].at(-1);
    if (ref) {
      const o = await this.get(new Ref(Number(ref[1]), Number(ref[2])));
      if (isDict(o)) return o;
    }
    for (const n of this.at.keys()) {
      const o = await this.get(new Ref(n, 0));
      if (isDict(o) && nameOf(o.get("Type") ?? null) === "Catalog") return o;
    }
    return null;
  }

  async get(o: Obj): Promise<Obj> {
    for (let hops = 0; o instanceof Ref && hops < 32; hops++) o = await this.object(o.n);
    return o instanceof Ref ? null : o;
  }

  async dict(o: Obj): Promise<Dict | null> {
    const r = await this.get(o);
    return isDict(r) ? r : isStream(r) ? r.dict : null;
  }

  private async object(n: number): Promise<Obj> {
    if (this.cache.has(n)) return this.cache.get(n)!;
    let value: Obj = null;
    const pos = this.at.get(n);
    if (pos !== undefined) {
      this.p = pos;
      this.parse(); this.parse(); this.word(); // N G obj
      value = this.parse();
      if (isDict(value)) value = this.streamAfter(value) ?? value;
    } else {
      if (!this.inStream.size) await this.indexObjectStreams();
      const loc = this.inStream.get(n);
      if (loc) value = (await this.fromObjectStream(loc[0])).get(n) ?? null;
    }
    this.cache.set(n, value);
    return value;
  }

  // Objects compressed in object streams (PDF 1.5): every /Type /ObjStm stream's header lists them.
  private async indexObjectStreams(): Promise<void> {
    this.inStream.set(-1, [-1, -1]);
    for (const [n] of this.at) {
      const o = await this.object(n);
      if (!isStream(o) || nameOf(o.dict.get("Type") ?? null) !== "ObjStm") continue;
      const objs = await this.fromObjectStream(n);
      for (const k of objs.keys()) if (!this.at.has(k) && !this.inStream.has(k)) this.inStream.set(k, [n, 0]);
    }
  }

  private async fromObjectStream(n: number): Promise<Map<number, Obj>> {
    const done = this.streamsDecoded.get(n);
    if (done) return done;
    const out = new Map<number, Obj>();
    this.streamsDecoded.set(n, out);
    const s = await this.object(n);
    if (!isStream(s)) return out;
    const data = await this.decode(s);
    if (!data) return out;
    const count = Number(s.dict.get("N")), first = Number(s.dict.get("First"));
    const sub = new Reader(data);
    sub.p = 0;
    const pairs: number[] = [];
    for (let i = 0; i < count * 2; i++) pairs.push(Number(sub.parse()));
    for (let i = 0; i < count; i++) {
      sub.p = first + pairs[i * 2 + 1]!;
      out.set(pairs[i * 2]!, sub.parse());
    }
    return out;
  }

  // A dictionary followed by `stream`: note where its data lies.
  private streamAfter(dict: Dict): Stream | null {
    const save = this.p;
    this.skipWs();
    if (this.text.startsWith("stream", this.p)) {
      let start = this.p + 6;
      if (this.b[start] === 13) start++;
      if (this.b[start] === 10) start++;
      const len = dict.get("Length");
      let end = typeof len === "number" ? start + len : -1;
      if (end < 0 || end > this.b.length || !/^\s*endstream/.test(this.text.slice(end, end + 20))) {
        end = this.text.indexOf("endstream", start);
        if (end < 0) end = this.b.length;
        while (end > start && (this.b[end - 1] === 10 || this.b[end - 1] === 13)) end--;
      }
      return { dict, start, end };
    }
    this.p = save;
    return null;
  }

  /** A stream's bytes with its filters undone (FlateDecode, or none); null if it cannot be read. */
  async decode(s: Stream): Promise<Uint8Array | null> {
    if (s.data) return s.data;
    let data = this.b.subarray(s.start, s.end);
    const f = s.dict.get("Filter") ?? null;
    const filters = Array.isArray(f) ? f.map(nameOf) : f ? [nameOf(f)] : [];
    for (const name of filters) {
      if (name !== "FlateDecode" && name !== "Fl") return null;
      data = await inflate(data);
    }
    s.data = data;
    return data;
  }

  // ------------------------------------------------------------------ syntax

  private skipWs(): void {
    for (;;) {
      while (this.p < this.b.length && WS.has(this.b[this.p]!)) this.p++;
      if (this.b[this.p] !== 37) return; // %
      while (this.p < this.b.length && this.b[this.p] !== 10 && this.b[this.p] !== 13) this.p++;
    }
  }

  private word(): string {
    this.skipWs();
    const s = this.p;
    while (this.p < this.b.length && !WS.has(this.b[this.p]!) && !DELIM.has(this.b[this.p]!)) this.p++;
    return this.text.slice(s, this.p);
  }

  parse(): Obj {
    this.skipWs();
    const c = this.b[this.p];
    if (c === undefined) return null;
    if (c === 47) { // /Name
      this.p++;
      const s = this.p;
      while (this.p < this.b.length && !WS.has(this.b[this.p]!) && !DELIM.has(this.b[this.p]!)) this.p++;
      return new Name(this.text.slice(s, this.p).replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))));
    }
    if (c === 60 && this.b[this.p + 1] === 60) { // << dict >>
      this.p += 2;
      const d: Dict = new Map();
      for (;;) {
        this.skipWs();
        if (this.b[this.p] === 62 && this.b[this.p + 1] === 62) { this.p += 2; return d; }
        if (this.p >= this.b.length) return d;
        const k = this.parse();
        if (!(k instanceof Name)) return d;
        d.set(k.v, this.parse());
      }
    }
    if (c === 91) { // [ array ]
      this.p++;
      const a: Obj[] = [];
      for (;;) {
        this.skipWs();
        if (this.b[this.p] === 93) { this.p++; return a; }
        if (this.p >= this.b.length) return a;
        a.push(this.parse());
      }
    }
    if (c === 40) return this.literal();
    if (c === 60) { // <hex>
      const e = this.text.indexOf(">", this.p);
      const hex = this.text.slice(this.p + 1, e).replace(/\s/g, "");
      this.p = e + 1;
      let s = "";
      for (let i = 0; i < hex.length; i += 2) s += String.fromCharCode(parseInt((hex.slice(i, i + 2) + "0").slice(0, 2), 16));
      return s;
    }
    const w = this.word();
    if (w === "true") return true;
    if (w === "false") return false;
    if (w === "null" || w === "") { if (w === "") this.p++; return null; }
    const num = Number(w);
    if (!Number.isFinite(num)) return null;
    // "N G R" is a reference.
    if (Number.isInteger(num)) {
      const save = this.p;
      const g = this.word();
      if (/^\d+$/.test(g) && this.word() === "R") return new Ref(num, Number(g));
      this.p = save;
    }
    return num;
  }

  private literal(): string {
    this.p++;
    let depth = 1, s = "";
    while (this.p < this.b.length) {
      const c = this.b[this.p++]!;
      if (c === 92) {
        const e = this.b[this.p++]!;
        const map: Record<number, string> = { 110: "\n", 114: "\r", 116: "\t", 98: "\b", 102: "\f" };
        if (map[e]) s += map[e];
        else if (e >= 48 && e <= 55) {
          let oct = String.fromCharCode(e);
          while (oct.length < 3 && this.b[this.p]! >= 48 && this.b[this.p]! <= 55) oct += String.fromCharCode(this.b[this.p++]!);
          s += String.fromCharCode(parseInt(oct, 8) & 255);
        } else if (e !== 10 && e !== 13) s += String.fromCharCode(e);
        continue;
      }
      if (c === 40) depth++;
      if (c === 41 && --depth === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(await out);
}

/** A PDF text string: UTF-16 with a byte-order mark, or PDFDocEncoding (read as Latin-1). */
function pdfText(s: Obj): string {
  if (typeof s !== "string") return "";
  if (s.startsWith("\xfe\xff")) {
    let out = "";
    for (let i = 2; i + 1 < s.length; i += 2) out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
    return out;
  }
  return s;
}

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac",
  flac: "audio/flac", aif: "audio/aiff", aiff: "audio/aiff", mid: "audio/midi", wma: "audio/x-ms-wma",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", ogv: "video/ogg", avi: "video/x-msvideo",
  mkv: "video/x-matroska", mpg: "video/mpeg", mpeg: "video/mpeg", wmv: "video/x-ms-wmv", flv: "video/x-flv", swf: "application/x-shockwave-flash",
};
const kindOf = (mime: string): "audio" | "video" | null => (mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : null);

interface Found { name: string; mime: string; file: Obj; sound?: Stream }

/** The page dictionaries in order, with what they inherit. */
async function pages(r: Reader): Promise<{ dict: Dict; crop: Box; rotate: number }[]> {
  const root = await r.root();
  const out: { dict: Dict; crop: Box; rotate: number }[] = [];
  const seen = new Set<Dict>();
  const walk = async (node: Obj, inh: { media?: Obj; crop?: Obj; rotate?: Obj }) => {
    const d = await r.dict(node);
    if (!d || seen.has(d)) return;
    seen.add(d);
    const here = { media: d.get("MediaBox") ?? inh.media, crop: d.get("CropBox") ?? inh.crop, rotate: d.get("Rotate") ?? inh.rotate };
    const kids = await r.get(d.get("Kids") ?? null);
    if (Array.isArray(kids)) { for (const k of kids) await walk(k, here); return; }
    const nums = async (o: Obj | undefined): Promise<Box | null> => {
      const a = await r.get(o ?? null);
      if (!Array.isArray(a) || a.length !== 4) return null;
      const v = await Promise.all(a.map(async x => Number(await r.get(x))));
      return [Math.min(v[0]!, v[2]!), Math.min(v[1]!, v[3]!), Math.max(v[0]!, v[2]!), Math.max(v[1]!, v[3]!)];
    };
    const media = (await nums(here.media)) ?? [0, 0, 612, 792];
    const c = await nums(here.crop);
    const crop: Box = c ? [Math.max(c[0], media[0]), Math.max(c[1], media[1]), Math.min(c[2], media[2]), Math.min(c[3], media[3])] : media;
    out.push({ dict: d, crop, rotate: ((Number(await r.get(here.rotate ?? 0)) % 360) + 360) % 360 });
  };
  if (root) await walk(root.get("Pages") ?? null, {});
  return out;
}

/** User space to the engine's view box (points from the displayed page's top-left, y down). */
function toView(rect: Box, crop: Box, rotate: number): Box {
  const [cx0, cy0, cx1, cy1] = crop;
  const w = cx1 - cx0, h = cy1 - cy0;
  const [W, H] = rotate % 180 ? [h, w] : [w, h];
  const pt = (x: number, y: number) => {
    const u = (x - cx0) / Math.max(w, 1e-3), v = (cy1 - y) / Math.max(h, 1e-3);
    const [a, b] = rotate === 90 ? [1 - v, u] : rotate === 180 ? [1 - u, 1 - v] : rotate === 270 ? [v, 1 - u] : [u, v];
    return [a * W, b * H];
  };
  const [ax, ay] = pt(rect[0], rect[1]), [bx, by] = pt(rect[2], rect[3]);
  return [Math.min(ax!, bx!), Math.min(ay!, by!), Math.max(ax!, bx!), Math.max(ay!, by!)];
}

/** A file specification's embedded file and name. */
async function fileOf(r: Reader, spec: Obj): Promise<{ name: string; file: Obj } | null> {
  const fs = await r.get(spec);
  if (!isDict(fs)) return null;
  const ef = await r.dict(fs.get("EF") ?? null);
  const file = ef ? ef.get("UF") ?? ef.get("F") ?? null : null;
  if (!file) return null;
  const name = pdfText(await r.get(fs.get("UF") ?? fs.get("F") ?? null)) || pdfText(await r.get(fs.get("Desc") ?? null));
  return { name, file };
}

const guessMime = (name: string, declared: string): string => {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (declared && declared !== "application/octet-stream") return declared === "audio/x-wav" ? "audio/wav" : declared;
  return MIME_BY_EXT[ext] ?? declared;
};

/** What an annotation plays, if anything. */
async function mediaOf(r: Reader, a: Dict): Promise<Found | null> {
  const subtype = nameOf(a.get("Subtype") ?? null) ?? "";
  // Actions: the annotation's own, then its chain of /Next actions.
  const actions: Dict[] = [];
  const queue: Obj[] = [a.get("A") ?? null];
  const aa = await r.dict(a.get("AA") ?? null);
  if (aa) for (const k of ["PO", "PV", "D", "U", "E"]) queue.push(aa.get(k) ?? null);
  while (queue.length && actions.length < 16) {
    const act = await r.dict(queue.shift()!);
    if (!act) continue;
    actions.push(act);
    const next = await r.get(act.get("Next") ?? null);
    if (Array.isArray(next)) queue.push(...next); else if (next) queue.push(next);
  }
  for (const act of actions) {
    const s = nameOf(act.get("S") ?? null);
    if (s === "Rendition") {
      let rend = await r.dict(act.get("R") ?? null);
      // A selector rendition: its first media rendition.
      for (let i = 0; rend && nameOf(rend.get("S") ?? null) === "SR" && i < 4; i++) {
        const list = await r.get(rend.get("R") ?? null);
        rend = await r.dict(Array.isArray(list) ? list[0] ?? null : list);
      }
      const clip = rend ? await r.dict(rend.get("C") ?? null) : null;
      const f = clip ? await fileOf(r, clip.get("D") ?? null) : null;
      if (f && clip) return { ...f, mime: guessMime(f.name, pdfText(await r.get(clip.get("CT") ?? null))) };
    }
    if (s === "Sound") {
      const snd = await r.get(act.get("Sound") ?? null);
      if (isStream(snd)) return { name: "sound.wav", mime: "audio/wav", file: null, sound: snd };
    }
  }
  if (subtype === "Sound") {
    const snd = await r.get(a.get("Sound") ?? null);
    if (isStream(snd)) return { name: "sound.wav", mime: "audio/wav", file: null, sound: snd };
  }
  if (subtype === "Movie") {
    const mv = await r.dict(a.get("Movie") ?? null);
    const f = mv ? await fileOf(r, mv.get("F") ?? null) : null;
    if (f) return { ...f, mime: guessMime(f.name, "") };
  }
  if (subtype === "FileAttachment") {
    const f = await fileOf(r, a.get("FS") ?? null);
    const file = f ? await r.get(f.file) : null;
    const declared = isStream(file) ? nameOf(file.dict.get("Subtype") ?? null)?.replace("#2F", "/") ?? "" : "";
    if (f) return { ...f, mime: guessMime(f.name, declared) };
  }
  if (subtype === "RichMedia") {
    const content = await r.dict(a.get("RichMediaContent") ?? null);
    const assets = content ? await r.dict(content.get("Assets") ?? null) : null;
    const names = assets ? await r.get(assets.get("Names") ?? null) : null;
    if (Array.isArray(names)) {
      for (let i = 0; i + 1 < names.length; i += 2) {
        const f = await fileOf(r, names[i + 1]!);
        const name = pdfText(await r.get(names[i]!)) || f?.name || "";
        const mime = guessMime(name, "");
        if (f && kindOf(mime)) return { name, file: f.file, mime };
      }
    }
  }
  return null;
}

// Sound streams hold raw samples (big-endian when 16-bit): wrap them as a little-endian WAV.
async function soundToWav(r: Reader, s: Stream): Promise<Uint8Array | null> {
  const raw = await r.decode(s);
  if (!raw) return null;
  const rate = Number(s.dict.get("R")) || 11025, channels = Number(s.dict.get("C")) || 1, bits = Number(s.dict.get("B")) || 8;
  const enc = nameOf(s.dict.get("E") ?? null) ?? "Raw";
  if (enc !== "Raw" && enc !== "Signed") return null;
  const pcm = new Uint8Array(raw.length);
  if (bits === 16) for (let i = 0; i + 1 < raw.length; i += 2) { pcm[i] = raw[i + 1]!; pcm[i + 1] = raw[i]!; }
  else if (bits === 8) for (let i = 0; i < raw.length; i++) pcm[i] = enc === "Signed" ? (raw[i]! + 128) & 255 : raw[i]!;
  else return null;
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const tag = (o: number, s: string) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  tag(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); tag(8, "WAVE"); tag(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true);
  v.setUint32(28, (rate * channels * bits) / 8, true); v.setUint16(32, (channels * bits) / 8, true); v.setUint16(34, bits, true);
  tag(36, "data"); v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

// A quick look before any parsing: most PDFs have nothing to play.
const MAYBE = /\/(Screen|Movie|Sound|RichMedia|Rendition|FileAttachment)\b/;

const readers = new WeakMap<Uint8Array, Reader>();
const readerFor = (bytes: Uint8Array) => {
  let r = readers.get(bytes);
  if (!r) { r = new Reader(bytes); readers.set(bytes, r); }
  return r;
};

/** Every annotation of the file that plays a sound or a video, page by page. */
export async function listPdfMedia(bytes: Uint8Array): Promise<PdfMediaInfo[]> {
  const r = readerFor(bytes);
  if (!MAYBE.test(r.text) || r.encrypted) return [];
  const out: PdfMediaInfo[] = [];
  try {
    const list = await pages(r);
    for (let page = 0; page < list.length; page++) {
      const { dict, crop, rotate } = list[page]!;
      const annots = await r.get(dict.get("Annots") ?? null);
      if (!Array.isArray(annots)) continue;
      for (let index = 0; index < annots.length; index++) {
        const a = await r.dict(annots[index]!);
        if (!a) continue;
        const found = await mediaOf(r, a);
        const kind = found ? kindOf(found.mime) : null;
        if (!found || !kind) continue;
        const rect = await r.get(a.get("Rect") ?? null);
        if (!Array.isArray(rect) || rect.length !== 4) continue;
        const n = await Promise.all(rect.map(async x => Number(await r.get(x))));
        const box: Box = [Math.min(n[0]!, n[2]!), Math.min(n[1]!, n[3]!), Math.max(n[0]!, n[2]!), Math.max(n[1]!, n[3]!)];
        out.push({ page, index, subtype: nameOf(a.get("Subtype") ?? null) ?? "", view: toView(box, crop, rotate), name: found.name, mime: found.mime, kind });
      }
    }
  } catch { /* an unexpected structure: whatever was found so far */ }
  return out;
}

/** The sound or video an annotation plays, ready for a player; null if there is none. */
export async function pdfMediaBytes(bytes: Uint8Array, page: number, index: number): Promise<PdfMedia | null> {
  const r = readerFor(bytes);
  if (r.encrypted) return null;
  try {
    const p = (await pages(r))[page];
    const annots = p ? await r.get(p.dict.get("Annots") ?? null) : null;
    const a = Array.isArray(annots) ? await r.dict(annots[index] ?? null) : null;
    const found = a ? await mediaOf(r, a) : null;
    if (!found) return null;
    if (found.sound) {
      const wav = await soundToWav(r, found.sound);
      return wav ? { name: found.name, mime: "audio/wav", bytes: wav } : null;
    }
    const file = await r.get(found.file);
    const data = isStream(file) ? await r.decode(file) : null;
    if (!data) return null;
    const ext = Object.entries(MIME_BY_EXT).find(([, m]) => m === found.mime)?.[0];
    const name = found.name && !found.name.startsWith("<") ? found.name : `media${ext ? `.${ext}` : ""}`;
    return { name, mime: found.mime, bytes: data.slice() };
  } catch {
    return null;
  }
}
