// Runs the engine against the real DeckCraft wasm when `npm run build:deck-wasm` has produced wasm/deck/.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { Engine, type WasmModule } from "../src/deck/engine";

const dir = new URL("../wasm/deck/", import.meta.url);
const built = fs.existsSync(new URL("deckcraft_wasm_bg.wasm", dir));

describe.skipIf(!built)("the real deck engine", () => {
  async function engine(): Promise<Engine> {
    const glue = await import(/* @vite-ignore */ new URL("deckcraft_wasm.js", dir).href);
    glue.initSync({ module: fs.readFileSync(new URL("deckcraft_wasm_bg.wasm", dir)) });
    const wasm: WasmModule = { create: () => new glue.Deck() };
    return new Engine(wasm);
  }
  const run = (e: Engine, call: Parameters<Engine["handle"]>[0]) => e.handle(call).value as any;

  it("creates, edits, renders and saves a presentation", async () => {
    const e = await engine();
    run(e, { op: "execute", command: "file.new", params: {} });
    expect((await run(e, { op: "overlay" })).slides).toBeGreaterThanOrEqual(1);
    run(e, { op: "execute", command: "insert.textBox", params: { rect: [60, 200, 400, 60], text: "Édité Ω 안녕" } });
    const info = run(e, { op: "execute", command: "slide.inspect", params: {} });
    expect(JSON.stringify(info.shapes)).toContain("Édité");
    const r = run(e, { op: "render", index: 0, scale: 0.5 });
    expect(r.width).toBeGreaterThan(100);
    expect(r.rgba.length).toBe(r.width * r.height * 4);
    const bytes = run(e, { op: "save" }) as Uint8Array;
    expect(bytes.length).toBeGreaterThan(1000);
    // the saved file reopens with the edit in it
    const again = await engine();
    run(again, { op: "load", name: "x.pptx", bytes });
    expect(JSON.stringify(run(again, { op: "execute", command: "slide.inspect", params: {} }).shapes)).toContain("Édité");
  });

  it("selects with the pointer, edits text in place and undoes", async () => {
    const e = await engine();
    run(e, { op: "execute", command: "file.new", params: {} });
    run(e, { op: "execute", command: "insert.textBox", params: { rect: [60, 200, 400, 60], text: "Bonjour" } });
    run(e, { op: "execute", command: "edit.deselect", params: {} });
    expect(run(e, { op: "hit", x: 100, y: 220, tol: 3 })).toMatchObject({ kind: "shape", text: true });
    run(e, { op: "pointer", event: { kind: "down", x: 100, y: 220, tol: 3 } });
    run(e, { op: "pointer", event: { kind: "up", x: 100, y: 220, tol: 3 } });
    const sel = run(e, { op: "overlay" }).selection;
    expect(sel).toHaveLength(1);
    expect(sel[0].handles).toHaveLength(8);
    run(e, { op: "pointer", event: { kind: "doubleClick", x: 100, y: 220, tol: 3 } });
    expect(run(e, { op: "overlay" }).text.caret).not.toBeNull();
    run(e, { op: "execute", command: "text.insert", params: { text: "X" } });
    expect(run(e, { op: "overlay" }).dirty).toBe(true);
    run(e, { op: "execute", command: "edit.undo", params: {} });
    expect(run(e, { op: "overlay" }).canRedo).toBe(true);
  });

  it("answers every call a host makes: show, masters, exports", async () => {
    const e = await engine();
    run(e, { op: "execute", command: "file.new", params: {} });
    run(e, { op: "execute", command: "insert.textBox", params: { rect: [60, 100, 400, 60], text: "Bonjour" } });
    run(e, { op: "execute", command: "slide.new", params: { layout: "blank", at: 1 } });
    expect(run(e, { op: "transitionBegin", index: 1, scale: 0.3 })).toBe(true);
    expect(run(e, { op: "showInfo", index: 0 })).toMatchObject({ steps: expect.any(Number), auto: expect.any(Array) });
    for (const call of [
      { op: "renderStep", index: 0, step: 0, t: 0, scale: 0.3 },
      { op: "renderShow", index: 0, step: 0, t: 0, plays: [], scale: 0.3 },
      { op: "renderTransition", index: 1, t: 0.5, scale: 0.3 },
      { op: "transitionFrame", t: 0.5 },
      { op: "renderLayout", master: 0, layout: -1, scale: 0.3 },
    ] as const) {
      const r = run(e, call);
      expect(r.rgba.length).toBe(r.width * r.height * 4);
    }
    const pics = run(e, { op: "transitionTextures" });
    expect(pics).toHaveLength(6);
    expect(pics[1].rgba.length).toBe(pics[1].width * pics[1].height * 4);
    expect(run(e, { op: "transitionMesh", t: 0.5 }).length % 16).toBe(0);
    expect(run(e, { op: "masters" })[0].layouts.length).toBeGreaterThan(1);
    expect(String.fromCharCode(...(run(e, { op: "exportPdf", params: { format: "pdf" } }) as Uint8Array).slice(0, 4))).toBe("%PDF");
    expect((run(e, { op: "exportPng", index: 0, scale: 0.5 }) as Uint8Array)[1]).toBe(0x50);
  });

  it("reports a command that is not available as invalid", async () => {
    const e = await engine();
    expect(() => e.handle({ op: "execute", command: "text.insert", params: { text: "x" } })).toThrowError(/not available|no document/);
  });
});
