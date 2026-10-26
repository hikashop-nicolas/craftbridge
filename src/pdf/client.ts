import { EngineError } from "./engine";
import type { AnnotationInfo, Box, Call, EditCall, DocumentInfo, FieldInfo, FieldValue, FindMatch, History, LinkInfo, MarkupKind, ObjectRef, PageObject, Rendered, Reply, TextBlock, TextSelection, TextStyle, Tile } from "./protocol";

export { EngineError };
export type { AnnotationInfo, Box, EditCall, DocumentInfo, FieldInfo, FieldValue, FindMatch, History, LinkInfo, MarkupKind, ObjectRef, PageObject, Rendered, TextBlock, TextSelection, TextStyle, Tile };

export interface OpenOptions {
  /** The password of an encrypted file. */
  password?: string;
  /** A worker running `craftbridge/pdf/worker`; one is created from `workerUrl` when omitted. */
  worker?: Worker;
  workerUrl?: string | URL;
  /** Where the browser finds pdfcraft_wasm_bg.wasm, when the glue code cannot work it out. */
  wasmUrl?: string;
}

/** An open PDF. Every call runs in the worker, so the page never blocks on the engine. */
export class PdfDocument {
  private nextId = 1;
  private pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>();
  private closed = false;

  /** @internal */
  constructor(private readonly worker: Worker, private current: DocumentInfo) {
    worker.addEventListener("message", (e: MessageEvent<Reply>) => {
      const waiting = this.pending.get(e.data.id);
      if (!waiting) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) waiting.resolve(e.data.value);
      else waiting.reject(new EngineError(e.data.code, e.data.message));
    });
    worker.addEventListener("error", (e) => this.failAll(new EngineError("failed", e.message || "the worker failed")));
  }

  /** @internal */
  call<T>(call: Call, transfer: Transferable[] = []): Promise<T> {
    if (this.closed) return Promise.reject(new EngineError("failed", "the document is closed"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...call, id }, transfer);
    });
  }

  private failAll(error: EngineError): void {
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
  }

  get pageCount(): number {
    return this.current.pageCount;
  }

  get encrypted(): boolean {
    return this.current.encrypted;
  }

  /** The displayed size of a page in points, or null when there is no such page. */
  pageSize(page: number): Promise<[number, number] | null> {
    return this.call({ op: "pageSize", page });
  }

  /** Draws a page (or just `tile`, in device pixels) at `scale` device pixels per point. */
  render(page: number, scale: number, tile?: Tile): Promise<Rendered> {
    return this.call({ op: "render", page, scale, tile });
  }

  textBlocks(page: number): Promise<TextBlock[]> {
    return this.call({ op: "textBlocks", page });
  }

  /** Rewrites a text block; the page is read again afterwards, so block indices may shift. */
  async editTextBlock(page: number, block: number, text: string): Promise<void> {
    await this.call({ op: "editTextBlock", page, block, text });
  }

  /**
   * Runs any editing call from its description, the way the methods above do. A session records
   * these descriptions and replays them on every peer's copy, so they all reach the same document.
   */
  async execute(call: EditCall): Promise<void> {
    await this.call(call);
    if (["deletePages", "insertBlankPage", "insertPagesFrom", "undo", "redo"].includes(call.op)) await this.refresh();
  }

  /** Everything on the page that can be moved, resized, restyled or deleted. */
  objects(page: number): Promise<PageObject[]> {
    return this.call({ op: "objects", page });
  }

  /** Moves objects by (dx, dy) displayed points: existing text, images and added items together. */
  async moveObjects(page: number, targets: ObjectRef[], dx: number, dy: number): Promise<void> {
    await this.call({ op: "moveObjects", page, targets, dx, dy });
  }

  /** Gives an object a box. An added item or an image takes it; existing text rewraps to its width. */
  async rotateObject(page: number, target: ObjectRef, quarterTurns: number): Promise<void> {
    await this.call({ op: "rotateObject", page, target, quarterTurns });
  }

  async resizeObject(page: number, target: ObjectRef, view: Box): Promise<void> {
    await this.call({ op: "resizeObject", page, target, view });
  }

  /** Adds a text box over `view` (its width wraps the text; the height follows it). */
  async addText(page: number, view: Box, text: string, style: TextStyle = {}): Promise<void> {
    await this.call({ op: "addText", page, view, text, style });
  }

  /** Adds a picture (PNG, JPEG, TIFF, GIF, BMP) over `view`, or at its natural size in the middle. */
  async addImage(page: number, name: string, bytes: Uint8Array, view?: Box): Promise<void> {
    await this.call({ op: "addImage", page, name, bytes, view });
  }

  async deleteObject(page: number, target: ObjectRef): Promise<void> {
    await this.call({ op: "deleteObject", page, target });
  }

  /** Rewrites an object's text and/or restyles it; leave `text` out to keep the words. */
  async setText(page: number, target: ObjectRef, text?: string, style: TextStyle = {}): Promise<void> {
    await this.call({ op: "setText", page, target, text, style });
  }

  /** Paints a white box over `view` (the covered content stays in the file). */
  async cover(page: number, view: Box): Promise<void> {
    await this.call({ op: "cover", page, view });
  }

  /** Every match of `query` in the text of every page, with the boxes to show them. */
  find(query: string, options: { caseSensitive?: boolean; wholeWords?: boolean; limit?: number } = {}): Promise<FindMatch[]> {
    return this.call({ op: "find", query, ...options });
  }

  /** The text from the glyph nearest `from` to the one nearest `to`, with a box per line. */
  selectText(page: number, from: [number, number], to: [number, number]): Promise<TextSelection> {
    return this.call({ op: "selectText", page, from, to });
  }

  /** Highlights, underlines or strikes out the lines in `rects` (what `selectText` returned). */
  async markup(page: number, kind: MarkupKind, rects: Box[], color?: [number, number, number]): Promise<void> {
    await this.call({ op: "markup", page, kind, rects, color });
  }

  /** Adds a link over `view`: an http(s) or mailto: address, or "page:N" (1-based). */
  async addLink(page: number, view: Box, target: string): Promise<void> {
    await this.call({ op: "addLink", page, view, target });
  }

  links(page: number): Promise<LinkInfo[]> {
    return this.call({ op: "links", page });
  }

  async deleteLink(page: number, index: number): Promise<void> {
    await this.call({ op: "deleteLink", page, index });
  }

  /** The page's marks and comments: highlights, notes, shapes, covers. */
  annotations(page: number): Promise<AnnotationInfo[]> {
    return this.call({ op: "annotations", page });
  }

  async deleteAnnotation(page: number, index: number): Promise<void> {
    await this.call({ op: "deleteAnnotation", page, index });
  }

  /** The form fields on the page. */
  fields(page: number): Promise<FieldInfo[]> {
    return this.call({ op: "fields", page });
  }

  async setField(name: string, value: FieldValue): Promise<void> {
    await this.call({ op: "setField", name, value });
  }

  async deletePages(pages: number[]): Promise<void> {
    await this.call({ op: "deletePages", pages });
    await this.refresh();
  }

  /** Turns pages clockwise by a multiple of 90 degrees. */
  async rotatePages(pages: number[], degrees: number): Promise<void> {
    await this.call({ op: "rotatePages", pages, degrees });
  }

  /** Moves pages so the first of them lands at index `to` of the new order. */
  async movePages(pages: number[], to: number): Promise<void> {
    await this.call({ op: "movePages", pages, to });
  }

  /** Adds every page of another PDF so its first lands at page index `at` (the page count appends them). */
  async insertPagesFrom(name: string, bytes: Uint8Array, at: number): Promise<void> {
    await this.call({ op: "insertPagesFrom", name, bytes, at });
    await this.refresh();
  }

  async insertBlankPage(at: number, width: number, height: number): Promise<void> {
    await this.call({ op: "insertBlankPage", at, width, height });
    await this.refresh();
  }

  history(): Promise<History> {
    return this.call({ op: "history" });
  }

  async undo(): Promise<void> {
    await this.call({ op: "undo" });
    await this.refresh();
  }

  async redo(): Promise<void> {
    await this.call({ op: "redo" });
    await this.refresh();
  }

  /** The file as an incremental update (the original bytes stay a prefix), or rewritten in full. */
  save(full = false): Promise<Uint8Array> {
    return this.call({ op: "save", full });
  }

  /** Reads the page count again after a call that can change it. */
  async refresh(): Promise<void> {
    this.current = await this.call<DocumentInfo>({ op: "info" });
  }

  close(): void {
    if (this.closed) return;
    this.worker.postMessage({ op: "close", id: 0 });
    this.closed = true;
    this.failAll(new EngineError("failed", "the document was closed"));
    this.worker.terminate();
  }
}

/** Opens a PDF. Rejects with an EngineError whose code is `needs-password`, `wrong-password` or `invalid`. */
export async function openPdf(bytes: Uint8Array, options: OpenOptions = {}): Promise<PdfDocument> {
  const worker = options.worker ?? new Worker(options.workerUrl ?? new URL("./worker.js", import.meta.url), { type: "module" });
  const reply = await new Promise<Reply>((resolve, reject) => {
    worker.addEventListener("message", (e: MessageEvent<Reply>) => resolve(e.data), { once: true });
    worker.addEventListener("error", (e) => reject(new EngineError("failed", e.message || "the worker failed")), { once: true });
    worker.postMessage({ op: "open", id: 0, bytes, password: options.password, wasmUrl: options.wasmUrl } satisfies Call & { id: number });
  }).catch((e) => {
    worker.terminate();
    throw e;
  });
  if (!reply.ok) {
    worker.terminate();
    throw new EngineError(reply.code, reply.message);
  }
  return new PdfDocument(worker, reply.value as DocumentInfo);
}
