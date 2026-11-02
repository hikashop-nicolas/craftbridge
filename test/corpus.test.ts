// Runs real-world documents (test/corpus/) through the real wasm engine, so an engine update that breaks one is noticed.
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import { Engine, type WasmModule } from "../src/pdf/engine";
import type { Box, FieldInfo, TextBlock } from "../src/pdf/protocol";

const wasm = new URL("../wasm/pdf/", import.meta.url);
const corpus = new URL("./corpus/", import.meta.url);
const built = fs.existsSync(new URL("pdfcraft_wasm_bg.wasm", wasm));

interface Entry { file: string; sha256: string }
const manifest: Entry[] = JSON.parse(fs.readFileSync(new URL("manifest.json", corpus), "utf8"));
const bytesOf = (file: string): Uint8Array => fs.readFileSync(new URL(file, corpus));

/** What each document must keep doing. `ink` is the share of dark pixels on page 1 at scale 1, as a range read from a checked run. */
const docs = [
  { file: "irs-f1040-2025.pdf", pages: 2, phrase: "Individual Income Tax Return", ink: [0.12, 0.28], blocks: 110, fields: 199 },
  { file: "irs-fw9-2024.pdf", pages: 6, phrase: "Taxpayer Identification Number", ink: [0.1, 0.23], blocks: 35, fields: 23 },
  { file: "nist-csf-1-1.pdf", pages: 55, phrase: "Cybersecurity Framework", ink: [0.004, 0.03], blocks: 3, fields: 0 },
  { file: "plos-one-0000308.pdf", pages: 5, phrase: "Sharing Detailed Research Data", ink: [0.08, 0.17], blocks: 7, fields: 0 },
  { file: "digital-agency-terms-ja.pdf", pages: 9, phrase: "政府標準利用規約", ink: [0.06, 0.13], blocks: 11, fields: 0 },
  { file: "pdf20-utf8-test.pdf", pages: 1, phrase: "UTF-8", ink: [0.008, 0.03], blocks: 1, fields: 0 },
  { file: "pdfium-xfa-email.pdf", pages: 1, phrase: "Text Field", ink: [0.005, 0.02], blocks: 5, fields: 10 },
] as const;

type Rgba = { width: number; height: number; rgba: Uint8Array };

describe("the corpus", () => {
  it("lists every file, with the hash it was downloaded with", () => {
    const onDisk = fs.readdirSync(corpus).filter((f) => f.endsWith(".pdf")).sort();
    expect(manifest.map((m) => m.file).sort()).toEqual(onDisk);
    expect(docs.map((d) => d.file).sort()).toEqual(onDisk);
    for (const m of manifest) expect(crypto.createHash("sha256").update(bytesOf(m.file)).digest("hex"), m.file).toBe(m.sha256);
  });
});

