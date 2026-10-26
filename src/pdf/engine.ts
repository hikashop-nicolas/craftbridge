// The request handler, free of Worker and wasm loading so it can be tested with a stand-in module.

import type { AnnotationInfo, Call, DocumentInfo, FieldInfo, FindMatch, History, LinkInfo, PageObject, Rendered, TextBlock, TextSelection } from "./protocol";
import type { ErrorCode } from "./protocol";

/** The slice of the wasm-bindgen `Pdf` class the handler uses. */
export interface WasmPdf {
  page_count(): number;
  page_size(page: number): Float32Array | number[];
  is_encrypted(): boolean;
  render(page: number, scale: number, tile?: Uint32Array | number[]): { width: number; height: number; warnings?: string[]; take_rgba(): Uint8Array; free?(): void };
  text_blocks(page: number): string;
  edit_text_block(page: number, block: number, text: string): void;
  delete_pages(pages: Uint32Array | number[]): void;
  rotate_pages(pages: Uint32Array | number[], degrees: number): void;
  move_pages(pages: Uint32Array | number[], to: number): void;
  insert_blank_page(at: number, width: number, height: number): void;
  objects(page: number): string;
  move_objects(page: number, targets: string, dx: number, dy: number): void;
  resize_object(page: number, kind: string, index: number, view: number[]): void;
  rotate_object(page: number, kind: string, index: number, quarter_turns: number): void;
  add_text(page: number, view: number[], text: string, style: string): void;
  add_image(page: number, name: string, bytes: Uint8Array, view?: number[]): void;
  delete_object(page: number, kind: string, index: number): void;
  set_text(page: number, kind: string, index: number, text: string | undefined, style: string): void;
  cover(page: number, view: number[]): void;
  find(query: string, caseSensitive: boolean, wholeWords: boolean, limit: number): string;
  select_text(page: number, from: number[], to: number[]): string;
  markup(page: number, kind: string, rects: string, color?: number[]): void;
  add_link(page: number, view: number[], target: string): void;
  links(page: number): string;
  delete_link(page: number, index: number): void;
  annotations(page: number): string;
  delete_annotation(page: number, index: number): void;
  fields(page: number): string;
  set_field(name: string, value: string): void;
  can_undo(): string | undefined | null;
  can_redo(): string | undefined | null;
  undo(): void;
  redo(): void;
  save(): Uint8Array;
  save_full(): Uint8Array;
  free?(): void;
}

export interface WasmModule {
  open(bytes: Uint8Array, password?: string): WasmPdf;
}

export class EngineError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
  }
}

/** wasm-bindgen errors arrive as Error objects; an open error starts with its code and a colon. */
export function toEngineError(e: unknown): EngineError {
  // Already one: converting again would read its message without the code prefix and lose the code.
  if (e instanceof EngineError) return e;
  const message = e instanceof Error ? e.message : String(e);
  const m = /^(needs-password|wrong-password|invalid): ?([\s\S]*)$/.exec(message);
  return m ? new EngineError(m[1] as ErrorCode, m[2] || message) : new EngineError("failed", message);
}

// usize is 32 bits on wasm32, so wasm-bindgen takes plain index arrays.
const indices = (pages: number[]): number[] => pages.map((p) => Math.trunc(p));

export class Engine {
  private pdf: WasmPdf | null = null;

  constructor(private readonly wasm: WasmModule) {}

  private need(): WasmPdf {
    if (!this.pdf) throw new EngineError("failed", "no document is open");
    return this.pdf;
  }

  handle(call: Call): { value: unknown; transfer?: ArrayBuffer[] } {
    try {
      return this.run(call);
    } catch (e) {
      throw e instanceof EngineError ? e : toEngineError(e);
    }
  }

