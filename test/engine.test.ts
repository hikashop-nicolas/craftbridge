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
      return { width: 2, height: 1, warnings: ["content-truncated"], take_rgba: () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) };
    },
    text_blocks: () => JSON.stringify([{ index: 0, rect: [0, 0, 1, 1], view: [0, 0, 1, 1], text: "Hi", font: "F", size: 12, bold: false, italic: false, color: [0, 0, 0], rotation: 0, invisible: false }]),
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
    objects: () => JSON.stringify([{ kind: "text", index: 0, type: "text", text: "Hi", view: [0, 0, 1, 1] }]),
    move_objects: (_p, targets, dx, dy) => void calls.push(`move_objects ${targets} ${dx} ${dy}`),
    resize_object: (_p, kind, index, view) => void calls.push(`resize ${kind} ${index} ${view.join(",")}`),
    add_text: (_p, view, text, style) => void calls.push(`add_text ${view.join(",")} ${text} ${style}`),
    add_image: (_p, name, bytes) => void calls.push(`add_image ${name} ${bytes.length}`),
    delete_object: (_p, kind, index) => void calls.push(`delete_object ${kind} ${index}`),
    set_text: (_p, kind, index, text, style) => void calls.push(`set_text ${kind} ${index} ${text} ${style}`),
    cover: (_p, view) => void calls.push(`cover ${view.join(",")}`),
    find: (q, cs, ww, limit) => (calls.push(`find ${q} ${cs} ${ww} ${limit}`), JSON.stringify([{ page: 0, text: q, rects: [[1, 2, 3, 4]] }])),
    select_text: (_p, from, to) => (calls.push(`select ${from} ${to}`), JSON.stringify({ text: "x", rects: [[1, 2, 3, 4]] })),
    markup: (_p, kind, rects, color) => void calls.push(`markup ${kind} ${rects} ${color ?? "-"}`),
    add_link: (_p, view, target) => void calls.push(`add_link ${view} ${target}`),
    links: () => JSON.stringify([{ index: 0, view: [1, 2, 3, 4], uri: "https://a.example" }]),
    delete_link: (_p, i) => void calls.push(`delete_link ${i}`),
    annotations: () => JSON.stringify([{ index: 1, subtype: "Highlight", contents: null, view: [1, 2, 3, 4] }]),
    delete_annotation: (_p, i) => void calls.push(`delete_annotation ${i}`),
    fields: () => JSON.stringify([{ name: "n", kind: "text", value: null, view: [1, 2, 3, 4] }]),
    set_field: (name, value) => void calls.push(`set_field ${name} ${value}`),
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
    expect(out.value).toMatchObject({ width: 2, height: 1, warnings: ["content-truncated"] });
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
    // converting an error that already has its code must keep it (the worker converts twice)
    const once = toEngineError(new Error("needs-password: protected"));
    expect(toEngineError(once)).toBe(once);
    expect(toEngineError(once).code).toBe("needs-password");
  });

  it("passes object calls through with JSON for the structured arguments", () => {
    const { module, calls } = fakeModule();
    const e = new Engine(module);
    open(e);
    expect(e.handle({ op: "objects", page: 0 }).value).toMatchObject([{ kind: "text", text: "Hi" }]);
    e.handle({ op: "moveObjects", page: 0, targets: [{ kind: "text", index: 0 }], dx: 3, dy: -4 });
    e.handle({ op: "resizeObject", page: 0, target: { kind: "added", index: 1.9 }, view: [1, 2, 3, 4] });
    e.handle({ op: "addText", page: 0, view: [0, 0, 9, 9], text: "T", style: { bold: true } });
    e.handle({ op: "addText", page: 0, view: [0, 0, 9, 9], text: "U" });
    e.handle({ op: "addImage", page: 0, name: "a.png", bytes: new Uint8Array(3) });
    e.handle({ op: "deleteObject", page: 0, target: { kind: "image", index: 0 } });
    e.handle({ op: "setText", page: 0, target: { kind: "text", index: 2 }, style: { size: 20 } });
    e.handle({ op: "cover", page: 0, view: [1, 1, 5, 5] });
    expect(calls).toEqual([
      'move_objects [{"kind":"text","index":0}] 3 -4',
      "resize added 1 1,2,3,4",
      'add_text 0,0,9,9 T {"bold":true}',
      "add_text 0,0,9,9 U {}",
      "add_image a.png 3",
      "delete_object image 0",
      'set_text text 2 undefined {"size":20}',
      "cover 1,1,5,5",
    ]);
  });

  it("passes review calls through", () => {
    const { module, calls } = fakeModule();
    const e = new Engine(module);
    open(e);
    expect(e.handle({ op: "find", query: "ab" }).value).toMatchObject([{ text: "ab" }]);
    e.handle({ op: "find", query: "cd", caseSensitive: true, wholeWords: true, limit: 5 });
    expect(e.handle({ op: "selectText", page: 0, from: [1, 2], to: [3, 4] }).value).toMatchObject({ text: "x" });
    e.handle({ op: "markup", page: 0, kind: "underline", rects: [[1, 2, 3, 4]], color: [1, 0, 0] });
    e.handle({ op: "markup", page: 0, kind: "highlight", rects: [[1, 2, 3, 4]] });
    e.handle({ op: "addLink", page: 0, view: [1, 2, 3, 4], target: "page:2" });
    expect(e.handle({ op: "links", page: 0 }).value).toMatchObject([{ uri: "https://a.example" }]);
    e.handle({ op: "deleteLink", page: 0, index: 2.7 });
    expect(e.handle({ op: "annotations", page: 0 }).value).toMatchObject([{ subtype: "Highlight" }]);
    e.handle({ op: "deleteAnnotation", page: 0, index: 1 });
    expect(e.handle({ op: "fields", page: 0 }).value).toMatchObject([{ name: "n" }]);
    e.handle({ op: "setField", name: "n", value: { check: true } });
    expect(calls).toEqual([
      "find ab false false 200",
      "find cd true true 5",
      "select 1,2 3,4",
      'markup underline [[1,2,3,4]] 1,0,0',
      'markup highlight [[1,2,3,4]] -',
      "add_link 1,2,3,4 page:2",
      "delete_link 2",
      "delete_annotation 1",
      'set_field n {"check":true}',
    ]);
  });
});