describe.skipIf(!built)("the real engine on real documents", () => {
  // the faces the module is built without, added once before any document, as the worker does
  const faces = [
    ["BIZUDPGothic-Regular.ttf", "BIZ UDPGothic", "Jpan,Latn"],
    ["OmnitextHans-Regular.otf", "Omnitext Hans", "Hans"],
    ["NanumGothic-Regular.ttf", "NanumGothic", "Hang,Kore"],
  ] as const;
  const fontsDir = new URL("../wasm/fonts/", import.meta.url);
  const haveFonts = faces.every(([file]) => fs.existsSync(new URL(file, fontsDir)));
  let loaded: Promise<any> | undefined;
  const glue = () =>
    (loaded ??= (async () => {
      const g = await import(/* @vite-ignore */ new URL("pdfcraft_wasm.js", wasm).href);
      g.initSync({ module: fs.readFileSync(new URL("pdfcraft_wasm_bg.wasm", wasm)) });
      if (haveFonts) for (const [file, family, scripts] of faces) g.add_font(fs.readFileSync(new URL(file, fontsDir)), family, "Regular", scripts);
      return g;
    })());
  async function engine(): Promise<Engine> {
    const g = await glue();
    const mod: WasmModule = {
      open: (bytes, password) => new g.Pdf(bytes, password),
      stamps: () => g.Pdf.stamps(),
      createDigitalId: (...a: [string, string, string, string, number, number]) => g.Pdf.create_digital_id(...a),
    };
    return new Engine(mod);
  }
  async function opened(file: string, data?: Uint8Array): Promise<Engine> {
    const e = await engine();
    e.handle({ op: "open", bytes: data ?? bytesOf(file) });
    return e;
  }
  const render = (e: Engine, page: number): Rgba => e.handle({ op: "render", page, scale: 1 }).value as Rgba;
  /** The share of dark pixels in a box (points from the top-left, which is pixels at scale 1). */
  function ink(img: Rgba, box: Box = [0, 0, img.width, img.height]): number {
    const [x0, y0, x1, y1] = box.map(Math.round) as Box;
    let dark = 0;
    for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) {
        const i = (y * img.width + x) * 4;
        if (img.rgba[i]! < 200 || img.rgba[i + 1]! < 200 || img.rgba[i + 2]! < 200) dark++;
      }
    }
    return dark / (Math.max(1, x1 - x0) * Math.max(1, y1 - y0));
  }
  const blocks = (e: Engine, page: number) => e.handle({ op: "textBlocks", page }).value as TextBlock[];
  /** The text of a page with every run of whitespace as one space, since an edit may wrap in a narrow box. */
  const textOf = (e: Engine, page: number) => blocks(e, page).map((b) => b.text).join(" ").replace(/\s+/g, " ");
  const fieldsOf = (e: Engine, pages: number) =>
    Array.from({ length: pages }, (_, p) => e.handle({ op: "fields", page: p }).value as FieldInfo[]).flat();
  const save = (e: Engine) => e.handle({ op: "save" }).value as Uint8Array;

  describe.each(docs)("$file", (doc) => {
    it("opens and draws every page without a warning", async () => {
      const e = await opened(doc.file);
      expect(e.handle({ op: "info" }).value).toMatchObject({ pageCount: doc.pages, encrypted: false });
      for (let p = 0; p < doc.pages; p++) {
        const img = render(e, p) as Rgba & { warnings?: string[] };
        expect(img.rgba.length, `page ${p}`).toBe(img.width * img.height * 4);
        expect(img.warnings ?? [], `page ${p}`).toEqual([]);
      }
      const first = ink(render(e, 0));
      expect(first).toBeGreaterThan(doc.ink[0]);
      expect(first).toBeLessThan(doc.ink[1]);
    });

    it("reads its text and finds a phrase", async () => {
      const e = await opened(doc.file);
      expect(blocks(e, 0).length).toBeGreaterThanOrEqual(doc.blocks);
      const found = e.handle({ op: "find", query: doc.phrase }).value as { page: number }[];
      expect(found.length).toBeGreaterThan(0);
    });

    it("lists its form fields", async () => {
      const e = await opened(doc.file);
      expect(fieldsOf(e, doc.pages).length).toBe(doc.fields);
    });

    it("edits a line, saves and reopens with the edit and the rest intact", async () => {
      const e = await opened(doc.file);
      const before = fieldsOf(e, doc.pages).length;
      const target = blocks(e, 0).find((b) => !b.invisible && b.text.trim().length > 3);
      expect(target).toBeDefined();
      e.handle({ op: "editTextBlock", page: 0, block: target!.index, text: "Corpus edit" });
      const again = await opened(doc.file, save(e));
      expect(again.handle({ op: "info" }).value).toMatchObject({ pageCount: doc.pages });
      expect(textOf(again, 0)).toContain("Corpus edit");
      expect(fieldsOf(again, doc.pages).length).toBe(before);
      for (let p = 0; p < doc.pages; p++) expect(render(again, p).width).toBeGreaterThan(0);
    });

    it("saves untouched and reopens to the same pages", async () => {
      const e = await opened(doc.file);
      const again = await opened(doc.file, save(e));
      expect(again.handle({ op: "info" }).value).toMatchObject({ pageCount: doc.pages });
      const a = render(e, 0);
      const b = render(again, 0);
      expect(Math.abs(ink(a) - ink(b))).toBeLessThan(0.002);
    });
  });

  it("fills a text field of a form and keeps it through a save", async () => {
    for (const file of ["irs-fw9-2024.pdf", "irs-f1040-2025.pdf", "pdfium-xfa-email.pdf"]) {
      const e = await opened(file);
      const field = fieldsOf(e, 1).find((f) => f.kind === "text");
      expect(field, file).toBeDefined();
      e.handle({ op: "setField", name: field!.name, value: { text: "Corpus value" } });
      const again = await opened(file, save(e));
      const back = fieldsOf(again, 1).find((f) => f.name === field!.name);
      expect(back?.value, file).toBe("Corpus value");
    }
  });

  it("changes the pages of a long document and undoes it", async () => {
    const e = await opened("nist-csf-1-1.pdf");
    e.handle({ op: "deletePages", pages: [0, 1, 2] });
    expect(e.handle({ op: "info" }).value).toMatchObject({ pageCount: 52 });
    e.handle({ op: "rotatePages", pages: [0], degrees: 90 });
    expect(e.handle({ op: "pageSize", page: 0 }).value).toEqual([792, 612]);
    e.handle({ op: "movePages", pages: [0], to: 5 });
    e.handle({ op: "insertBlankPage", at: 0, width: 300, height: 400 });
    expect(e.handle({ op: "info" }).value).toMatchObject({ pageCount: 53 });
    for (let i = 0; i < 4; i++) e.handle({ op: "undo" });
    expect(e.handle({ op: "info" }).value).toMatchObject({ pageCount: 55 });
    const again = await opened("nist-csf-1-1.pdf", save(e));
    expect(again.handle({ op: "info" }).value).toMatchObject({ pageCount: 55 });
  });

  it.skipIf(!haveFonts)("draws added text in every script the engine has a face for", async () => {
    const e = await opened("nist-csf-1-1.pdf");
    const area: Box = [40, 300, 560, 500];
    const empty = ink(render(e, 2), area);
    const lines = ["Latin text", "Ελληνικά", "Кириллица", "日本語のテスト", "简体中文测试", "한국어 시험"];
    lines.forEach((text, i) => {
      e.handle({ op: "addText", page: 2, view: [50, 310 + i * 30, 550, 335 + i * 30], text, style: { size: 18 } });
      expect(ink(render(e, 2), area), text).toBeGreaterThan(empty);
    });
    const again = await opened("nist-csf-1-1.pdf", save(e));
    expect(ink(render(again, 2), area)).toBeGreaterThan(empty);
  });

  it.skipIf(!haveFonts)("writes Japanese into a Japanese page", async () => {
    const e = await opened("digital-agency-terms-ja.pdf");
    const target = blocks(e, 0).find((b) => /[぀-ヿ]/.test(b.text));
    expect(target).toBeDefined();
    e.handle({ op: "editTextBlock", page: 0, block: target!.index, text: "日本語の確認" });
    const again = await opened("digital-agency-terms-ja.pdf", save(e));
    expect(textOf(again, 0)).toContain("日本語の確認");
  });

  it.skipIf(!haveFonts)("stamps a header, a footer and a watermark on every page", async () => {
    const e = await opened("plos-one-0000308.pdf");
    const top: Box = [0, 0, 613, 60];
    const bottom: Box = [0, 730, 613, 791];
    const before = [ink(render(e, 1), top), ink(render(e, 1), bottom)];
    e.handle({ op: "addHeaderFooter", spec: { text: ["Header", "Corpus 日本語", "", "", "Page <<1>> of <<n>>", ""], size: 10 } });
    e.handle({ op: "addWatermark", spec: { text: "DRAFT", opacity: 0.3 } });
    const mid = ink(render(e, 1), [150, 250, 460, 550]);
    expect(ink(render(e, 1), top)).toBeGreaterThan(before[0]!);
    expect(ink(render(e, 1), bottom)).toBeGreaterThan(before[1]!);
    const again = await opened("plos-one-0000308.pdf", save(e));
    expect(again.handle({ op: "info" }).value).toMatchObject({ pageCount: 5 });
    expect(ink(render(again, 1), [150, 250, 460, 550])).toBeCloseTo(mid, 2);
  });

  it("adds a comment and a highlight to a typeset article and keeps them", async () => {
    const e = await opened("plos-one-0000308.pdf");
    const [block] = blocks(e, 0);
    e.handle({ op: "markup", page: 0, kind: "highlight", rects: [block!.view!] });
    e.handle({ op: "addAnnotation", page: 0, spec: { type: "note", at: [20, 20], contents: "Corpus note" } });
    const again = await opened("plos-one-0000308.pdf", save(e));
    const notes = again.handle({ op: "annotations", page: 0 }).value as { contents?: string }[];
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(notes.some((n) => n.contents === "Corpus note")).toBe(true);
  });
});
