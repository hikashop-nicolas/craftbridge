// The request handler, free of Worker and wasm loading so it can be tested with a stand-in module.

import type { ScriptEvent, AnnotationInfo, Call, DocumentInfo, FieldInfo, FindMatch, FieldActionInfo, History, JsOutput, LayerInfo, LinkInfo, PageObject, Rendered, SignatureInfo, StampInfo, TextBlock, TextSelection } from "./protocol";
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
  insert_pages_from(name: string, bytes: Uint8Array, at: number): void;
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
  add_annotation(page: number, spec: string): void;
  set_annotation_contents(page: number, index: number, text: string): void;
  add_field(page: number, view: number[], spec: string): void;
  delete_field(name: string): void;
  delete_field_widget(name: string, widget: number): void;
  set_field_props(name: string, spec: string): void;
  field_actions(name: string): string;
  set_field_actions(name: string, actions: string): void;
  run_action(action: string, target?: string): string;
  take_js_output(): string;
  field_scripts(name: string): string;
  set_field_script(name: string, event: string, script: string): void;
  protect(spec: string): void;
  remove_protection(): void;
  layers(): string;
  set_layer_visible(index: number, visible: boolean): boolean;
  add_picture_stamp(page: number, view: number[], name: string, bytes: Uint8Array): void;
  flatten_fill_sign(): void;
  signatures(): string;
  sign_with_certificate(p12: Uint8Array, password: string, spec: string): Uint8Array;
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
  /** The stamps that can be added, as JSON. */
  stamps(): string;
  /** A new digital ID as a PKCS #12 file; `now` is Unix seconds. */
  createDigitalId(name: string, organisation: string, email: string, password: string, years: number, now: number): Uint8Array;
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
      case "insertPagesFrom":
        this.need().insert_pages_from(call.name, call.bytes, Math.trunc(call.at));
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
      case "addAnnotation":
        this.need().add_annotation(call.page, JSON.stringify(call.spec));
        return { value: null };
      case "setAnnotationContents":
        this.need().set_annotation_contents(call.page, Math.trunc(call.index), call.text);
        return { value: null };
      case "stamps":
        return { value: JSON.parse(this.wasm.stamps()) as StampInfo[] };
      case "addField":
        this.need().add_field(call.page, call.view, JSON.stringify(call.spec));
        return { value: null };
      case "deleteFieldWidget":
        this.need().delete_field_widget(call.name, Math.trunc(call.widget));
        return { value: null };
      case "deleteField":
        this.need().delete_field(call.name);
        return { value: null };
      case "setFieldProps":
        this.need().set_field_props(call.name, JSON.stringify(call.change));
        return { value: null };
      case "fieldActions":
        return { value: JSON.parse(this.need().field_actions(call.name)) as FieldActionInfo[] };
      case "setFieldActions":
        this.need().set_field_actions(call.name, JSON.stringify(call.actions));
        return { value: null };
      case "runAction":
        return { value: JSON.parse(this.need().run_action(JSON.stringify(call.action), call.target)) as JsOutput };
      case "fieldScripts":
        return { value: JSON.parse(this.need().field_scripts(call.name)) as Partial<Record<ScriptEvent, string>> };
      case "setFieldScript":
        this.need().set_field_script(call.name, call.event, call.script);
        return { value: null };
      case "takeJsOutput":
        return { value: JSON.parse(this.need().take_js_output()) as JsOutput };
      case "protect":
        this.need().protect(JSON.stringify(call.spec));
        return { value: null };
      case "removeProtection":
        this.need().remove_protection();
        return { value: null };
      case "layers":
        return { value: JSON.parse(this.need().layers()) as LayerInfo[] };
      case "setLayerVisible":
        return { value: this.need().set_layer_visible(Math.trunc(call.index), call.visible) };
      case "addPictureStamp":
        this.need().add_picture_stamp(call.page, call.view, call.name, call.bytes);
        return { value: null };
      case "flattenFillSign":
        this.need().flatten_fill_sign();
        return { value: null };
      case "signatures":
        return { value: JSON.parse(this.need().signatures()) as SignatureInfo[] };
      case "signWithCertificate": {
        const bytes = this.need().sign_with_certificate(call.p12, call.password, JSON.stringify(call.spec));
        return { value: bytes, transfer: [bytes.buffer as ArrayBuffer] };
      }
      case "createDigitalId": {
        const bytes = this.wasm.createDigitalId(call.name, call.organisation, call.email, call.password, Math.trunc(call.years), call.now);
        return { value: bytes, transfer: [bytes.buffer as ArrayBuffer] };
      }
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
