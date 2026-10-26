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

/** Where an object comes from: text or an image the page already had, or something added. */
export type ObjectKind = "text" | "image" | "added";

export type Box = [x0: number, y0: number, x1: number, y1: number];

/** What a page shows that can be moved, resized, restyled or deleted. */
export interface PageObject {
  kind: ObjectKind;
  index: number;
  type: "text" | "image" | "form";
  text: string | null;
  /** Where it is drawn: points from the page's top-left, y down. */
  view: Box;
  /** How a text object looks (null for a picture). `align` is null for text the page already had. */
  style: (Required<Omit<TextStyle, "align">> & { align: TextStyle["align"] | null }) | null;
}

export interface TextStyle {
  family?: "helvetica" | "times" | "courier";
  bold?: boolean;
  italic?: boolean;
  /** Points, 1 to 400. */
  size?: number;
  /** RGB, each 0 to 1. */
  color?: [number, number, number];
  align?: "left" | "center" | "right" | "justify";
}

export interface ObjectRef {
  kind: ObjectKind;
  index: number;
}

/** One place a search found its text: the page, the matched words and a box per line they span. */
export interface FindMatch {
  page: number;
  text: string;
  rects: Box[];
}

export interface TextSelection {
  text: string;
  rects: Box[];
}

export type MarkupKind = "highlight" | "underline" | "strikeout";

export interface LinkInfo {
  index: number;
  view: Box;
  /** A web or mail address. */
  uri?: string;
  /** A page of the document, 0-based. */
  page?: number;
}

export interface AnnotationInfo {
  index: number;
  subtype: string;
  contents: string | null;
  view: Box;
}

export type FieldKind = "text" | "check" | "radio" | "button" | "choice" | "signature";

export interface FieldInfo {
  name: string;
  kind: FieldKind;
  value: string | null;
  view: Box;
}

export type FieldValue = { text: string } | { check: boolean } | { choice: string[] };

export interface Rendered {
  width: number;
  height: number;
  /** Premultiplied RGBA8, row by row. */
  rgba: Uint8Array;
  /** Why the picture is partial or approximate: "content-truncated", "colour-fallback". */
  warnings: string[];
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
  | { op: "objects"; page: number }
  | { op: "moveObjects"; page: number; targets: ObjectRef[]; dx: number; dy: number }
  | { op: "resizeObject"; page: number; target: ObjectRef; view: Box }
  | { op: "rotateObject"; page: number; target: ObjectRef; quarterTurns: number }
  | { op: "addText"; page: number; view: Box; text: string; style?: TextStyle }
  | { op: "addImage"; page: number; name: string; bytes: Uint8Array; view?: Box }
  | { op: "deleteObject"; page: number; target: ObjectRef }
  | { op: "setText"; page: number; target: ObjectRef; text?: string; style?: TextStyle }
  | { op: "cover"; page: number; view: Box }
  | { op: "find"; query: string; caseSensitive?: boolean; wholeWords?: boolean; limit?: number }
  | { op: "selectText"; page: number; from: [number, number]; to: [number, number] }
  | { op: "markup"; page: number; kind: MarkupKind; rects: Box[]; color?: [number, number, number] }
  | { op: "addLink"; page: number; view: Box; target: string }
  | { op: "links"; page: number }
  | { op: "deleteLink"; page: number; index: number }
  | { op: "annotations"; page: number }
  | { op: "deleteAnnotation"; page: number; index: number }
  | { op: "fields"; page: number }
  | { op: "setField"; name: string; value: FieldValue }
  | { op: "history" }
  | { op: "undo" }
  | { op: "redo" }
  | { op: "save"; full?: boolean }
  | { op: "close" };

export type Request = Call & { id: number };

/** The calls that change the document: the ones a session records and replays, in order. */
export type EditCall = Extract<
  Call,
  | { op: "editTextBlock" }
  | { op: "deletePages" }
  | { op: "rotatePages" }
  | { op: "movePages" }
  | { op: "insertBlankPage" }
  | { op: "moveObjects" }
  | { op: "resizeObject" }
  | { op: "rotateObject" }
  | { op: "addText" }
  | { op: "addImage" }
  | { op: "deleteObject" }
  | { op: "setText" }
  | { op: "cover" }
  | { op: "markup" }
  | { op: "addLink" }
  | { op: "deleteLink" }
  | { op: "deleteAnnotation" }
  | { op: "setField" }
  | { op: "undo" }
  | { op: "redo" }
>;

export interface History {
  /** The label of the edit undo would take back, or null. */
  undo: string | null;
  redo: string | null;
}

export type Reply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; code: ErrorCode; message: string };
