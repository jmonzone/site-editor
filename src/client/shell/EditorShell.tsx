"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  duplicateTarget,
  insertBlock,
  insertItemAfter,
  isBlockTarget,
  isItemTarget,
  labelForTarget,
  moveTarget,
  owningTarget,
  parentTarget,
  removeTarget,
  replaceStrings,
  setTargetValue,
  targetKey,
  type Edit,
  type Target,
} from "../../content.js";
import { isCanvasMessage, type BlockAction, type CanvasMessage, type CanvasMode, type ShellState } from "../../protocol.js";
import { newBlock, normalizeContent, publicUploadsPath, type RawContent, type Seg, type SiteDef } from "../../schema.js";
import { DesktopIcon, ExternalIcon, HistoryIcon, PhoneIcon, RedoIcon, TabletIcon, UndoIcon } from "../icons.js";
import { CaptureMenu, type CaptureFormat } from "./CaptureMenu.js";
import { AddBlockDialog, ConflictDialog, HistoryDialog, RestoreDialog } from "./dialogs.js";
import type { FieldHandlers } from "./Fields.js";
import { Panel } from "./Panel.js";
import { editorReducer, initialState, referencedUploads, type Upload } from "./state.js";
import { prepareUpload } from "./uploads.js";

export interface EditorShellProps {
  site: SiteDef;
  initialContent: RawContent;
  initialSha: string | null;
  email: string;
  /** "local": publishing writes the working tree (under `next dev`). */
  storage: "github" | "local";
  apiPath: string;
  canvasPath: string;
  /** Offer "Copy for Figma", which needs a local headless browser (`next dev`). */
  canCapture?: boolean;
}

type Device = "desktop" | "tablet" | "mobile";
/**
 * Preview sizes. `captureWidth` is the width "Copy for Figma" renders at: fixed, so captures come out the same
 * size whatever the window. The desktop preview fills the space, but its captures use Figma's Desktop frame.
 */
const DEVICES: { value: Device; label: string; width: string; captureWidth: number; Icon: () => React.JSX.Element }[] = [
  { value: "desktop", label: "Desktop", width: "100%", captureWidth: 1440, Icon: DesktopIcon },
  { value: "tablet", label: "Tablet", width: "820px", captureWidth: 820, Icon: TabletIcon },
  { value: "mobile", label: "Phone", width: "390px", captureWidth: 390, Icon: PhoneIcon },
];

type Dialog =
  | { kind: "add"; after: string | null }
  | { kind: "history" }
  | { kind: "conflict"; sha: string | null; content: RawContent }
  | { kind: "restore"; savedAt: number; draft: RawContent; uploads: Record<string, Upload> };

interface Notice {
  tone: "info" | "success" | "error";
  text: string;
  action?: { label: string; run(): void };
  link?: { label: string; href: string };
}

