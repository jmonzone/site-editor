"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  canMoveTarget,
  fieldForTarget,
  getTargetValue,
  isBlockTarget,
  isItemTarget,
  isSiteTarget,
  labelForTarget,
  owningTarget,
  parentTarget,
  partAt,
  partsOf,
  sameTarget,
  SITE_ROOT,
  targetChain,
  targetKey,
  type Part,
  type Target,
} from "../../content.js";
import { BLOCK_ATTR, FIELD_ATTR, ITEM_ATTR, resolveField, resolveItem } from "../../markers.js";
import type { BlockAction, CanvasMessageBody, ShellState } from "../../protocol.js";
import { defaultValue, type ListField, type SiteDef } from "../../schema.js";
import { CopyIcon, DownIcon, PlusIcon, TrashIcon, UpIcon } from "../icons.js";

const OWNER = `[${ITEM_ATTR}],[${BLOCK_ATTR}]`;
const UI = ".se-ui";

/** What clicking an element selects: its nearest item or block, or the site fields for a loose `site:` field. */
function selectionTargetOf(element: Element): Target | null {
  const owner = element.closest(OWNER);
  if (owner) return resolveItem(owner);
  return element.closest(`[${FIELD_ATTR}^="site:"]`) ? { root: SITE_ROOT, path: [] } : null;
}

/** The element showing a target. Prefers a visible one: menus often render their links twice. */
function elementFor(target: Target): Element | null {
  if (isBlockTarget(target)) return document.querySelector(`[${BLOCK_ATTR}="${CSS.escape(target.root)}"]`);
  if (!isItemTarget(target)) return null;
  let hidden: Element | null = null;
  for (const element of document.querySelectorAll(`[${ITEM_ATTR}]`)) {
    if (!sameTarget(resolveItem(element), target)) continue;
    if (element.getClientRects().length > 0) return element;
    hidden ??= element;
  }
  return hidden;
}

const insideTarget = (target: Target | null, outer: Target) =>
  !!target && target.root === outer.root && target.path.length >= outer.path.length && outer.path.every((seg, i) => target.path[i] === seg);

