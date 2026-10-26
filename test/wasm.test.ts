// Runs the handler against the real engine when `npm run build:wasm` has produced wasm/pdf/.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { Engine, type WasmModule } from "../src/pdf/engine";

const dir = new URL("../wasm/pdf/", import.meta.url);
const built = fs.existsSync(new URL("pdfcraft_wasm_bg.wasm", dir));

/** A minimal `n`-page document; page `i` shows "Page i+1". */
function fixture(n: number): Uint8Array {
  const objs: string[] = ["<< /Type /Catalog /Pages 2 0 R >>"];
  const kids = Array.from({ length: n }, (_, i) => `${4 + 2 * i} 0 R`);
  objs.push(`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${n} /MediaBox [0 0 200 300] >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let i = 0; i < n; i++) {
    objs.push(`<< /Type /Page /Parent 2 0 R /Contents ${5 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    const body = `BT /F1 24 Tf 20 150 Td (Page ${i + 1}) Tj ET`;
    objs.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
  }
  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe.skipIf(!built)("the real engine", () => {
  async function engine(): Promise<Engine> {
    const glue = await import(/* @vite-ignore */ new URL("pdfcraft_wasm.js", dir).href);
    glue.initSync({ module: fs.readFileSync(new URL("pdfcraft_wasm_bg.wasm", dir)) });
    const wasm: WasmModule = {
      open: (bytes, password) => new glue.Pdf(bytes, password),
      stamps: () => glue.Pdf.stamps(),
      createDigitalId: (...a: [string, string, string, string, number, number]) => glue.Pdf.create_digital_id(...a),
    };
    return new Engine(wasm);
  }

  it("opens, renders, edits, saves and reopens", async () => {
    const e = await engine();
    expect(e.handle({ op: "open", bytes: fixture(2) }).value).toEqual({ pageCount: 2, encrypted: false });
    expect(e.handle({ op: "pageSize", page: 0 }).value).toEqual([200, 300]);
    const page = e.handle({ op: "render", page: 0, scale: 1 }).value as { width: number; height: number; rgba: Uint8Array };
    expect([page.width, page.height]).toEqual([200, 300]);
    expect(page.rgba.length).toBe(200 * 300 * 4);
    expect(e.handle({ op: "textBlocks", page: 0 }).value).toMatchObject([{ text: "Page 1" }]);
    const [block] = e.handle({ op: "textBlocks", page: 0 }).value as { view: number[] }[];
    expect(block!.view[2]).toBeLessThanOrEqual(200);
    expect(block!.view[0]).toBeLessThan(block!.view[2]!);
    e.handle({ op: "editTextBlock", page: 0, block: 0, text: "Edited" });
    expect(e.handle({ op: "textBlocks", page: 0 }).value).toMatchObject([{ text: "Edited" }]);
    const saved = e.handle({ op: "save" }).value as Uint8Array;
    const again = await engine();
    expect(again.handle({ op: "open", bytes: saved }).value).toMatchObject({ pageCount: 2 });
    expect(again.handle({ op: "textBlocks", page: 0 }).value).toMatchObject([{ text: "Edited" }]);
  });

  it("reports a file that is not a PDF with the invalid code", async () => {
    const e = await engine();
    expect(() => e.handle({ op: "open", bytes: new TextEncoder().encode("hello") })).toThrow(expect.objectContaining({ code: "invalid" }));
  });

  it("changes pages and undoes", async () => {
    const e = await engine();
    e.handle({ op: "open", bytes: fixture(3) });
    e.handle({ op: "deletePages", pages: [0] });
    expect(e.handle({ op: "info" }).value).toMatchObject({ pageCount: 2 });
    e.handle({ op: "undo" });
    expect(e.handle({ op: "info" }).value).toMatchObject({ pageCount: 3 });
    e.handle({ op: "rotatePages", pages: [0], degrees: 90 });
    expect(e.handle({ op: "pageSize", page: 0 }).value).toEqual([300, 200]);
  });

  it("lists, adds, moves, restyles and deletes page objects", async () => {
    const e = await engine();
    e.handle({ op: "open", bytes: fixture(1) });
    const first = e.handle({ op: "objects", page: 0 }).value as { kind: string; index: number; text: string; view: number[] }[];
    expect(first).toMatchObject([{ kind: "text", index: 0, text: "Page 1" }]);

    e.handle({ op: "addText", page: 0, view: [20, 40, 180, 80], text: "Added words", style: { size: 18, bold: true, color: [0.8, 0, 0], align: "center" } });
    const added = (e.handle({ op: "objects", page: 0 }).value as { kind: string; index: number; text: string }[]).find((o) => o.kind === "added");
    expect(added).toMatchObject({ index: 0, text: "Added words" });

    e.handle({ op: "setText", page: 0, target: { kind: "added", index: 0 }, text: "Changed", style: { italic: true } });
    e.handle({ op: "moveObjects", page: 0, targets: [{ kind: "text", index: 0 }, { kind: "added", index: 0 }], dx: 5, dy: 10 });
    const moved = e.handle({ op: "objects", page: 0 }).value as { kind: string; text: string; view: number[] }[];
    expect(moved.find((o) => o.kind === "added")).toMatchObject({ text: "Changed" });
    expect(moved.find((o) => o.kind === "text")!.view[1]).toBeGreaterThan(first[0]!.view[1]!);

    e.handle({ op: "resizeObject", page: 0, target: { kind: "added", index: 0 }, view: [20, 40, 120, 90] });
    e.handle({ op: "cover", page: 0, view: [0, 0, 50, 50] });
    e.handle({ op: "deleteObject", page: 0, target: { kind: "added", index: 0 } });
    expect((e.handle({ op: "objects", page: 0 }).value as { kind: string }[]).some((o) => o.kind === "added")).toBe(false);
    expect(() => e.handle({ op: "moveObjects", page: 0, targets: [{ kind: "added", index: 3 }], dx: 1, dy: 1 })).toThrow();
  });

  it("finds text, selects it, marks it up and adds a link", async () => {
    const e = await engine();
    e.handle({ op: "open", bytes: fixture(2) });
    const found = e.handle({ op: "find", query: "page 2" }).value as { page: number; text: string; rects: number[][] }[];
    expect(found).toMatchObject([{ page: 1, text: "Page 2" }]);
    expect(found[0]!.rects).toHaveLength(1);
    const [x0, y0, x1, y1] = found[0]!.rects[0]!;
    const selection = e.handle({ op: "selectText", page: 1, from: [x0! + 1, (y0! + y1!) / 2], to: [x1! - 1, (y0! + y1!) / 2] }).value as { text: string; rects: [number, number, number, number][] };
    expect(selection.text).toContain("Page");
    e.handle({ op: "markup", page: 1, kind: "highlight", rects: selection.rects, color: [1, 0.9, 0] });
    expect(e.handle({ op: "annotations", page: 1 }).value).toMatchObject([{ subtype: "Highlight" }]);
    e.handle({ op: "addLink", page: 0, view: [10, 10, 100, 40], target: "https://example.com" });
    expect(e.handle({ op: "links", page: 0 }).value).toMatchObject([{ uri: "https://example.com" }]);
    expect(() => e.handle({ op: "addLink", page: 0, view: [10, 10, 100, 40], target: "javascript:alert(1)" })).toThrow();
    expect(e.handle({ op: "fields", page: 0 }).value).toEqual([]);
    expect(e.handle({ op: "find", query: "" }).value).toEqual([]);
  });

  it("adds a comment and a field, makes a digital ID in the browser and signs with it", async () => {
    const e = await engine();
    e.handle({ op: "open", bytes: fixture(1) });
    e.handle({ op: "addAnnotation", page: 0, spec: { type: "note", at: [20, 30], contents: "Check" } });
    e.handle({ op: "addAnnotation", page: 0, spec: { type: "stamp", box: [20, 60, 140, 90], stamp: "Approved" } });
    e.handle({ op: "addField", page: 0, view: [20, 120, 120, 142], spec: { type: "text", name: "Name" } });
    expect((e.handle({ op: "annotations", page: 0 }).value as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect((e.handle({ op: "stamps" }).value as { name: string }[]).some((s) => s.name === "Approved")).toBe(true);
    const id = e.handle({ op: "createDigitalId", name: "Ada Example", organisation: "", email: "", password: "pw", years: 2, now: 1_700_000_000 }).value as Uint8Array;
    expect(id.length).toBeGreaterThan(200);
    const signed = e.handle({ op: "signWithCertificate", p12: id, password: "pw", spec: { page: 0, box: [20, 200, 160, 260] } }).value as Uint8Array;
    expect(new TextDecoder().decode(signed.slice(0, 4))).toBe("%PDF");
    const again = await engine();
    again.handle({ op: "open", bytes: signed });
    expect(again.handle({ op: "signatures" }).value).toMatchObject([{ signed: true, signer: "Ada Example" }]);
  });

  it("signs with an RSA certificate in the browser build", async () => {
    const p12 = process.env.RSA_P12;
    if (!p12) return;
    const e = await engine();
    e.handle({ op: "open", bytes: fixture(1) });
    const signed = e.handle({ op: "signWithCertificate", p12: new Uint8Array(fs.readFileSync(p12)), password: "pw", spec: { page: 0, box: [20, 200, 160, 260] } }).value as Uint8Array;
    const again = await engine();
    again.handle({ op: "open", bytes: signed });
    expect(again.handle({ op: "signatures" }).value).toMatchObject([{ signed: true }]);
  });
});