interface SavedDraft {
  baseSha: string | null;
  draft: unknown;
  uploads: Record<string, Upload>;
  savedAt: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The editor page: the site in an iframe beside a panel, with undo, history and publishing. */
export function EditorShell({ site, initialContent, initialSha, email, storage, apiPath, canvasPath, canCapture = false }: EditorShellProps) {
  const pages = Object.keys(site.pages);
  const [state, dispatch] = useReducer(editorReducer, undefined, () => initialState(initialContent, initialSha, pages[0] ?? "home"));
  const [mode, setMode] = useState<CanvasMode>("edit");
  const [device, setDevice] = useState<Device>("desktop");
  const captureWidth = DEVICES.find((entry) => entry.value === device)!.captureWidth;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [publishing, setPublishing] = useState<"idle" | "publishing" | "deploying">("idle");
  const [focus, setFocus] = useState<Target | null>(null);
  const [canvasReady, setCanvasReady] = useState(0);
  const [capturing, setCapturing] = useState<CaptureFormat | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const stateRef = useRef(state);
  const mounted = useRef(true);
  const restored = useRef(false);
  const warnedStorage = useRef(false);
  const storageKey = `se-draft:${site.name}:${site.contentFile}`;
  const local = storage === "local";

  useLayoutEffect(() => {
    stateRef.current = state;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const dirty = useMemo(
    () => state.draft !== state.published && JSON.stringify(state.draft) !== JSON.stringify(state.published),
    [state.draft, state.published],
  );

  const notify = useCallback((next: Notice | null) => setNotice(next), []);
  useEffect(() => {
    // Errors stay until dismissed. An Undo offer expires too, before later edits make it undo something else.
    if (!notice || notice.tone === "error") return;
    const timer = setTimeout(() => setNotice((current) => (current === notice ? null : current)), notice.action ? 8000 : 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  // ---------------------------------------------------------------------------
  // Draft backup in the browser, so a closed tab or crash doesn't lose work
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    let saved: SavedDraft | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    } catch {
      saved = null;
    }
    if (!saved?.draft) return;
    const draft = normalizeContent(site, saved.draft);
    if (JSON.stringify(draft) === JSON.stringify(initialContent)) return;
    if (saved.baseSha === initialSha) {
      dispatch({ type: "restore", draft, uploads: saved.uploads ?? {} });
      notify({ tone: "info", text: "Brought back your unpublished changes.", action: { label: "Undo", run: () => dispatch({ type: "undo" }) } });
    } else {
      setDialog({ kind: "restore", savedAt: saved.savedAt, draft, uploads: saved.uploads ?? {} });
    }
  }, [initialContent, initialSha, notify, site, storageKey]);

  useEffect(() => {
    if (!restored.current || dialog?.kind === "restore") return;
    try {
      if (!dirty) localStorage.removeItem(storageKey);
      else {
        const saved: SavedDraft = { baseSha: state.baseSha, draft: state.draft, uploads: state.uploads, savedAt: Date.now() };
        localStorage.setItem(storageKey, JSON.stringify(saved));
      }
    } catch {
      if (warnedStorage.current) return;
      warnedStorage.current = true;
      notify({ tone: "error", text: "Your browser couldn't keep a backup of these changes. Publish soon so they aren't lost." });
    }
  }, [dirty, state.draft, state.uploads, state.baseSha, storageKey, dialog, notify]);

  // ---------------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------------

  const apply = useCallback((edit: Edit, reveal = true) => {
    dispatch({ type: "change", draft: edit.content, select: edit.select, reveal });
  }, []);

  const runAction = useCallback(
    (action: BlockAction, target: Target) => {
      const { draft, page } = stateRef.current;
      switch (action) {
        case "delete": {
          const label = labelForTarget(site, draft, page, target);
          apply(removeTarget(draft, page, target), false);
          notify({ tone: "info", text: `Deleted ${label}.`, action: { label: "Undo", run: () => dispatch({ type: "undo" }) } });
          return;
        }
        case "duplicate":
          return apply(duplicateTarget(draft, page, target));
        case "moveUp":
        case "moveDown":
          return apply(moveTarget(draft, page, target, action === "moveUp" ? -1 : 1));
        case "add":
          if (isBlockTarget(target)) setDialog({ kind: "add", after: target.root });
          else if (isItemTarget(target)) apply(insertItemAfter(site, draft, page, target));
      }
    },
    [apply, notify, site],
  );

  const handlers = useMemo<FieldHandlers>(() => {
    return {
      change(path: Seg[], value: unknown) {
        const { draft, page, selection } = stateRef.current;
        if (!selection) return;
        const target = { root: selection.root, path };
        dispatch({ type: "change", draft: setTargetValue(draft, page, target, value), coalesceKey: targetKey(target) });
      },
      select(path: Seg[]) {
        const selection = stateRef.current.selection;
        if (selection) dispatch({ type: "select", target: { root: selection.root, path }, reveal: true });
      },
      async upload(path: Seg[], file: File, kind: "image" | "file") {
        const selection = stateRef.current.selection;
        if (!selection) return null;
        try {
          const upload = await prepareUpload(file, kind, publicUploadsPath(site));
          // Read the draft after the await: it may have changed while the file was processed.
          const { draft, page } = stateRef.current;
          dispatch({ type: "change", draft: setTargetValue(draft, page, { root: selection.root, path }, upload.path), upload });
          return null;
        } catch (error) {
          const message = (error as Error).message;
          notify({ tone: "error", text: message });
          return message;
        }
      },
      previewUrl: (src: string) => stateRef.current.uploads[src]?.dataUrl ?? src,
    };
  }, [notify, site]);

  // ---------------------------------------------------------------------------
  // The canvas
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const win = frame.current?.contentWindow;
    if (!win || canvasReady === 0) return;
    const assets = Object.fromEntries(Object.values(state.uploads).map((upload) => [upload.path, upload.dataUrl]));
    const message: ShellState = {
      se: "shell",
      type: "state",
      content: Object.keys(assets).length ? replaceStrings(state.draft, assets) : state.draft,
      page: state.page,
      selection: state.selection,
      mode,
      reveal: state.reveal,
    };
    win.postMessage(message, window.location.origin);
  }, [state.draft, state.uploads, state.page, state.selection, state.reveal, mode, canvasReady]);

  const handleCanvas = useRef<(message: CanvasMessage) => void>(() => {});
  useLayoutEffect(() => {
    handleCanvas.current = (message) => {
      const { draft, page } = stateRef.current;
      switch (message.type) {
        case "ready":
          return setCanvasReady((count) => count + 1);
        case "select":
          return dispatch({ type: "select", target: message.target });
        case "set":
          return dispatch({ type: "change", draft: setTargetValue(draft, page, message.target, message.value) });
        case "action":
          return runAction(message.action, message.target);
        case "history":
          return dispatch({ type: message.direction });
        case "inspect":
          dispatch({ type: "select", target: owningTarget(message.target) });
          return setFocus({ ...message.target });
        case "navigate": {
          const next = pages.find((key) => site.pages[key]?.path === message.path);
          if (next) dispatch({ type: "page", page: next });
          else notify({ tone: "info", text: `${message.path} isn't a page you can edit here.` });
        }
      }
    };
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (isCanvasMessage(event.data)) handleCanvas.current(event.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && (key === "z" || key === "y")) {
        event.preventDefault();
        dispatch({ type: key === "y" || event.shiftKey ? "redo" : "undo" });
      } else if (event.key === "Escape" && stateRef.current.selection) {
        dispatch({ type: "select", target: parentTarget(stateRef.current.selection), reveal: true });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---------------------------------------------------------------------------
  // Publishing
  // ---------------------------------------------------------------------------

  const waitUntilLive = useCallback(
    async (commit: string) => {
      const deadline = Date.now() + 6 * 60 * 1000;
      for (let first = true; Date.now() < deadline && mounted.current; first = false) {
        try {
          const status = await (await fetch(`${apiPath}/status`, { cache: "no-store" })).json();
          if (!status.deployedSha) {
            setPublishing("idle");
            notify({ tone: "success", text: "Published. The live site updates once it rebuilds, usually within a couple of minutes." });
            return;
          }
          if (status.deployedSha === commit) {
            setPublishing("idle");
            notify({ tone: "success", text: "Your changes are live.", link: { label: "View site", href: site.pages[stateRef.current.page]?.path ?? "/" } });
            return;
          }
        } catch {
          // Keep waiting: the status check can fail while the site switches over.
        }
        if (first) notify({ tone: "info", text: "Published. Going live in about a minute…" });
        await sleep(5000);
      }
      if (!mounted.current) return;
      setPublishing("idle");
      notify({ tone: "info", text: "Published. The live site is taking longer than usual to update; check back in a few minutes." });
    },
    [apiPath, notify, site],
  );

  const publish = useCallback(
    async (baseOverride?: string | null) => {
      const { draft, uploads, baseSha } = stateRef.current;
      setPublishing("publishing");
      setNotice(null);
      try {
        const response = await fetch(`${apiPath}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: draft, baseSha: baseOverride === undefined ? baseSha : baseOverride, uploads: referencedUploads(draft, uploads) }),
        });
        const body = await response.json().catch(() => ({}));
        if (response.status === 409) {
          setPublishing("idle");
          setDialog({ kind: "conflict", sha: body.sha ?? null, content: normalizeContent(site, body.content ?? {}) });
          return;
        }
        if (response.status === 401) {
          setPublishing("idle");
          notify({ tone: "error", text: "Your session ended. Sign in again; your changes are kept.", action: { label: "Sign in", run: () => window.location.reload() } });
          return;
        }
        if (!response.ok) throw new Error(body.error ?? `Publishing failed (${response.status}).`);
        dispatch({ type: "published", sha: body.sha, content: normalizeContent(site, body.content), sent: draft });
        if (body.commit) {
          setPublishing("deploying");
          void waitUntilLive(body.commit);
        } else {
          setPublishing("idle");
          notify({ tone: "success", text: `Saved to ${site.contentFile}. Commit it to put it live.` });
        }
      } catch (error) {
        setPublishing("idle");
        notify({ tone: "error", text: (error as Error).message });
      }
    },
    [apiPath, notify, site, waitUntilLive],
  );

  async function openVersion(entry: { sha: string; date: string }) {
    const response = await fetch(`${apiPath}/version?sha=${entry.sha}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      notify({ tone: "error", text: body.error ?? "Couldn't open that version." });
      return;
    }
    dispatch({ type: "change", draft: normalizeContent(site, body.content), select: null });
    setDialog(null);
    notify({
      tone: "info",
      text: `Opened the version from ${new Date(entry.date).toLocaleString()}. Publish to put it live.`,
      action: { label: "Undo", run: () => dispatch({ type: "undo" }) },
    });
  }

  /**
   * Captures the draft at the previewed device's fixed width (1440, 820 or 390px) and copies it for pasting into
   * Figma: a PNG, or SVG as text,
   * which Figma turns into layers. The clipboard write starts right away, while the click still counts as the
   * user's, and waits on the capture; if the browser refuses it, the file downloads instead.
   */
  async function copyForFigma(format: CaptureFormat) {
    const { draft, uploads, page } = stateRef.current;
    const width = captureWidth;
    const assets = Object.fromEntries(Object.values(uploads).map((upload) => [upload.path, upload.dataUrl]));
    setCapturing(format);
    setNotice(null);

    const captured = fetch(`${apiPath}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: replaceStrings(draft, assets), page, width, format }),
    }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Capturing failed (${response.status}).`);
      return response.blob();
    });
    const clipboardBlob = format === "png" ? captured : captured.then(async (blob) => new Blob([await blob.text()], { type: "text/plain" }));

    try {
      await navigator.clipboard.write([new ClipboardItem({ [format === "png" ? "image/png" : "text/plain"]: clipboardBlob })]);
      notify({
        tone: "success",
        text: format === "png" ? `Copied the page (${width}px wide, at 2×). Paste it into Figma and scale it to 50%.` : `Copied the page as layers (${width}px wide). Paste it into Figma.`,
      });
    } catch {
      try {
        const blob = await captured;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${site.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${page}-${width}.${format}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
        notify({ tone: "info", text: "The browser wouldn't copy it, so it downloaded instead. Drag the file into Figma." });
      } catch (error) {
        notify({ tone: "error", text: (error as Error).message });
      }
    } finally {
      setCapturing(null);
    }
  }

  async function signOut() {
    await fetch(`${apiPath}/logout`, { method: "POST" }).catch(() => undefined);
    window.location.reload();
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  const status =
    publishing === "publishing"
      ? local
        ? "Saving…"
        : "Publishing…"
      : publishing === "deploying"
        ? "Going live…"
        : dirty
          ? local
            ? "Unsaved changes"
            : "Unpublished changes"
          : local
            ? "Saved"
            : "Up to date";

  return (
    <div className="se-shell">
      <header className="se-topbar">
        <div className="se-topbar-group">
          <span className="se-brand">{site.name}</span>
          {pages.length > 1 && (
            <select className="se-input se-page-select" aria-label="Page" value={state.page} onChange={(event) => dispatch({ type: "page", page: event.target.value })}>
              {pages.map((key) => (
                <option key={key} value={key}>
                  {site.pages[key]!.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="se-topbar-group">
          <div className="se-segmented" role="group" aria-label="Mode">
            {(["edit", "preview"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>
                {value === "edit" ? "Edit" : "Preview"}
              </button>
            ))}
          </div>
          <div className="se-segmented" role="group" aria-label="Screen size">
            {DEVICES.map(({ value, label, Icon }) => (
              <button key={value} type="button" aria-pressed={device === value} aria-label={label} title={label} onClick={() => setDevice(value)}>
                <Icon />
              </button>
            ))}
          </div>
          {canCapture && <CaptureMenu busy={capturing} width={captureWidth} onCopy={copyForFigma} />}
        </div>

        <div className="se-topbar-group">
          <button type="button" className="se-icon-button" aria-label="Undo" title="Undo (⌘Z)" disabled={state.past.length === 0} onClick={() => dispatch({ type: "undo" })}>
            <UndoIcon />
          </button>
          <button type="button" className="se-icon-button" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={state.future.length === 0} onClick={() => dispatch({ type: "redo" })}>
            <RedoIcon />
          </button>
          <button type="button" className="se-icon-button" aria-label="Published versions" title="Published versions" onClick={() => setDialog({ kind: "history" })}>
            <HistoryIcon />
          </button>
          <a className="se-icon-button" href={site.pages[state.page]?.path ?? "/"} target="_blank" rel="noreferrer" aria-label="View live site (opens in a new tab)" title="View live site">
            <ExternalIcon />
          </a>
          <span className="se-status" role="status" data-dirty={dirty || undefined}>
            {status}
          </span>
          {dirty && publishing === "idle" && (
            <button
              type="button"
              className="se-button se-button-quiet"
              onClick={() => {
                dispatch({ type: "change", draft: stateRef.current.published, select: null });
                notify({ tone: "info", text: "Discarded your changes.", action: { label: "Undo", run: () => dispatch({ type: "undo" }) } });
              }}
            >
              Discard
            </button>
          )}
          <button type="button" className="se-button se-button-primary" disabled={!dirty || publishing === "publishing"} onClick={() => publish()}>
            {local ? "Save" : "Publish"}
          </button>
          {email !== "local" && (
            <button type="button" className="se-button se-button-quiet" title={`Signed in as ${email}`} onClick={signOut}>
              Sign out
            </button>
          )}
        </div>
      </header>

      <div className="se-body">
        <div
          className="se-stage"
          onClick={(event) => {
            if (event.target === event.currentTarget) dispatch({ type: "select", target: null });
          }}
        >
          <iframe
            ref={frame}
            className="se-frame"
            src={canvasPath}
            title={`${site.name}, as it will look`}
            style={{ width: DEVICES.find((entry) => entry.value === device)!.width }}
          />
          {notice && (
            <div className="se-toast" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
              <span>{notice.text}</span>
              {notice.action && (
                <button
                  type="button"
                  className="se-button"
                  onClick={() => {
                    notice.action!.run();
                    setNotice(null);
                  }}
                >
                  {notice.action.label}
                </button>
              )}
              {notice.link && (
                <a className="se-button" href={notice.link.href} target="_blank" rel="noreferrer">
                  {notice.link.label}
                </a>
              )}
              <button type="button" className="se-icon-button" aria-label="Dismiss" onClick={() => setNotice(null)}>
                ×
              </button>
            </div>
          )}
        </div>

        <aside className="se-panel" aria-label="Editor">
          <Panel
            site={site}
            content={state.draft}
            page={state.page}
            selection={state.selection}
            focus={focus}
            handlers={handlers}
            onSelect={(target) => dispatch({ type: "select", target, reveal: true })}
            onAction={runAction}
            onAddBlock={(after) => setDialog({ kind: "add", after })}
          />
        </aside>
      </div>

      {dialog?.kind === "add" && (
        <AddBlockDialog
          site={site}
          onClose={() => setDialog(null)}
          onPick={(type) => {
            const { draft, page } = stateRef.current;
            apply(insertBlock(draft, page, newBlock(site, type), dialog.after));
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "history" && <HistoryDialog apiPath={apiPath} onOpen={openVersion} onClose={() => setDialog(null)} />}
      {dialog?.kind === "conflict" && (
        <ConflictDialog
          onClose={() => setDialog(null)}
          onLoadLatest={() => {
            dispatch({ type: "rebase", sha: dialog.sha, content: dialog.content, keepDraft: false });
            setDialog(null);
            notify({ tone: "info", text: "Loaded the latest version. Your changes are on the undo stack." });
          }}
          onOverwrite={() => {
            dispatch({ type: "rebase", sha: dialog.sha, content: dialog.content, keepDraft: true });
            setDialog(null);
            void publish(dialog.sha);
          }}
        />
      )}
      {dialog?.kind === "restore" && (
        <RestoreDialog
          savedAt={dialog.savedAt}
          onKeep={() => {
            dispatch({ type: "restore", draft: dialog.draft, uploads: dialog.uploads });
            setDialog(null);
          }}
          onDiscard={() => {
            localStorage.removeItem(storageKey);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
