import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { listPdfMedia, pdfMediaBytes } from "../src/pdf/media";

// A LibreOffice Impress slide with an embedded one-second WAV, exported to PDF: a Screen
// annotation whose Rendition action plays a media clip held as an embedded file.
const lo = new Uint8Array(readFileSync(new URL("./media/libreoffice-sound.pdf", import.meta.url)));

// A minimal PDF built here: one page, a Sound annotation, and a FileAttachment holding an MP3
// inside a compressed object stream, to cover the other paths.
function built(): Uint8Array {
  const objs: string[] = [];
  const sound = Buffer.from([0x00, 0x10, 0xff, 0xf0]); // two 16-bit big-endian samples
  const mp3 = deflateSync(Buffer.from("ID3fake-mp3"));
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objs[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Rotate 90 /Annots [4 0 R 8 0 R] >>";
  objs[4] = "<< /Type /Annot /Subtype /Sound /Rect [10 10 30 30] /Sound 5 0 R >>";
  const parts: (string | Buffer)[] = ["%PDF-1.7\n"];
  const add = (n: number, body: string | Buffer[]) => parts.push(`${n} 0 obj\n`, ...(Array.isArray(body) ? body : [body]), "\nendobj\n");
  for (const n of [1, 2, 3, 4]) add(n, objs[n]!);
  add(5, [Buffer.from(`<< /Type /Sound /R 8000 /C 1 /B 16 /E /Signed /Length ${sound.length} >>\nstream\n`), sound, Buffer.from("\nendstream")]);
  add(6, [Buffer.from(`<< /Type /EmbeddedFile /Filter /FlateDecode /Length ${mp3.length} >>\nstream\n`), mp3, Buffer.from("\nendstream")]);
  // Object 8 (the attachment) and 7 (its file spec) live in an object stream.
  const inner = "<< /Type /Filespec /UF (talk.mp3) /EF << /F 6 0 R >> >> << /Type /Annot /Subtype /FileAttachment /Rect [100 50 120 70] /FS 7 0 R >>";
  const header = `7 0 8 ${inner.indexOf("<< /Type /Annot")} `;
  const objstm = deflateSync(Buffer.from(header + inner));
  add(9, [Buffer.from(`<< /Type /ObjStm /N 2 /First ${header.length} /Filter /FlateDecode /Length ${objstm.length} >>\nstream\n`), objstm, Buffer.from("\nendstream")]);
  parts.push("trailer\n<< /Root 1 0 R >>\n%%EOF\n");
  return new Uint8Array(Buffer.concat(parts.map(p => (typeof p === "string" ? Buffer.from(p, "latin1") : p))));
}

describe("PDF media", () => {
  it("finds LibreOffice's embedded sound and gives back the WAV", async () => {
    const list = await listPdfMedia(lo);
    expect(list).toHaveLength(1);
    const m = list[0]!;
    expect(m).toMatchObject({ page: 0, index: 0, subtype: "Screen", kind: "audio", mime: "audio/wav" });
    // Rect [113.386 162.991 226.772 276.377] on a 446.457 pt tall page, y down.
    expect(m.view[0]).toBeCloseTo(113.386, 2);
    expect(m.view[1]).toBeCloseTo(446.457 - 276.377, 2);
    const media = await pdfMediaBytes(lo, 0, 0);
    expect(media!.bytes.length).toBe(44144);
    expect(new TextDecoder().decode(media!.bytes.subarray(0, 4))).toBe("RIFF");
    expect(media!.name).toBe("media.wav");
  });

  it("reads Sound annotations and attachments in object streams, on a rotated page", async () => {
    const pdf = built();
    const list = await listPdfMedia(pdf);
    expect(list.map(m => [m.subtype, m.kind, m.mime, m.name])).toEqual([
      ["Sound", "audio", "audio/wav", "sound.wav"],
      ["FileAttachment", "audio", "audio/mpeg", "talk.mp3"],
    ]);
    // /Rotate 90 on a 200 x 100 page: displayed 100 wide, 200 tall.
    expect(list[0]!.view.map(Math.round)).toEqual([10, 10, 30, 30]);
    expect(list[1]!.view.map(Math.round)).toEqual([50, 100, 70, 120]);
    const wav = (await pdfMediaBytes(pdf, 0, 0))!;
    expect([...wav.bytes.subarray(44)]).toEqual([0x10, 0x00, 0xf0, 0xff]);
    const mp3 = (await pdfMediaBytes(pdf, 0, 1))!;
    expect(new TextDecoder().decode(mp3.bytes)).toBe("ID3fake-mp3");
  });

  it("finds nothing in a PDF without media, quickly", async () => {
    const plain = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer << /Root 1 0 R >>\n");
    expect(await listPdfMedia(plain)).toEqual([]);
  });
});
