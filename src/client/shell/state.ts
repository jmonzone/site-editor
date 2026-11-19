import { isSiteTarget, targetExists, type Target } from "../../content.js";
import type { RawContent } from "../../schema.js";

/** An image or file picked in the editor, kept in the draft until Publish commits it. */
export interface Upload {
  /** Public path the content refers to, e.g. "/uploads/portrait-k2j9.webp". */
  path: string;
  dataUrl: string;
}

interface Snapshot {
  draft: RawContent;
  uploads: Record<string, Upload>;
  selection: Target | null;
}

export interface EditorState {
  /** Blob SHA of the content file the draft started from; null when the file doesn't exist yet. */
  baseSha: string | null;
  published: RawContent;
  draft: RawContent;
  uploads: Record<string, Upload>;
  page: string;
  selection: Target | null;
  /** The selection was made outside the canvas, so the canvas should scroll to it. */
  reveal: boolean;
  past: Snapshot[];
  future: Snapshot[];
  /** Typing in one field within a moment is one undo step. */
  lastChange: { key: string; at: number } | null;
}

export type EditorAction =
  | { type: "change"; draft: RawContent; select?: Target | null; upload?: Upload; coalesceKey?: string; reveal?: boolean }
  | { type: "select"; target: Target | null; reveal?: boolean }
  | { type: "page"; page: string }
  | { type: "undo" }
  | { type: "redo" }
  /** Publish succeeded. `sent` is the draft that was published; edits made meanwhile are kept. */
  | { type: "published"; sha: string; content: RawContent; sent: RawContent }
  /** Bring back a draft saved in the browser, as one undoable step. */
  | { type: "restore"; draft: RawContent; uploads: Record<string, Upload> }
  /** Start over from another version of the file, keeping the current draft on the undo stack. */
  | { type: "rebase"; sha: string | null; content: RawContent; keepDraft: boolean };

const HISTORY_LIMIT = 100;
const COALESCE_MS = 1500;

export function initialState(content: RawContent, sha: string | null, page: string): EditorState {
  return {
    baseSha: sha,
    published: content,
    draft: content,
    uploads: {},
    page,
    selection: null,
    reveal: false,
    past: [],
    future: [],
    lastChange: null,
  };
}

const snapshot = (state: EditorState): Snapshot => ({ draft: state.draft, uploads: state.uploads, selection: state.selection });

const validSelection = (content: RawContent, page: string, target: Target | null | undefined) =>
  target && (isSiteTarget(target) && target.path.length === 0 ? true : targetExists(content, page, target)) ? target : null;

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "change": {
      if (action.draft === state.draft && !action.upload) return state;
      const now = Date.now();
      const coalesce =
        !!action.coalesceKey && state.lastChange?.key === action.coalesceKey && now - state.lastChange.at < COALESCE_MS;
      const uploads = action.upload ? { ...state.uploads, [action.upload.path]: action.upload } : state.uploads;
      return {
        ...state,
        draft: action.draft,
        uploads,
        selection: validSelection(action.draft, state.page, action.select === undefined ? state.selection : action.select),
        reveal: action.reveal ?? false,
        past: coalesce ? state.past : [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        lastChange: action.coalesceKey ? { key: action.coalesceKey, at: now } : null,
      };
    }
    case "select":
      return { ...state, selection: validSelection(state.draft, state.page, action.target), reveal: !!action.reveal, lastChange: null };
    case "page":
      return { ...state, page: action.page, selection: null, reveal: false };
    case "undo":
    case "redo": {
      const from = action.type === "undo" ? state.past : state.future;
      const to = from[from.length - 1];
      if (!to) return state;
      const rest = from.slice(0, -1);
      const saved = [...(action.type === "undo" ? state.future : state.past), snapshot(state)];
      return {
        ...state,
        draft: to.draft,
        uploads: to.uploads,
        selection: validSelection(to.draft, state.page, to.selection),
        reveal: true,
        past: action.type === "undo" ? rest : saved,
        future: action.type === "undo" ? saved : rest,
        lastChange: null,
      };
    }
    case "published": {
      const untouched = state.draft === action.sent;
      return {
        ...state,
        baseSha: action.sha,
        published: action.content,
        draft: untouched ? action.content : state.draft,
        uploads: untouched ? {} : state.uploads,
        selection: validSelection(untouched ? action.content : state.draft, state.page, state.selection),
      };
    }
    case "restore":
      return {
        ...state,
        draft: action.draft,
        uploads: action.uploads,
        selection: null,
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        lastChange: null,
      };
    case "rebase": {
      if (action.keepDraft) return { ...state, baseSha: action.sha, published: action.content };
      return {
        ...state,
        baseSha: action.sha,
        published: action.content,
        draft: action.content,
        uploads: {},
        selection: validSelection(action.content, state.page, state.selection),
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: [],
        lastChange: null,
      };
    }
  }
}

/** Uploads still referenced by the draft, as publish sends them. */
export function referencedUploads(draft: RawContent, uploads: Record<string, Upload>) {
  const text = JSON.stringify(draft);
  return Object.values(uploads)
    .filter((upload) => text.includes(JSON.stringify(upload.path)))
    .map((upload) => ({ path: upload.path, data: upload.dataUrl.slice(upload.dataUrl.indexOf(",") + 1) }));
}
