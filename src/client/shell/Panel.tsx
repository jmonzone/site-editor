"use client";

import { Fragment, useEffect, useRef } from "react";
import {
  blockSummary,
  canMoveTarget,
  fieldForTarget,
  formatPath,
  getTargetValue,
  isBlockTarget,
  isItemTarget,
  labelForTarget,
  pageBlocks,
  SITE_ROOT,
  targetChain,
  targetKey,
  type Target,
} from "../../content.js";
import type { BlockAction } from "../../protocol.js";
import type { ListField, RawContent, SiteDef } from "../../schema.js";
import { BackIcon, CopyIcon, DownIcon, PlusIcon, SettingsIcon, TrashIcon, UpIcon } from "../icons.js";
import { controlIn, FieldControl, type FieldHandlers } from "./Fields.js";

interface PanelProps {
  site: SiteDef;
  content: RawContent;
  page: string;
  selection: Target | null;
  /** A field to focus in the inspector, chosen on the page. */
  focus: Target | null;
  handlers: FieldHandlers;
  onSelect(target: Target | null): void;
  onAction(action: BlockAction, target: Target): void;
  onAddBlock(after: string | null): void;
}


export function Panel(props: PanelProps) {
  return props.selection ? <Inspector {...props} selection={props.selection} /> : <PageOutline {...props} />;
}

function PageOutline({ site, content, page, onSelect, onAction, onAddBlock }: PanelProps) {
  const blocks = pageBlocks(content, page);
  return (
    <div className="se-panel-scroll">
      <section className="se-panel-section">
        <h2 className="se-panel-title">{site.pages[page]?.label ?? "Page"}</h2>
        <p className="se-help">Sections on this page, top to bottom.</p>
        <ol className="se-outline">
          {blocks.map((entry, index) => {
            const { label, detail } = blockSummary(site, entry);
            const target = { root: entry.id, path: [] };
            return (
              <li key={entry.id} className="se-outline-row">
                <button type="button" className="se-outline-open" onClick={() => onSelect(target)}>
                  <span className="se-outline-label">{label}</span>
                  {detail && <span className="se-outline-detail">{detail}</span>}
                </button>
                <span className="se-list-actions">
                  <button type="button" className="se-icon-button" title="Move up" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onAction("moveUp", target)}>
                    <UpIcon />
                  </button>
                  <button type="button" className="se-icon-button" title="Move down" aria-label={`Move ${label} down`} disabled={index === blocks.length - 1} onClick={() => onAction("moveDown", target)}>
                    <DownIcon />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
        {blocks.length === 0 && <p className="se-help">This page has no sections yet.</p>}
        <button type="button" className="se-button se-add" onClick={() => onAddBlock(null)}>
          <PlusIcon />
          Add a section
        </button>
      </section>
      <section className="se-panel-section">
        <button type="button" className="se-outline-open se-settings-link" onClick={() => onSelect({ root: SITE_ROOT, path: [] })}>
          <SettingsIcon />
          <span>
            <span className="se-outline-label">Site settings</span>
            <span className="se-outline-detail">Shared across pages: name, contact details, menu</span>
          </span>
        </button>
      </section>
      <section className="se-panel-section se-tips">
        <h3 className="se-label">Tips</h3>
        <ul>
          <li>Click anything on the page to select it. Click selected text again to type.</li>
          <li>Esc selects the surrounding section. ⌘Z / Ctrl+Z undoes.</li>
          <li>Nothing goes live until you press Publish.</li>
        </ul>
      </section>
    </div>
  );
}

function Inspector({ site, content, page, selection, focus, handlers, onSelect, onAction }: PanelProps & { selection: Target }) {
  const body = useRef<HTMLDivElement>(null);
  const field = fieldForTarget(site, content, page, selection);
  const value = getTargetValue(content, page, selection);
  const chain = targetChain(selection);
  const movable = isBlockTarget(selection) || isItemTarget(selection);
  const title = labelForTarget(site, content, page, selection);

  const itemName = isItemTarget(selection)
    ? ((fieldForTarget(site, content, page, { root: selection.root, path: selection.path.slice(0, -1) }) as ListField | null)?.itemLabel ?? "item").toLowerCase()
    : "section";

  // Focus the input for a field picked on the page.
  const focusKey = focus ? targetKey(focus) : null;
  useEffect(() => {
    if (!focus || focus.root !== selection.root) return;
    const relative = formatPath(focus.path.slice(selection.path.length));
    const marked = body.current?.querySelector<HTMLElement>(`[data-se-path="${CSS.escape(relative)}"]`);
    const control = controlIn(marked);
    marked?.scrollIntoView({ block: "center" });
    control?.focus({ preventScroll: true });
  }, [focusKey]);

  // Paths inside the inspector are relative to the selection.
  const relative: FieldHandlers = {
    ...handlers,
    change: (path, next) => handlers.change([...selection.path, ...path], next),
    select: (path) => handlers.select([...selection.path, ...path]),
    upload: (path, file, kind) => handlers.upload([...selection.path, ...path], file, kind),
  };

  return (
    <div className="se-panel-scroll">
      <div className="se-inspector-head">
        <button type="button" className="se-back" onClick={() => onSelect(null)}>
          <BackIcon />
          Page
        </button>
        {chain.length > 1 && (
          <nav className="se-crumbs" aria-label="Selected element">
            {chain.slice(0, -1).map((target, index) => (
              <Fragment key={targetKey(target)}>
                {index > 0 && <span className="se-crumb-sep" aria-hidden="true">›</span>}
                <button type="button" className="se-crumb" onClick={() => onSelect(target)}>
                  {labelForTarget(site, content, page, target)}
                </button>
              </Fragment>
            ))}
          </nav>
        )}
        <h2 className="se-panel-title">{title}</h2>
        {movable && (
          <div className="se-inspector-actions">
            <button type="button" className="se-icon-button" title="Move up" aria-label="Move up" disabled={!canMoveTarget(content, page, selection, -1)} onClick={() => onAction("moveUp", selection)}>
              <UpIcon />
            </button>
            <button type="button" className="se-icon-button" title="Move down" aria-label="Move down" disabled={!canMoveTarget(content, page, selection, 1)} onClick={() => onAction("moveDown", selection)}>
              <DownIcon />
            </button>
            <button type="button" className="se-button" onClick={() => onAction("duplicate", selection)}>
              <CopyIcon />
              Duplicate
            </button>
            <button type="button" className="se-button" onClick={() => onAction("add", selection)}>
              <PlusIcon />
              Add {itemName}
            </button>
            <button type="button" className="se-button se-danger" onClick={() => onAction("delete", selection)}>
              <TrashIcon />
              Delete
            </button>
          </div>
        )}
      </div>
      <div ref={body} className="se-panel-section">
        {field ? (
          <FieldControl field={field} value={value} path={[]} handlers={relative} bare={field.kind === "object"} />
        ) : (
          <p className="se-help">This block type isn&rsquo;t known to the editor, so it can only be moved or deleted.</p>
        )}
      </div>
    </div>
  );
}