/** The marked fields showing a value or anything inside it, e.g. a badge's box and its text. */
function fieldElementsIn(target: Target): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${FIELD_ATTR}]`)).filter(
    (element) => element.getClientRects().length > 0 && insideTarget(resolveField(element), target),
  );
}

const isTextOnly = (element: Element) =>
  element.childNodes.length === 0 || (element.childNodes.length === 1 && element.firstChild!.nodeType === Node.TEXT_NODE);

/** The box around everything showing a part. */
function partRect(target: Target): DOMRect | null {
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const element of fieldElementsIn(target)) {
    const rect = element.getBoundingClientRect();
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return top === Infinity ? null : new DOMRect(left, top, right - left, bottom - top);
}

/** An element's box; for a block's `display: contents` wrapper, the box around its children. */
function rectOf(element: Element): DOMRect | null {
  if (!element.hasAttribute(BLOCK_ATTR)) {
    const rect = element.getBoundingClientRect();
    return rect.width || rect.height ? rect : null;
  }
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const child of element.children) {
    const rect = child.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return top === Infinity ? null : new DOMRect(left, top, right - left, bottom - top);
}

function placeBox(box: HTMLElement | null, rect: DOMRect | null) {
  if (!box) return;
  if (!rect) {
    box.style.display = "none";
    return;
  }
  const inset = 2;
  box.style.display = "block";
  box.style.transform = `translate(${rect.left - inset}px, ${rect.top - inset}px)`;
  box.style.width = `${rect.width + inset * 2}px`;
  box.style.height = `${rect.height + inset * 2}px`;
}

function placeToolbar(toolbar: HTMLElement | null, rect: DOMRect | null) {
  if (!toolbar) return;
  const offscreen = !rect || rect.bottom < 24 || rect.top > window.innerHeight - 24;
  toolbar.style.visibility = offscreen ? "hidden" : "visible";
  if (offscreen) return;
  const { offsetWidth: width, offsetHeight: height } = toolbar;
  let top = rect.top - height - 8;
  if (top < 8) top = Math.max(8, rect.top + 8);
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  toolbar.style.transform = `translate(${left}px, ${top}px)`;
}

interface TextEdit {
  element: HTMLElement;
  finish(commit: boolean): void;
}

/**
 * Lets the user type into a marked element in place. Only elements whose sole child is text are edited this
 * way: React sets such text through `textContent`, so typing into it can't desync React's tree.
 */
function beginTextEdit(element: HTMLElement, onDone: (value: string | null) => void): TextEdit {
  const original = element.textContent ?? "";
  try {
    element.contentEditable = "plaintext-only";
  } catch {
    // Older browsers reject the value; "true" below covers them.
  }
  if (element.contentEditable !== "plaintext-only") element.contentEditable = "true";
  element.setAttribute("data-se-editing", "");

  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    element.removeEventListener("keydown", onKeyDown);
    element.removeEventListener("paste", onPaste);
    element.removeEventListener("blur", onBlur);
    element.removeAttribute("contenteditable");
    element.removeAttribute("data-se-editing");
    window.getSelection()?.removeAllRanges();
    if (!commit) {
      element.textContent = original;
      onDone(null);
      return;
    }
    let value = (element.textContent ?? "").replace(/\u00a0/g, " ");
    if (value.trim() !== value) value = value.trim();
    onDone(value === original ? null : value);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };
  const onPaste = (event: ClipboardEvent) => {
    event.preventDefault();
    const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/\s*\n\s*/g, " ");
    document.execCommand("insertText", false, text);
  };
  const onBlur = () => finish(true);

  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("paste", onPaste);
  element.addEventListener("blur", onBlur);
  element.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(element);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  return { element, finish };
}

interface OverlayProps {
  site: SiteDef;
  state: ShellState;
  post: (message: CanvasMessageBody) => void;
}

/**
 * Hover and selection outlines, the selection toolbar, and click-to-select / click-again-to-type. Clicking a
 * removable part (an optional field) inside the selection also picks that part, so the toolbar can remove it.
 */
export function Overlay({ site, state, post }: OverlayProps) {
  const { content, page, selection } = state;
  const [hover, setHover] = useState<Target | null>(null);
  const [part, setPart] = useState<Target | null>(null);
  const [adding, setAdding] = useState(false);
  const stateRef = useRef(state);
  const hoverRef = useRef<Target | null>(null);
  const partRef = useRef<Target | null>(null);
  const editing = useRef<TextEdit | null>(null);
  const startEditRef = useRef<(element: HTMLElement) => void>(() => {});
  /** A part just added back, to start typing into once it's on the page. */
  const pendingEdit = useRef<Target | null>(null);
  const hoverBox = useRef<HTMLDivElement>(null);
  const selectBox = useRef<HTMLDivElement>(null);
  const partBox = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const revealed = useRef<string | null>(null);

  // The picked part, while it's on the page and inside the selection. Site fields can show inside any block
  // (a LinkedIn button in the intro, say), so a site part counts as inside whatever was selected around it.
  const activePart =
    part && selection && (sameTarget(owningTarget(part), selection) || isSiteTarget(part)) && getTargetValue(content, page, part) != null
      ? part
      : null;
  const missing = selection ? partsOf(site, content, page, selection).filter((entry) => entry.missing) : [];

  useLayoutEffect(() => {
    stateRef.current = state;
    partRef.current = activePart;
  });

  // Mark the fields a click would start typing into, so they can show a text cursor.
  useLayoutEffect(() => {
    for (const element of document.querySelectorAll(`[${FIELD_ATTR}]`)) {
      element.toggleAttribute("data-se-editable", !!selection && sameTarget(selectionTargetOf(element), selection));
    }
  });
  useEffect(
    () => () => {
      for (const element of document.querySelectorAll("[data-se-editable]")) element.removeAttribute("data-se-editable");
    },
    [],
  );

  useEffect(() => {
    const startEdit = (element: HTMLElement) => {
      const target = resolveField(element);
      if (!target || editing.current?.element === element) return;
      const { content: current, page: currentPage } = stateRef.current;
      if (!isTextOnly(element) || typeof getTargetValue(current, currentPage, target) !== "string") {
        post({ type: "inspect", target });
        return;
      }
      editing.current?.finish(true);
      editing.current = beginTextEdit(element, (value) => {
        editing.current = null;
        if (value === null) return;
        // Emptying an optional text removes it, so it's offered under Add rather than lost on the page.
        const { content: latest, page: latestPage } = stateRef.current;
        const removes = value === "" && !!fieldForTarget(site, latest, latestPage, target)?.optional;
        post({ type: "set", target, value: removes ? null : value });
      });
    };
    startEditRef.current = startEdit;

    /** The removable part a marked field belongs to, if any. */
    const partOf = (element: HTMLElement) => {
      const target = resolveField(element);
      const { content: current, page: currentPage } = stateRef.current;
      return target ? partAt(site, current, currentPage, target) : null;
    };

    const elementOf = (event: Event) => (event.target instanceof Element ? event.target : null);

    const onMouseDown = (event: MouseEvent) => {
      const element = elementOf(event);
      if (!element || element.closest(UI) || editing.current?.element.contains(element)) return;
      // Keeps clicks from selecting text, dragging links, or blurring an edit before the click commits it.
      event.preventDefault();
      // That also keeps the iframe from taking focus, which keyboard shortcuts here need.
      window.focus();
    };

    const onClick = (event: MouseEvent) => {
      const element = elementOf(event);
      if (!element || element.closest(UI)) return;
      event.preventDefault();
      event.stopPropagation();
      setAdding(false);
      const active = editing.current;
      // Clicks inside the text being edited only move the caret, even when it's a link.
      if (active?.element.contains(element)) return;
      active?.finish(true);
      const target = selectionTargetOf(element);
      const fieldElement = element.closest<HTMLElement>(`[${FIELD_ATTR}]`);
      if (fieldElement && target && sameTarget(target, stateRef.current.selection)) {
        setPart(partOf(fieldElement));
        startEdit(fieldElement);
      } else {
        setPart(null);
        post({ type: "select", target });
      }
    };

    const onDoubleClick = (event: MouseEvent) => {
      const element = elementOf(event);
      if (!element || element.closest(UI) || editing.current) return;
      const fieldElement = element.closest<HTMLElement>(`[${FIELD_ATTR}]`);
      if (!fieldElement) return;
      event.preventDefault();
      const target = selectionTargetOf(fieldElement);
      if (target && !sameTarget(target, stateRef.current.selection)) post({ type: "select", target });
      startEdit(fieldElement);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (editing.current || (event.target instanceof Element && event.target.closest(UI))) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && (key === "z" || key === "y")) {
        event.preventDefault();
        post({ type: "history", direction: key === "y" || event.shiftKey ? "redo" : "undo" });
        return;
      }
      const current = stateRef.current.selection;
      if (!current) return;
      const picked = partRef.current;
      if (picked && (event.key === "Delete" || event.key === "Backspace" || event.key === "Escape")) {
        event.preventDefault();
        if (event.key !== "Escape") post({ type: "set", target: picked, value: null });
        setPart(null);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && (isBlockTarget(current) || isItemTarget(current))) {
        event.preventDefault();
        post({ type: "action", action: "delete", target: current });
      } else if (event.key === "Escape") {
        event.preventDefault();
        post({ type: "select", target: parentTarget(current) });
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      const element = elementOf(event);
      const target = element && !element.closest(UI) ? selectionTargetOf(element) : null;
      if (target === hoverRef.current || sameTarget(target, hoverRef.current)) return;
      hoverRef.current = target;
      setHover(target);
    };
    const onMouseLeave = () => {
      hoverRef.current = null;
      setHover(null);
    };
    const onSubmit = (event: Event) => event.preventDefault();

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("dblclick", onDoubleClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("submit", onSubmit, true);
    document.addEventListener("mousemove", onMouseMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onMouseLeave);
    return () => {
      editing.current?.finish(true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("dblclick", onDoubleClick, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("mousemove", onMouseMove);
      document.documentElement.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [post, site]);

  // A new selection closes the Add menu and drops the picked part, unless the selection moved to the part's
  // owner: picking a site part inside a block opens Site settings, and the part stays picked there.
  const selectionKey = selection ? targetKey(selection) : null;
  useLayoutEffect(() => {
    setPart((picked) => (picked && selection && sameTarget(owningTarget(picked), selection) ? picked : null));
    setAdding(false);
  }, [selectionKey]);

  // Once a part that was added back is on the page, type into it there, or open it in the panel.
  useLayoutEffect(() => {
    const target = pendingEdit.current;
    if (!target) return;
    const value = getTargetValue(content, page, target);
    if (value === null) return; // the change hasn't come back from the editor yet
    pendingEdit.current = null;
    if (value === undefined) return;
    const text = fieldElementsIn(target).find((element) => {
      const field = resolveField(element);
      return isTextOnly(element) && !!field && typeof getTargetValue(content, page, field) === "string";
    });
    if (text) startEditRef.current(text);
    else post({ type: "inspect", target });
  });

  // Outlines follow their elements through scrolling, resizing and re-rendering.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const current = stateRef.current.selection;
      const selected = current ? elementFor(current) : null;
      const selectedRect = selected ? rectOf(selected) : null;
      const pickedRect = partRef.current ? partRect(partRef.current) : null;
      placeBox(selectBox.current, selectedRect);
      placeBox(partBox.current, pickedRect);
      // With a part picked, the toolbar sits by the part: the selection may have no box (Site settings).
      placeToolbar(toolbar.current, pickedRect ?? selectedRect);
      const hovered = hoverRef.current && !sameTarget(hoverRef.current, current) ? elementFor(hoverRef.current) : null;
      placeBox(hoverBox.current, hovered ? rectOf(hovered) : null);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Scroll to a selection made in the editor panel.
  useEffect(() => {
    const changed = revealed.current !== selectionKey;
    revealed.current = selectionKey;
    if (!changed || !state.reveal || !selection) return;
    const element = elementFor(selection);
    const rect = element && rectOf(element);
    if (rect && (rect.top < 80 || rect.top > window.innerHeight - 80)) {
      window.scrollBy({ top: rect.top - 96, behavior: "smooth" });
    }
  }, [state.reveal, selection, selectionKey]);

  const act = (action: BlockAction) => selection && post({ type: "action", action, target: selection });
  const removePart = (target: Target) => {
    post({ type: "set", target, value: null });
    setPart(null);
  };
  const addPart = ({ target, field }: Part) => {
    setAdding(false);
    setPart(target);
    pendingEdit.current = target;
    if (getTargetValue(content, page, target) === null) post({ type: "set", target, value: defaultValue(field) });
  };
  const movable = !!selection && (isBlockTarget(selection) || isItemTarget(selection));
  const itemName = (() => {
    if (!selection || !isItemTarget(selection)) return "section";
    const list = fieldForTarget(site, content, page, { root: selection.root, path: selection.path.slice(0, -1) });
    return ((list as ListField | null)?.itemLabel ?? "item").toLowerCase();
  })();

  return createPortal(
    <div className="se-ui">
      <div ref={hoverBox} className="se-box se-box-hover">
        {hover && <span className="se-box-label">{labelForTarget(site, content, page, hover)}</span>}
      </div>
      <div ref={selectBox} className="se-box se-box-selected" />
      <div ref={partBox} className="se-box se-box-part" />
      {selection && (
        <div ref={toolbar} className="se-toolbar" role="toolbar" aria-label="Selected element">
          <span className="se-crumbs">
            {targetChain(selection).map((target, i, chain) => (
              <Fragment key={targetKey(target)}>
                {i > 0 && <span className="se-crumb-sep" aria-hidden="true">›</span>}
                <button
                  type="button"
                  className="se-crumb"
                  aria-current={i === chain.length - 1 && !activePart ? "true" : undefined}
                  onClick={() => {
                    setPart(null);
                    post({ type: "select", target });
                  }}
                >
                  {labelForTarget(site, content, page, target)}
                </button>
              </Fragment>
            ))}
            {activePart && (
              <>
                <span className="se-crumb-sep" aria-hidden="true">›</span>
                <span className="se-crumb" aria-current="true">
                  {labelForTarget(site, content, page, activePart)}
                </span>
              </>
            )}
          </span>
          {activePart && (
            <span className="se-toolbar-actions">
              <button
                type="button"
                className="se-toolbar-text se-danger"
                title={`Remove ${labelForTarget(site, content, page, activePart)} from the page (Delete)`}
                onClick={() => removePart(activePart)}
              >
                <TrashIcon />
                Remove
              </button>
            </span>
          )}
          {!activePart && missing.length > 0 && (
            <span className="se-toolbar-actions se-toolbar-add">
              <button
                type="button"
                className="se-toolbar-text"
                aria-expanded={adding}
                title={`Add back something removed from this ${itemName}`}
                onClick={() => setAdding((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setAdding(false);
                }}
              >
                <PlusIcon />
                Add
              </button>
              {adding && (
                <span className="se-toolbar-menu">
                  {missing.map((entry) => (
                    <button
                      key={targetKey(entry.target)}
                      type="button"
                      onClick={() => addPart(entry)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setAdding(false);
                      }}
                    >
                      {entry.label}
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
          {movable && !activePart && (
            <span className="se-toolbar-actions">
              <button type="button" title="Move up" aria-label="Move up" disabled={!canMoveTarget(content, page, selection, -1)} onClick={() => act("moveUp")}>
                <UpIcon />
              </button>
              <button type="button" title="Move down" aria-label="Move down" disabled={!canMoveTarget(content, page, selection, 1)} onClick={() => act("moveDown")}>
                <DownIcon />
              </button>
              <button type="button" title="Duplicate" aria-label="Duplicate" onClick={() => act("duplicate")}>
                <CopyIcon />
              </button>
              <button type="button" title={`Add a ${itemName} below`} aria-label={`Add a ${itemName} below`} onClick={() => act("add")}>
                <PlusIcon />
              </button>
              <button type="button" title="Delete" aria-label="Delete" className="se-danger" onClick={() => act("delete")}>
                <TrashIcon />
              </button>
            </span>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
