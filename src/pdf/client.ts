import { EngineError } from "./engine";
import type { Call, DocumentInfo, History, Rendered, Reply, TextBlock, Tile } from "./protocol";

export { EngineError };
export type { DocumentInfo, History, Rendered, TextBlock, Tile };

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

  private async refresh(): Promise<void> {
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