  private run(call: Call): { value: unknown; transfer?: ArrayBuffer[] } {
    switch (call.op) {
      case "open": {
        this.pdf?.free?.();
        this.pdf = this.wasm.open(call.bytes, call.password);
        return { value: this.info() };
      }
      case "info":
        return { value: this.info() };
      case "pageSize": {
        const size = this.need().page_size(call.page);
        return { value: size.length === 2 ? [size[0], size[1]] : null };
      }
      case "render": {
        const r = this.need().render(call.page, call.scale, call.tile);
        const rgba = r.take_rgba();
        const out: Rendered = { width: r.width, height: r.height, rgba, warnings: r.warnings ?? [] };
        r.free?.();
        return { value: out, transfer: [rgba.buffer as ArrayBuffer] };
      }
      case "textBlocks":
        return { value: JSON.parse(this.need().text_blocks(call.page)) as TextBlock[] };
      case "editTextBlock":
        this.need().edit_text_block(call.page, call.block, call.text);
        return { value: null };
      case "deletePages":
        this.need().delete_pages(indices(call.pages));
        return { value: null };
      case "rotatePages":
        this.need().rotate_pages(indices(call.pages), Math.trunc(call.degrees));
        return { value: null };
      case "movePages":
        this.need().move_pages(indices(call.pages), Math.trunc(call.to));
        return { value: null };
      case "insertBlankPage":
        this.need().insert_blank_page(Math.trunc(call.at), call.width, call.height);
        return { value: null };
      case "objects":
        return { value: JSON.parse(this.need().objects(call.page)) as PageObject[] };
      case "moveObjects":
        this.need().move_objects(call.page, JSON.stringify(call.targets), call.dx, call.dy);
        return { value: null };
      case "rotateObject":
        this.need().rotate_object(call.page, call.target.kind, Math.trunc(call.target.index), Math.trunc(call.quarterTurns));
        return { value: null };
      case "resizeObject":
        this.need().resize_object(call.page, call.target.kind, Math.trunc(call.target.index), call.view);
        return { value: null };
      case "addText":
        this.need().add_text(call.page, call.view, call.text, JSON.stringify(call.style ?? {}));
        return { value: null };
      case "addImage":
        this.need().add_image(call.page, call.name, call.bytes, call.view);
        return { value: null };
      case "deleteObject":
        this.need().delete_object(call.page, call.target.kind, Math.trunc(call.target.index));
        return { value: null };
      case "setText":
        this.need().set_text(call.page, call.target.kind, Math.trunc(call.target.index), call.text, JSON.stringify(call.style ?? {}));
        return { value: null };
      case "cover":
        this.need().cover(call.page, call.view);
        return { value: null };
      case "find":
        return { value: JSON.parse(this.need().find(call.query, call.caseSensitive ?? false, call.wholeWords ?? false, call.limit ?? 200)) as FindMatch[] };
      case "selectText":
        return { value: JSON.parse(this.need().select_text(call.page, call.from, call.to)) as TextSelection };
      case "markup":
        this.need().markup(call.page, call.kind, JSON.stringify(call.rects), call.color);
        return { value: null };
      case "addLink":
        this.need().add_link(call.page, call.view, call.target);
        return { value: null };
      case "links":
        return { value: JSON.parse(this.need().links(call.page)) as LinkInfo[] };
      case "deleteLink":
        this.need().delete_link(call.page, Math.trunc(call.index));
        return { value: null };
      case "annotations":
        return { value: JSON.parse(this.need().annotations(call.page)) as AnnotationInfo[] };
      case "deleteAnnotation":
        this.need().delete_annotation(call.page, Math.trunc(call.index));
        return { value: null };
      case "fields":
        return { value: JSON.parse(this.need().fields(call.page)) as FieldInfo[] };
      case "setField":
        this.need().set_field(call.name, JSON.stringify(call.value));
        return { value: null };
      case "history": {
        const pdf = this.need();
        const h: History = { undo: pdf.can_undo() ?? null, redo: pdf.can_redo() ?? null };
        return { value: h };
      }
      case "undo":
        this.need().undo();
        return { value: null };
      case "redo":
        this.need().redo();
        return { value: null };
      case "save": {
        const bytes = call.full ? this.need().save_full() : this.need().save();
        return { value: bytes, transfer: [bytes.buffer as ArrayBuffer] };
      }
      case "close":
        this.pdf?.free?.();
        this.pdf = null;
        return { value: null };
    }
  }

  private info(): DocumentInfo {
    const pdf = this.need();
    return { pageCount: pdf.page_count(), encrypted: pdf.is_encrypted() };
  }
}
