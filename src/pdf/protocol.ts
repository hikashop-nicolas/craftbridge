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
  /** Which of the field's widgets this is (a radio group has one per button). */
  widget: number;
  /** A check box or radio button: whether this one is chosen, and what choosing it sets. */
  on?: boolean;
  export?: string | null;
  /** A choice: a drop-down (true) or a list box, and its choices as [value, label]. */
  combo?: boolean;
  options?: [string, string][];
}

export type FieldValue = { text: string } | { check: boolean } | { radio: string | null } | { choice: string[] };

type Rgb = [number, number, number];
type Point = [number, number];

/** A comment to add. Boxes and points are displayed points from the page's top-left; colours are RGB from 0 to 1. */
export type CommentSpec = (
  | { type: "note"; at: Point }
  | { type: "rect"; box: Box }
  | { type: "oval"; box: Box }
  | { type: "line"; from: Point; to: Point }
  | { type: "arrow"; from: Point; to: Point }
  | { type: "ink"; strokes: Point[][] }
  | { type: "textbox"; box: Box; fontSize?: number }
  | { type: "typewriter"; box: Box; fontSize?: number }
  | { type: "mark"; box: Box; mark?: "check" | "cross" | "dot" | "line" }
  | { type: "signature"; strokes: Point[][] }
  | { type: "typedSignature"; at: Point; text: string; height?: number }
  | { type: "stamp"; box: Box; stamp: string; by?: string }
) & { contents?: string; author?: string; color?: Rgb; fill?: Rgb; width?: number; opacity?: number };

export interface StampInfo {
  name: string;
  label: string;
  group: "dynamic" | "signHere" | "business";
  size: [number, number];
  color: Rgb;
}

export type FieldType = "text" | "multiline" | "date" | "check" | "radio" | "combo" | "list" | "button";

export interface FieldSpec {
  type: FieldType;
  name?: string;
  options?: string[];
  editable?: boolean;
  multi?: boolean;
  group?: string;
  export?: string;
  caption?: string;
}

export interface FieldChange {
  name?: string;
  tooltip?: string;
  required?: boolean;
  readOnly?: boolean;
  options?: string[];
  fontSize?: number;
  /** Which widget `box` moves (default the first). */
  widget?: number;
  /** Moves and resizes the field: displayed points from the page's top-left. */
  box?: Box;
}

export interface ProtectSpec {
  open?: string;
  owner?: string;
  printing?: "none" | "low" | "high";
  changes?: "none" | "pages" | "fill" | "comment" | "any";
  copy?: boolean;
  accessibility?: boolean;
}

export type ActionTrigger = "mouse_up" | "mouse_down" | "mouse_enter" | "mouse_exit" | "on_focus" | "on_blur";

/** What a field does for a trigger. `page` of goto is 0-based; `other` is an action kept as it is (it cannot be run). */
export type FieldAction =
  | { kind: "javascript"; script: string }
  | { kind: "uri"; url: string }
  | { kind: "reset"; fields: string[] }
  | { kind: "named"; name: string }
  | { kind: "goto"; page: number }
  | { kind: "showhide"; fields: string[]; hide: boolean }
  | { kind: "submit"; url: string }
  | { kind: "other"; text: string };

export type FieldActionInfo = FieldAction & { trigger: ActionTrigger };

/** What a script asks the page to do. */
export type JsRequest =
  | { type: "print" }
  | { type: "goto"; page: number }
  | { type: "url"; url: string }
  | { type: "submit"; url: string }
  | { type: "named"; name: string }
  | { type: "reset"; fields: string[] }
  | { type: "focus"; field: string }
  | { type: "beep" }
  | { type: "saveAs" }
  | { type: "panel"; panel: string };

/** What scripts printed or asked for: alerts to show, console lines, requests for the page, and their errors. */
export interface JsOutput {
  alerts: string[];
  console: string[];
  requests: JsRequest[];
  errors: string[];
  /** The script's last value (what a console prints), after running one. */
  result?: string | null;
}

export interface LayerInfo {
  index: number;
  name: string;
  visible: boolean;
}

export interface SignatureInfo {
  field: string;
  signed: boolean;
  signer: string | null;
  date: string | null;
  reason: string | null;
  page: number | null;
  summary: string;
  status: string;
}

/** How to sign with a certificate; `box` (displayed points) makes the signature visible. */
export interface SignSpec {
  page?: number;
  box?: Box;
  field?: string;
  name?: string;
  reason?: string;
  location?: string;
  contact?: string;
  certify?: 1 | 2 | 3;
}

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
  | { op: "insertPagesFrom"; name: string; bytes: Uint8Array; at: number }
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
  | { op: "addAnnotation"; page: number; spec: CommentSpec }
  | { op: "setAnnotationContents"; page: number; index: number; text: string }
  | { op: "stamps" }
  | { op: "addField"; page: number; view: Box; spec: FieldSpec }
  | { op: "deleteField"; name: string }
  | { op: "deleteFieldWidget"; name: string; widget: number }
  | { op: "setFieldProps"; name: string; change: FieldChange }
  | { op: "fieldActions"; name: string }
  | { op: "setFieldActions"; name: string; actions: FieldActionInfo[] }
  | { op: "runAction"; action: FieldAction; target?: string }
  | { op: "takeJsOutput" }
  | { op: "protect"; spec: ProtectSpec }
  | { op: "removeProtection" }
  | { op: "layers" }
  | { op: "setLayerVisible"; index: number; visible: boolean }
  | { op: "addPictureStamp"; page: number; view: Box; name: string; bytes: Uint8Array }
  | { op: "flattenFillSign" }
  | { op: "signatures" }
  | { op: "signWithCertificate"; p12: Uint8Array; password: string; spec: SignSpec }
  | { op: "createDigitalId"; name: string; organisation: string; email: string; password: string; years: number; now: number }
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
  | { op: "insertPagesFrom" }
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
  | { op: "addAnnotation" }
  | { op: "setAnnotationContents" }
  | { op: "addField" }
  | { op: "deleteField" }
  | { op: "deleteFieldWidget" }
  | { op: "setFieldProps" }
  | { op: "setFieldActions" }
  | { op: "runAction" }
  | { op: "protect" }
  | { op: "removeProtection" }
  | { op: "addPictureStamp" }
  | { op: "flattenFillSign" }
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
