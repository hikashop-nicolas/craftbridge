import { EngineError } from "./engine";
import type { AttachmentInfo, BackgroundSpec, BookmarkInfo, HeaderFooterSpec, HiddenInfo, MarkKind, WatermarkSpec, ScriptEvent, ActionTrigger, AnnotationInfo, Box, Call, CommentSpec, DocumentInfo, EditCall, FieldAction, FieldActionInfo, FieldChange, FieldInfo, FieldSpec, FieldValue, FindMatch, History, JsOutput, JsRequest, LayerInfo, LinkInfo, MarkupKind, ObjectRef, PageObject, ProtectSpec, Rendered, Reply, SignSpec, SignatureInfo, StampInfo, TextBlock, TextSelection, TextStyle, Tile } from "./protocol";

export { EngineError };
export type { AttachmentInfo, BackgroundSpec, BookmarkInfo, HeaderFooterSpec, HiddenInfo, MarkKind, WatermarkSpec, ScriptEvent, ActionTrigger, AnnotationInfo, Box, CommentSpec, DocumentInfo, EditCall, FieldAction, FieldActionInfo, FieldChange, FieldInfo, FieldSpec, FieldValue, FindMatch, History, JsOutput, JsRequest, LayerInfo, LinkInfo, MarkupKind, ObjectRef, PageObject, ProtectSpec, Rendered, SignSpec, SignatureInfo, StampInfo, TextBlock, TextSelection, TextStyle, Tile };

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

  /** Adds a comment: a note, shape, arrow, pen drawing, text box, stamp, or the marks of Fill and Sign. */
  async addAnnotation(page: number, spec: CommentSpec): Promise<void> {
    await this.call({ op: "addAnnotation", page, spec });
  }

  async setAnnotationContents(page: number, index: number, text: string): Promise<void> {
    await this.call({ op: "setAnnotationContents", page, index, text });
  }

  /** The stamps that can be added with `addAnnotation({ type: "stamp", stamp: name })`. */
  stamps(): Promise<StampInfo[]> {
    return this.call({ op: "stamps" });
  }

  /** Adds a form field over a displayed box. */
  async addField(page: number, view: Box, spec: FieldSpec): Promise<void> {
    await this.call({ op: "addField", page, view, spec });
  }

  async deleteField(name: string): Promise<void> {
    await this.call({ op: "deleteField", name });
  }

  async deleteFieldWidget(name: string, widget: number): Promise<void> {
    await this.call({ op: "deleteFieldWidget", name, widget });
  }

  async setFieldProps(name: string, change: FieldChange): Promise<void> {
    await this.call({ op: "setFieldProps", name, change });
  }

  /** What a field does for each trigger (a button's click, a pointer entering it, and so on). */
  fieldActions(name: string): Promise<FieldActionInfo[]> {
    return this.call({ op: "fieldActions", name });
  }

  /** Replaces a field's actions; a trigger left out loses its action. */
  async setFieldActions(name: string, actions: FieldActionInfo[]): Promise<void> {
    await this.call({ op: "setFieldActions", name, actions });
  }

  /** Carries out an action as `target` field's click: scripts run in the engine's sandbox and their field changes are applied; what is left (a link, a page, printing) comes back for the page. */
  runAction(action: FieldAction, target?: string): Promise<JsOutput> {
    return this.call({ op: "runAction", action, target });
  }

  /** The scripts a field answers its own events with (a key typed, formatting, validating, calculating). */
  fieldScripts(name: string): Promise<Partial<Record<ScriptEvent, string>>> {
    return this.call({ op: "fieldScripts", name });
  }

  /** Sets a field's script for an event; an empty script removes it. */
  async setFieldScript(name: string, event: ScriptEvent, script: string): Promise<void> {
    await this.call({ op: "setFieldScript", name, event, script });
  }

  /** Marks areas of a page (displayed boxes) for redaction; `overlay` shows on them once applied. */
  async addRedaction(page: number, boxes: Box[], overlay = ""): Promise<void> {
    await this.call({ op: "addRedaction", page, boxes, overlay });
  }

  /** How many redaction marks wait to be applied. */
  redactionCount(): Promise<number> {
    return this.call({ op: "redactionCount" });
  }

  /** Removes for good what the marks cover. The engine refuses when something under a mark would still be drawn. */
  async applyRedactions(): Promise<void> {
    await this.call({ op: "applyRedactions" });
  }

  async clearRedactions(): Promise<void> {
    await this.call({ op: "clearRedactions" });
  }

  /** What each kind of hidden information (metadata, attachments, comments, ...) would remove. */
  hiddenInfo(): Promise<HiddenInfo[]> {
    return this.call({ op: "hiddenInfo" });
  }

  async removeHidden(ids: string[]): Promise<void> {
    await this.call({ op: "removeHidden", ids });
  }

  /** A watermark on every page (or `spec.pages`), text or a picture; it replaces the earlier one. */
  async addWatermark(spec: WatermarkSpec, picture?: { name: string; bytes: Uint8Array }): Promise<void> {
    await this.call({ op: "addWatermark", spec, picture });
  }

  /** A header and footer; it replaces the earlier one. */
  async addHeaderFooter(spec: HeaderFooterSpec): Promise<void> {
    await this.call({ op: "addHeaderFooter", spec });
  }

  /** A background colour or picture behind the content; it replaces the earlier one. */
  async addBackground(spec: BackgroundSpec, picture?: { name: string; bytes: Uint8Array }): Promise<void> {
    await this.call({ op: "addBackground", spec, picture });
  }

  async removeMarks(kind: MarkKind): Promise<void> {
    await this.call({ op: "removeMarks", kind });
  }

  /** The bookmarks in outline order. */
  bookmarks(): Promise<BookmarkInfo[]> {
    return this.call({ op: "bookmarks" });
  }

  /** Adds a bookmark as child `index` of the bookmark at `parent` (`[]`: the top level). */
  async addBookmark(parent: number[], index: number, title: string, page: number): Promise<void> {
    await this.call({ op: "addBookmark", parent, index, title, page });
  }

  async renameBookmark(path: number[], title: string): Promise<void> {
    await this.call({ op: "renameBookmark", path, title });
  }

  async deleteBookmark(path: number[]): Promise<void> {
    await this.call({ op: "deleteBookmark", path });
  }

  /** Moves a bookmark to child `index` of `toParent`; the indices count after it has been taken out. */
  async moveBookmark(from: number[], toParent: number[], index: number): Promise<void> {
    await this.call({ op: "moveBookmark", from, toParent, index });
  }

  async setBookmarkPage(path: number[], page: number): Promise<void> {
    await this.call({ op: "setBookmarkPage", path, page });
  }

  /** The files attached to the document and to its pages. */
  attachments(): Promise<AttachmentInfo[]> {
    return this.call({ op: "attachments" });
  }

  async addAttachment(name: string, bytes: Uint8Array, description?: string): Promise<void> {
    await this.call({ op: "addAttachment", name, bytes, description });
  }

  /** Removes a document-level attachment by its `key`. */
  async deleteAttachment(key: string): Promise<void> {
    await this.call({ op: "deleteAttachment", key });
  }

  /** The contents of attachment `index`, as the document is now. */
  attachmentBytes(index: number): Promise<Uint8Array> {
    return this.call({ op: "attachmentBytes", index });
  }

  /** What field scripts printed or asked for during edits since the last call. */
  takeJsOutput(): Promise<JsOutput> {
    return this.call({ op: "takeJsOutput" });
  }

  /** Protects with passwords and permissions; the next save is encrypted. */
  async protect(spec: ProtectSpec): Promise<void> {
    await this.call({ op: "protect", spec });
  }

  async removeProtection(): Promise<void> {
    await this.call({ op: "removeProtection" });
  }

  layers(): Promise<LayerInfo[]> {
    return this.call({ op: "layers" });
  }

  /** Shows or hides a layer for viewing (the file keeps its own choice); true when that changed the picture. */
  setLayerVisible(index: number, visible: boolean): Promise<boolean> {
    return this.call({ op: "setLayerVisible", index, visible });
  }

  /** Puts a picture on the page as a stamp (an image file: PNG, JPEG, TIFF, GIF, BMP). */
  async addPictureStamp(page: number, view: Box, name: string, bytes: Uint8Array): Promise<void> {
    await this.call({ op: "addPictureStamp", page, view, name, bytes });
  }

  /** Bakes typed text, marks and signatures into the page. */
  async flattenFillSign(): Promise<void> {
    await this.call({ op: "flattenFillSign" });
  }

  signatures(): Promise<SignatureInfo[]> {
    return this.call({ op: "signatures" });
  }

  /** Signs with a certificate file (PKCS #12) and returns the signed PDF. The document is final once signed. */
  signWithCertificate(p12: Uint8Array, password: string, spec: SignSpec = {}): Promise<Uint8Array> {
    return this.call({ op: "signWithCertificate", p12, password, spec });
  }

  /** Makes a new digital ID (a self-signed certificate) as a PKCS #12 file protected by `password`. */
  createDigitalId(name: string, organisation: string, email: string, password: string, years = 5): Promise<Uint8Array> {
    return this.call({ op: "createDigitalId", name, organisation, email, password, years, now: Math.floor(Date.now() / 1000) });
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
