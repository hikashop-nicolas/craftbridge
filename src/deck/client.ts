import { EngineError } from "./engine";
import type { Call, CommandInfo, Hit, LoadInfo, Overlay, PointerEvent, Rendered, Reply, ShowInfo, Tool } from "./protocol";

export { EngineError };
export type { CommandInfo, Hit, LoadInfo, Overlay, PointerEvent, Rendered, Tool };

export interface OpenOptions {
  /** A worker running `craftbridge/deck/worker`; one is created from `workerUrl` when omitted. */
  worker?: Worker;
  workerUrl?: string | URL;
  /** Where the browser finds deckcraft_wasm_bg.wasm, when the glue code cannot work it out. */
  wasmUrl?: string;
}

/** A presentation session (documents, undo history, tools). Every call runs in the worker. */
export class DeckSession {
  private nextId = 1;
  private pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>();
  private closed = false;

  /** @internal */
  constructor(private readonly worker: Worker) {
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
    if (this.closed) return Promise.reject(new EngineError("failed", "the session is closed"));
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

  /** Opens a .pptx (or DeckCraft) file as the active document. */
  load(name: string, bytes: Uint8Array): Promise<LoadInfo> {
    return this.call({ op: "load", name, bytes });
  }

  /** Every command the engine offers. */
  commands(): Promise<CommandInfo[]> {
    return this.call({ op: "commands" });
  }

  /** Runs a command (see `commands()`); what it answers. One finished command is one undo step. */
  execute<T = unknown>(id: string, params?: unknown): Promise<T> {
    return this.call({ op: "execute", command: id, params });
  }

  /** Picks the pointer tool (select, a shape to draw, a text box, ink). */
  async setTool(tool: Tool): Promise<void> {
    await this.call({ op: "setTool", tool });
  }

  /** A pointer event of the active tool, in slide points. */
  pointer<T = unknown>(event: PointerEvent): Promise<T> {
    return this.call({ op: "pointer", event });
  }

  hit(x: number, y: number, tol = 4): Promise<Hit | null> {
    return this.call({ op: "hit", x, y, tol });
  }

  /** The selection, the text being edited and the document's state, for the host to draw over the slide. */
  overlay(): Promise<Overlay> {
    return this.call({ op: "overlay" });
  }

  /** Draws slide `index` at `scale` device pixels per point. `edit` shows placeholder prompts. */
  render(index: number, scale: number, edit = false): Promise<Rendered> {
    return this.call({ op: "render", index, scale, edit });
  }

  /** The animation steps of slide `index` for a slide show. */
  showInfo(index: number): Promise<ShowInfo> {
    return this.call({ op: "showInfo", index });
  }

  /** Slide `index` at animation step `step`, `t` seconds into it (a step past the last: everything built). */
  renderStep(index: number, step: number, t: number, scale: number): Promise<Rendered> {
    return this.call({ op: "renderStep", index, step, t, scale });
  }

  /** The frame of slide `index`'s transition at progress `t` (0 to 1). */
  renderTransition(index: number, t: number, scale: number): Promise<Rendered> {
    return this.call({ op: "renderTransition", index, t, scale });
  }

  /** The presentation as a PDF; `params` as for the engine's `file.export` (layout, perPage, slides, ...). */
  exportPdf(params: unknown = {}): Promise<Uint8Array> {
    return this.call({ op: "exportPdf", params });
  }

  /** Slide `index` as a PNG at `scale` pixels per point. */
  exportPng(index: number, scale: number): Promise<Uint8Array> {
    return this.call({ op: "exportPng", index, scale });
  }

  /** The presentation as .pptx bytes. */
  save(): Promise<Uint8Array> {
    return this.call({ op: "save" });
  }

  /** Adds a font file (TTF, OTF, TTC) for rendering. */
  addFont(bytes: Uint8Array): Promise<unknown> {
    return this.call({ op: "addFont", bytes });
  }

  close(): void {
    this.closed = true;
    this.failAll(new EngineError("failed", "the session is closed"));
    this.worker.terminate();
  }
}

/** Starts the engine in a worker. */
export async function openDeck(options: OpenOptions = {}): Promise<DeckSession> {
  const worker = options.worker ?? new Worker(options.workerUrl ?? new URL("./worker.js", import.meta.url), { type: "module" });
  const session = new DeckSession(worker);
  try {
    await session.call({ op: "open", wasmUrl: options.wasmUrl });
  } catch (e) {
    session.close();
    throw e;
  }
  return session;
}
