"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SiteDef } from "../../schema.js";
import { CloseIcon } from "../icons.js";

/** A native modal dialog: it traps focus, closes on Escape and restores focus on close. */
export function Modal({ title, onClose, children, actions }: { title: string; onClose(): void; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const onCancel = (event: Event) => {
      event.preventDefault();
      close.current();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.close();
    };
  }, []);

  return (
    <dialog ref={ref} className="se-dialog" aria-labelledby="se-dialog-title">
      <div className="se-dialog-head">
        <h2 id="se-dialog-title" className="se-panel-title">
          {title}
        </h2>
        <button type="button" className="se-icon-button" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="se-dialog-body">{children}</div>
      {actions && <div className="se-dialog-actions">{actions}</div>}
    </dialog>
  );
}

export function AddBlockDialog({ site, onPick, onClose }: { site: SiteDef; onPick(type: string): void; onClose(): void }) {
  return (
    <Modal title="Add a section" onClose={onClose}>
      <ul className="se-choices">
        {Object.entries(site.blocks).map(([type, def]) => (
          <li key={type}>
            <button type="button" className="se-choice" onClick={() => onPick(type)}>
              <span className="se-outline-label">{def.label}</span>
              {def.description && <span className="se-outline-detail">{def.description}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

interface HistoryEntry {
  sha: string;
  message: string;
  date: string;
  author: string;
}

const formatDate = (date: string | number) =>
  new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function HistoryDialog({ apiPath, onOpen, onClose }: { apiPath: string; onOpen(entry: HistoryEntry): Promise<void>; onClose(): void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiPath}/history`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Couldn't load the history.");
        if (!cancelled) setEntries(body.entries);
      })
      .catch((reason: Error) => !cancelled && setError(reason.message));
    return () => {
      cancelled = true;
    };
  }, [apiPath]);

  return (
    <Modal title="Published versions" onClose={onClose}>
      <p className="se-help">Open an earlier version to look it over. It only goes live if you publish it.</p>
      {error && (
        <p className="se-error" role="alert">
          {error}
        </p>
      )}
      {!entries && !error && <p className="se-help">Loading…</p>}
      {entries?.length === 0 && <p className="se-help">No versions yet.</p>}
      <ol className="se-history">
        {entries?.map((entry, index) => (
          <li key={entry.sha} className="se-history-row">
            <span>
              <span className="se-outline-label">
                {formatDate(entry.date)}
                {index === 0 && <span className="se-badge">Current</span>}
              </span>
              <span className="se-outline-detail">
                {entry.message} · {entry.author}
              </span>
            </span>
            <button
              type="button"
              className="se-button"
              disabled={opening !== null}
              onClick={async () => {
                setOpening(entry.sha);
                await onOpen(entry);
                setOpening(null);
              }}
            >
              {opening === entry.sha ? "Opening…" : "Open"}
            </button>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

export function ConflictDialog({ onLoadLatest, onOverwrite, onClose }: { onLoadLatest(): void; onOverwrite(): void; onClose(): void }) {
  return (
    <Modal
      title="The site changed while you were editing"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="se-button se-danger" onClick={onOverwrite}>
            Publish mine anyway
          </button>
          <button type="button" className="se-button se-button-primary" onClick={onLoadLatest}>
            Load the latest version
          </button>
        </>
      }
    >
      <p>Someone published changes to this site after you opened the editor, so publishing now would undo theirs.</p>
      <p>
        <strong>Load the latest version</strong> to start from their changes. Yours stay on the undo stack (⌘Z /
        Ctrl+Z) so you can look at them again. <strong>Publish mine anyway</strong> replaces their changes with yours.
      </p>
    </Modal>
  );
}

export function RestoreDialog({ savedAt, onKeep, onDiscard }: { savedAt: number; onKeep(): void; onDiscard(): void }) {
  return (
    <Modal
      title="Unpublished changes found"
      onClose={onKeep}
      actions={
        <>
          <button type="button" className="se-button se-danger" onClick={onDiscard}>
            Discard them
          </button>
          <button type="button" className="se-button se-button-primary" onClick={onKeep}>
            Keep my changes
          </button>
        </>
      }
    >
      <p>You have changes from {formatDate(savedAt)} that weren&rsquo;t published, but the site has been updated since.</p>
      <p>If you keep them and publish, they&rsquo;ll replace those updates.</p>
    </Modal>
  );
}
