// What the host page and the worker that owns DeckCraft's wasm engine say to each other.

export type ErrorCode = "invalid" | "failed";

/** What the engine answers when a file is opened. */
export interface LoadInfo {
  document: number;
  missingFonts: string[];
  damagedMedia: unknown[];
  lostSlides: unknown[];
}

/** One command the engine offers (a menu item, a shortcut, a script call). */
export interface CommandInfo {
  id: string;
  label: string;
  shortcut?: string | null;
  params?: string;
}

/** What a point on the slide is. */
export type Hit =
  | { kind: "resize"; id: number; handle: number }
  | { kind: "rotate"; id: number }
  | { kind: "adjust"; id: number; index: number }
  | { kind: "lineEnd"; id: number; end: number }
  | { kind: "shape"; id: number; text?: boolean }
  | { kind: "frame"; id: number }
  | { kind: string; id?: number; [key: string]: unknown };

/** A selected shape, in slide points. */
export interface SelectedShape {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  locked: boolean;
  line: boolean;
  /** The eight resize handles, NW N NE E SE S SW W. */
  handles: [number, number][];
  rotate: [number, number];
  /** The corners of the (rotated) box, clockwise from the top left. */
  corners: [number, number][];
}

/** The text being edited: its caret and selected text, in slide points. */
export interface TextOverlay {
  shape: number;
  caret: [[number, number], [number, number]] | null;
  /** Each selected piece of text as four corners. */
  rects: [number, number][][];
  anchor: [number, number];
  end: [number, number];
}

/** Everything the host draws over the slide. */
export interface Overlay {
  open: boolean;
  title?: string;
  dirty?: boolean;
  revision?: number;
  slide?: number;
  slides?: number;
  width?: number;
  height?: number;
  selection?: SelectedShape[];
  text?: TextOverlay | null;
  canUndo?: boolean;
  canRedo?: boolean;
  missingFonts?: string[];
}

/** The pointer tool: select, draw a preset shape, draw a text box, or ink. */
export type Tool =
  | { kind: "select" }
  | { kind: "shape"; preset: string }
  | { kind: "textBox" }
  | { kind: "ink"; mode: "pen" | "highlighter" | "eraser"; color?: unknown; width?: number };

/** A pointer event in slide points; `tol` is the hit tolerance in points. */
export interface PointerEvent {
  kind: "down" | "drag" | "up" | "move" | "doubleClick" | "tripleClick" | "contextClick";
  x: number;
  y: number;
  tol?: number;
  mods?: { shift?: boolean; alt?: boolean; cmd?: boolean };
  pressure?: number | null;
}

/** A rendered slide: straight RGBA, `width * height * 4` bytes. */
export interface Rendered {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export type Call =
  | { op: "open"; wasmUrl?: string }
  | { op: "load"; name: string; bytes: Uint8Array }
  | { op: "commands" }
  | { op: "execute"; command: string; params?: unknown }
  | { op: "setTool"; tool: Tool }
  | { op: "pointer"; event: PointerEvent }
  | { op: "hit"; x: number; y: number; tol: number }
  | { op: "overlay" }
  | { op: "render"; index: number; scale: number; edit?: boolean }
  | { op: "save" }
  | { op: "addFont"; bytes: Uint8Array };

export type Request = Call & { id: number };

export type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; code: ErrorCode; message: string };
