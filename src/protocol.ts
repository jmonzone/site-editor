import type { Target } from "./content.js";
import type { RawContent } from "./schema.js";

/** Messages between the editor shell (/edit) and the page canvas in its iframe (/edit/canvas). */

export type CanvasMode = "edit" | "preview";
export type BlockAction = "delete" | "duplicate" | "moveUp" | "moveDown" | "add";

export interface ShellState {
  se: "shell";
  type: "state";
  content: RawContent;
  page: string;
  selection: Target | null;
  mode: CanvasMode;
  /** Scroll the selection into view; set when it was chosen outside the canvas. */
  reveal: boolean;
}

export type CanvasMessage =
  | { se: "canvas"; type: "ready" }
  | { se: "canvas"; type: "select"; target: Target | null }
  | { se: "canvas"; type: "set"; target: Target; value: unknown }
  | { se: "canvas"; type: "action"; action: BlockAction; target: Target }
  | { se: "canvas"; type: "history"; direction: "undo" | "redo" }
  | { se: "canvas"; type: "inspect"; target: Target }
  | { se: "canvas"; type: "navigate"; path: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CanvasMessageBody = DistributiveOmit<CanvasMessage, "se">;

const hasSource = (data: unknown, source: string) =>
  typeof data === "object" && data !== null && (data as { se?: unknown }).se === source;

export const isShellState = (data: unknown): data is ShellState =>
  hasSource(data, "shell") && (data as { type?: unknown }).type === "state";

export const isCanvasMessage = (data: unknown): data is CanvasMessage => hasSource(data, "canvas");

/**
 * What the canvas exposes at `/edit/canvas?capture`, for the headless browser that captures pages for Figma:
 * render a draft exactly as the live site would, then hand back the page as SVG.
 */
export interface CaptureApi {
  render(content: RawContent, page: string): Promise<void>;
  svg(): Promise<string>;
}

declare global {
  interface Window {
    __siteEditorCapture?: CaptureApi;
  }
}
