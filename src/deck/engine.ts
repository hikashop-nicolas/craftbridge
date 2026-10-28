import type { Call, CommandInfo, ErrorCode, Hit, LoadInfo, Overlay, PointerEvent, MasterInfo, Rendered, ShowInfo } from "./protocol";

/** The slice of the generated `Deck` class the engine uses. */
export interface WasmDeck {
  commands(): string;
  execute(id: string, params: string): string;
  open(name: string, bytes: Uint8Array): string;
  save(): Uint8Array;
  add_font(bytes: Uint8Array): string;
  render(index: number, scale: number, edit: boolean): { width: number; height: number; take_rgba(): Uint8Array; free?(): void };
  show_info(index: number): string;
  render_step(index: number, step: number, t: number, scale: number): { width: number; height: number; take_rgba(): Uint8Array; free?(): void };
  render_show(index: number, step: number, t: number, plays: string, scale: number): { width: number; height: number; take_rgba(): Uint8Array; free?(): void };
  render_transition(index: number, t: number, scale: number): { width: number; height: number; take_rgba(): Uint8Array; free?(): void };
  export_pdf(params: string): Uint8Array;
  export_png(index: number, scale: number): Uint8Array;
  masters(): string;
  render_layout(master: number, layout: number, scale: number): { width: number; height: number; take_rgba(): Uint8Array; free?(): void };
  set_tool(tool: string): void;
  pointer(event: string): string;
  hit(x: number, y: number, tol: number): string;
  overlay(): string;
  free?(): void;
}

export interface WasmModule {
  create(): WasmDeck;
}

export class EngineError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function toEngineError(e: unknown): EngineError {
  if (e instanceof EngineError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new EngineError(/^command .* is not available/.test(message) ? "invalid" : "failed", message);
}

/** Runs calls against one wasm `Deck`; the worker owns an instance. */
export class Engine {
  private deck: WasmDeck | null = null;

  constructor(private readonly wasm: WasmModule) {}

  private need(): WasmDeck {
    this.deck ??= this.wasm.create();
    return this.deck;
  }

  handle(call: Call): { value: unknown; transfer?: ArrayBuffer[] } {
    try {
      return this.run(call);
    } catch (e) {
      throw toEngineError(e);
    }
  }

  private run(call: Call): { value: unknown; transfer?: ArrayBuffer[] } {
    switch (call.op) {
      case "open":
        this.need();
        return { value: null };
      case "load":
        return { value: JSON.parse(this.need().open(call.name, call.bytes)) as LoadInfo };
      case "commands":
        return { value: JSON.parse(this.need().commands()) as CommandInfo[] };
      case "execute":
        return { value: JSON.parse(this.need().execute(call.command, call.params === undefined ? "" : JSON.stringify(call.params))) as unknown };
      case "setTool":
        this.need().set_tool(JSON.stringify(call.tool));
        return { value: null };
      case "pointer":
        return { value: JSON.parse(this.need().pointer(JSON.stringify(call.event satisfies PointerEvent))) as unknown };
      case "hit":
        return { value: JSON.parse(this.need().hit(call.x, call.y, call.tol)) as Hit | null };
      case "overlay":
        return { value: JSON.parse(this.need().overlay()) as Overlay };
      case "render": {
        const r = this.need().render(call.index, call.scale, call.edit ?? false);
        const rgba = r.take_rgba();
        const out: Rendered = { width: r.width, height: r.height, rgba };
        r.free?.();
        return { value: out, transfer: [rgba.buffer as ArrayBuffer] };
      }
      case "showInfo":
        return { value: JSON.parse(this.need().show_info(call.index)) as ShowInfo };
      case "renderStep":
      case "renderShow":
      case "renderTransition": {
        const d = this.need();
        const r = call.op === "renderStep" ? d.render_step(call.index, call.step, call.t, call.scale) : call.op === "renderShow" ? d.render_show(call.index, call.step, call.t, JSON.stringify(call.plays), call.scale) : d.render_transition(call.index, call.t, call.scale);
        const rgba = r.take_rgba();
        const out: Rendered = { width: r.width, height: r.height, rgba };
        r.free?.();
        return { value: out, transfer: [rgba.buffer as ArrayBuffer] };
      }
      case "exportPdf": {
        const bytes = this.need().export_pdf(JSON.stringify(call.params ?? {}));
        return { value: bytes, transfer: [bytes.buffer as ArrayBuffer] };
      }
      case "exportPng": {
        const bytes = this.need().export_png(call.index, call.scale);
        return { value: bytes, transfer: [bytes.buffer as ArrayBuffer] };
      }
      case "masters":
        return { value: JSON.parse(this.need().masters()) as MasterInfo[] };
      case "renderLayout": {
        const r = this.need().render_layout(call.master, call.layout, call.scale);
        const rgba = r.take_rgba();
        const out: Rendered = { width: r.width, height: r.height, rgba };
        r.free?.();
        return { value: out, transfer: [rgba.buffer as ArrayBuffer] };
      }
      case "save": {
        const bytes = this.need().save();
        return { value: bytes, transfer: [bytes.buffer as ArrayBuffer] };
      }
      case "addFont":
        return { value: JSON.parse(this.need().add_font(call.bytes)) as unknown };
    }
  }
}
