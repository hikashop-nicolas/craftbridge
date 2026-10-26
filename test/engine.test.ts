import { describe, expect, it } from "vitest";
import { Engine, EngineError, toEngineError, type WasmModule, type WasmPdf } from "../src/pdf/engine";

// A stand-in for the wasm module, so the handler's logic is tested without building the engine.
function fakeModule(opts: { pages?: number; fail?: string } = {}): { module: WasmModule; calls: string[] } {
  const calls: string[] = [];
  let pages = opts.pages ?? 2;
  const pdf: WasmPdf = {
    page_count: () => pages,
    page_size: (p) => (p < pages ? new Float32Array([200, 300]) : new Float32Array([])),
    is_encrypted: () => false,
    render: (p, scale, tile) => {
      calls.push(`render ${p} ${scale} ${tile ? [...tile].join(",") : "-"}`);
      return { width: 2, height: 1, take_rgba: () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) };
    },
    text_blocks: () => JSON.stringify([{ index: 0, rect: [0, 0, 1, 1], text: "Hi", font: "F", size: 12, bold: false, italic: false, color: [0, 0, 0], rotation: 0, invisible: false }]),
    edit_text_block: (p, b, t) => void calls.push(`edit ${p} ${b} ${t}`),
    delete_pages: (list) => {
      calls.push(`delete ${[...list].join(",")}`);
      pages -= list.length;
    },
    rotate_pages: (list, d) => void calls.push(`rotate ${[...list].join(",")} ${d}`),
    move_pages: (list, to) => void calls.push(`move ${[...list].join(",")} ${to}`),
    insert_blank_page: () => void (pages += 1),
    can_undo: () => (calls.length ? "Edit" : undefined),
    can_redo: () => null,
    undo: () => void calls.push("undo"),
    redo: () => void calls.push("redo"),
    save: () => new Uint8Array([37, 80, 68, 70]),
    save_full: () => new Uint8Array([1]),
  };
  return {
    calls,
    module: {
      open: (bytes) => {
        if (opts.fail) throw new Error(opts.fail);
        if (bytes.length === 0) throw new Error("invalid: the file is not a readable PDF");
        return pdf;
      },
    },
  };
}

const open = (e: Engine) => e.handle({ op: "open", bytes: new Uint8Array([1]) });

describe("Engine", () => {
  it("opens, reports the document and answers page queries", () => {
    const e = new Engine(fakeModule().module);
    expect(open(e).value).toEqual({ pageCount: 2, encrypted: false });
    expect(e.handle({ op: "pageSize", page: 0 }).value).toEqual([200, 300]);
    expect(e.handle({ op: "pageSize", page: 9 }).value).toBeNull();
  });

  it("renders and hands the pixel buffer over by transfer", () => {
    const { module, calls } = fakeModule();
    const e = new Engine(module);
    open(e);
    const out = e.handle({ op: "render", page: 1, scale: 2, tile: [0, 0, 10, 20] });
    expect(calls).toContain("render 1 2 0,0,10,20");
    expect(out.value).toMatchObject({ width: 2, height: 1 });
    expect(out.transfer).toHaveLength(1);
  });

  it("parses text blocks and passes edits and page changes through", () => {
    const { module, calls } = fakeModule();
    const e = new Engine(module);
    open(e);
    expect(e.handle({ op: "textBlocks", page: 0 }).value).toMatchObject([{ text: "Hi", size: 12 }]);
    e.handle({ op: "editTextBlock", page: 0, block: 0, text: "New" });
    e.handle({ op: "deletePages", pages: [1.9, 0] });
    e.handle({ op: "rotatePages", pages: [0], degrees: 90 });
    e.handle({ op: "movePages", pages: [0], to: 1 });
    expect(calls).toEqual(["edit 0 0 New", "delete 1,0", "rotate 0 90", "move 0 1"]);
    expect(e.handle({ op: "info" }).value).toEqual({ pageCount: 0, encrypted: false });
  });

  it("reports history and saves", () => {
    const e = new Engine(fakeModule().module);
    open(e);
    expect(e.handle({ op: "history" }).value).toEqual({ undo: null, redo: null });
    e.handle({ op: "undo" });
    expect(e.handle({ op: "history" }).value).toEqual({ undo: "Edit", redo: null });
    expect(e.handle({ op: "save" }).value).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(e.handle({ op: "save", full: true }).value).toEqual(new Uint8Array([1]));
  });

  it("refuses calls before a document is open and after it is closed", () => {
    const e = new Engine(fakeModule().module);
    expect(() => e.handle({ op: "info" })).toThrow(EngineError);
    open(e);
    e.handle({ op: "close" });
    expect(() => e.handle({ op: "render", page: 0, scale: 1 })).toThrow(/no document/);
  });

  it("turns engine messages into error codes", () => {
    const e = new Engine(fakeModule().module);
    expect(() => e.handle({ op: "open", bytes: new Uint8Array() })).toThrow(expect.objectContaining({ code: "invalid" }));
    expect(toEngineError(new Error("needs-password: the document is protected by a password"))).toMatchObject({ code: "needs-password", message: "the document is protected by a password" });
    expect(toEngineError(new Error("wrong-password: nope"))).toMatchObject({ code: "wrong-password" });
    expect(toEngineError("boom")).toMatchObject({ code: "failed", message: "boom" });
  });
});
