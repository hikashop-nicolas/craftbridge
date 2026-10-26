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
    const wasm: WasmModule = { open: (bytes, password) => new glue.Pdf(bytes, password) };
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
});
