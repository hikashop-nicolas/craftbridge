// Messages between the page and the worker that owns the wasm engine.

export type ErrorCode = "needs-password" | "wrong-password" | "invalid" | "failed";

export type Tile = [x: number, y: number, width: number, height: number];

export interface TextBlock {
  index: number;
  /** [x0, y0, x1, y1] in PDF user space. */
  rect: [number, number, number, number];
  /** The same box as displayed: points from the top-left of the page, y down, after rotation. */
  view: [number, number, number, number] | null;
  text: string;
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  /** RGB, each 0 to 1. */
  color: [number, number, number];
  rotation: number;
  /** An invisible text layer over a scanned image. */
  invisible: boolean;
}

export interface Rendered {
  width: number;
  height: number;
  /** Premultiplied RGBA8, row by row. */
  rgba: Uint8Array;
}

export interface DocumentInfo {
  pageCount: number;
  encrypted: boolean;
}

// One request type per engine call; `id` pairs a reply with its request.
export type Call =
  | { op: "open"; bytes: Uint8Array; password?: string; wasmUrl?: string }
  | { op: "info" }
  | { op: "pageSize"; page: number }
  | { op: "render"; page: number; scale: number; tile?: Tile }
  | { op: "textBlocks"; page: number }
  | { op: "editTextBlock"; page: number; block: number; text: string }
  | { op: "deletePages"; pages: number[] }
  | { op: "rotatePages"; pages: number[]; degrees: number }
  | { op: "movePages"; pages: number[]; to: number }
  | { op: "insertBlankPage"; at: number; width: number; height: number }
  | { op: "history" }
  | { op: "undo" }
  | { op: "redo" }
  | { op: "save"; full?: boolean }
  | { op: "close" };

export type Request = Call & { id: number };

export interface History {
  /** The label of the edit undo would take back, or null. */
  undo: string | null;
  redo: string | null;
}

export type Reply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; code: ErrorCode; message: string };
