import {
  blockField,
  defaultValue,
  fieldAtPath,
  fieldLabel,
  isRecord,
  itemLabel,
  newId,
  siteField,
  type Field,
  type ListField,
  type RawBlock,
  type RawContent,
  type Seg,
  type Shape,
  type SiteDef,
} from "./schema.js";

/**
 * Something on a page the editor can point at: a block (`{ root: blockId, path: [] }`), a value inside it
 * (`{ root: blockId, path: ["items", 0, "title"] }`), or the shared site fields (`{ root: SITE_ROOT, path }`).
 */
export interface Target {
  root: string;
  path: Seg[];
}

/** Root of targets in the site-wide fields. Can't clash with a block id, which never contains "@". */
export const SITE_ROOT = "@site";

export function parsePath(text: string): Seg[] {
  if (!text || text === ".") return [];
  return text.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

export const formatPath = (path: readonly Seg[]) => path.join(".");

export const targetKey = (target: Target) => `${target.root}:${formatPath(target.path)}`;

export const sameTarget = (a: Target | null | undefined, b: Target | null | undefined) =>
  !!a && !!b && a.root === b.root && a.path.length === b.path.length && a.path.every((seg, i) => seg === b.path[i]);

export const isSiteTarget = (target: Target) => target.root === SITE_ROOT;
export const isBlockTarget = (target: Target) => target.root !== SITE_ROOT && target.path.length === 0;
export const isItemTarget = (target: Target) => typeof target.path[target.path.length - 1] === "number";

/** Targets that can be selected on the page: blocks, list items and the site fields as a whole. */
export const isSelectable = (target: Target) =>
  isBlockTarget(target) || isItemTarget(target) || (isSiteTarget(target) && target.path.length === 0);

// ---------------------------------------------------------------------------
// Immutable paths
// ---------------------------------------------------------------------------

export function getIn(value: unknown, path: readonly Seg[]): unknown {
  let current = value;
  for (const seg of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[seg];
  }
  return current;
}

/** Returns a copy with the value at `path` replaced, copying only the objects along the path. */
export function setIn<T>(value: T, path: readonly Seg[], next: unknown): T {
  if (path.length === 0) return next as T;
  const [head, ...rest] = path;
  const copy = (Array.isArray(value) ? [...value] : { ...(value as object) }) as Record<string | number, unknown>;
  copy[head as string | number] = setIn((value as Record<string | number, unknown> | undefined)?.[head as string | number], rest, next);
  return copy as T;
}

const updateIn = <T>(value: T, path: readonly Seg[], update: (current: unknown) => unknown): T =>
  setIn(value, path, update(getIn(value, path)));

// ---------------------------------------------------------------------------
// Resolving targets
// ---------------------------------------------------------------------------

export const pageBlocks = (content: RawContent, page: string): RawBlock[] => content.pages[page]?.blocks ?? [];

export function findBlock(content: RawContent, page: string, id: string) {
  const index = pageBlocks(content, page).findIndex((entry) => entry.id === id);
  return index < 0 ? null : { block: pageBlocks(content, page)[index]!, index };
}

/**
 * The target's path from the content root, or null when its block isn't on the page. Paths in a block start at
 * its data, so a block target points at the block's data.
 */
export function absolutePath(content: RawContent, page: string, target: Target): Seg[] | null {
  if (isSiteTarget(target)) return ["site", ...target.path];
  const found = findBlock(content, page, target.root);
  return found ? ["pages", page, "blocks", found.index, "data", ...target.path] : null;
}

export function getTargetValue(content: RawContent, page: string, target: Target): unknown {
  const path = absolutePath(content, page, target);
  return path ? getIn(content, path) : undefined;
}

export function targetExists(content: RawContent, page: string, target: Target): boolean {
  return getTargetValue(content, page, target) !== undefined;
}

export function setTargetValue(content: RawContent, page: string, target: Target, value: unknown): RawContent {
  const path = absolutePath(content, page, target);
  return path ? setIn(content, path, value) : content;
}

/** The selectable target that contains this one: an item's parent item or block, or null for a block. */
export function parentTarget(target: Target): Target | null {
  if (target.path.length === 0) return null;
  const path = [...target.path];
  if (typeof path[path.length - 1] === "number") path.pop();
  while (path.length && typeof path[path.length - 1] === "string") path.pop();
  return { root: target.root, path };
}

/** The selectable target that owns this one, which is the target itself when it's selectable. */
export const owningTarget = (target: Target): Target => (isSelectable(target) ? target : parentTarget(target)!);

/** Selectable targets from the outermost down to the target itself. */
export function targetChain(target: Target): Target[] {
  const chain: Target[] = [];
  for (let current: Target | null = owningTarget(target); current; current = parentTarget(current)) {
    chain.unshift(current);
  }
  return chain;
}

function rootField(def: SiteDef, content: RawContent, page: string, target: Target): Field | null {
  if (isSiteTarget(target)) return siteField(def);
  const found = findBlock(content, page, target.root);
  return found ? blockField(def, found.block.type) : null;
}

export function fieldForTarget(def: SiteDef, content: RawContent, page: string, target: Target): Field | null {
  const root = rootField(def, content, page, target);
  return root ? fieldAtPath(root, target.path) : null;
}

/** A block's label plus its label field, e.g. "Papers · Publications". */
export function blockSummary(def: SiteDef, entry: RawBlock): { label: string; detail: string } {
  const blockDef = def.blocks[entry.type];
  if (!blockDef) return { label: `Unknown block "${entry.type}"`, detail: "" };
  const detail = blockDef.labelField ? entry.data[blockDef.labelField] : undefined;
  return { label: blockDef.label, detail: typeof detail === "string" ? detail : "" };
}

/** A short name for a target: "Papers", "Paper 2", "Site settings". */
export function labelForTarget(def: SiteDef, content: RawContent, page: string, target: Target): string {
  if (isSiteTarget(target) && target.path.length === 0) return "Site settings";
  if (isBlockTarget(target)) {
    const found = findBlock(content, page, target.root);
    return found ? blockSummary(def, found.block).label : "Block";
  }
  if (isItemTarget(target)) {
    const list = fieldForTarget(def, content, page, { root: target.root, path: target.path.slice(0, -1) });
    const index = target.path[target.path.length - 1] as number;
    if (list?.kind === "list") return itemLabel(list, getTargetValue(content, page, target), index);
    return `Item ${index + 1}`;
  }
  const field = fieldForTarget(def, content, page, target);
  return field ? fieldLabel(field, target.path[target.path.length - 1]) : String(target.path[target.path.length - 1] ?? "");
}

// ---------------------------------------------------------------------------
// Removable parts (optional fields)
// ---------------------------------------------------------------------------

/** An optional field of a block, list item or the site fields: something editors can remove and add back. */
export interface Part {
  target: Target;
  field: Field;
  label: string;
  /** Removed (null), or a text that's empty, which the site usually doesn't show either. */
  missing: boolean;
}

const TEXT_KINDS = new Set(["text", "textarea", "url"]);

/** Whether an optional field is off the page: removed, or text left empty. */
export const partMissing = (field: Field, value: unknown) => value === null || (value === "" && TEXT_KINDS.has(field.kind));

/**
 * The removable parts of a selectable target, in field order. Looks inside objects but not inside lists, whose
 * items have parts of their own, nor inside a removed part.
 */
export function partsOf(def: SiteDef, content: RawContent, page: string, owner: Target): Part[] {
  const parts: Part[] = [];
  const walk = (field: Field, value: unknown, path: Seg[]) => {
    if (field.kind !== "object") return;
    for (const [key, child] of Object.entries(field.shape as Shape)) {
      const childValue = isRecord(value) ? value[key] : undefined;
      const childPath = [...path, key];
      if (child.optional) {
        parts.push({ target: { root: owner.root, path: childPath }, field: child, label: fieldLabel(child, key), missing: partMissing(child, childValue) });
      }
      if (childValue !== null) walk(child, childValue, childPath);
    }
  };
  const field = fieldForTarget(def, content, page, owner);
  if (field) walk(field, getTargetValue(content, page, owner), owner.path);
  return parts;
}

/** The removable part a value belongs to: the closest optional field on its path, without leaving its owner. */
export function partAt(def: SiteDef, content: RawContent, page: string, target: Target): Target | null {
  const owner = owningTarget(target);
  for (let length = target.path.length; length > owner.path.length; length--) {
    const candidate = { root: target.root, path: target.path.slice(0, length) };
    if (fieldForTarget(def, content, page, candidate)?.optional) return candidate;
  }
  return null;
}

/** Takes a removable part off the page. */
export const removePart = (content: RawContent, page: string, part: Target): RawContent => setTargetValue(content, page, part, null);

/** Puts a removed part back with its field's default. A part that's there (even if empty) is left as it is. */
export function restorePart(def: SiteDef, content: RawContent, page: string, part: Target): RawContent {
  const field = fieldForTarget(def, content, page, part);
  if (!field?.optional || getTargetValue(content, page, part) !== null) return content;
  return setTargetValue(content, page, part, defaultValue(field));
}

// ---------------------------------------------------------------------------
// Structural edits
// ---------------------------------------------------------------------------

/** New content, and what to select afterwards. */
export interface Edit {
  content: RawContent;
  select: Target | null;
}

const blocksPath = (page: string): Seg[] => ["pages", page, "blocks"];

/** The list path and index of an item target. */
function itemSlot(content: RawContent, page: string, target: Target) {
  if (!isItemTarget(target)) return null;
  const path = absolutePath(content, page, target);
  if (!path) return null;
  const list = getIn(content, path.slice(0, -1));
  return Array.isArray(list) ? { listPath: path.slice(0, -1), index: path[path.length - 1] as number, list } : null;
}

export function removeTarget(content: RawContent, page: string, target: Target): Edit {
  if (isBlockTarget(target)) {
    const next = updateIn(content, blocksPath(page), (blocks) =>
      (blocks as RawBlock[]).filter((entry) => entry.id !== target.root),
    );
    return { content: next, select: null };
  }
  const slot = itemSlot(content, page, target);
  if (!slot) return { content, select: null };
  const next = setIn(content, slot.listPath, slot.list.filter((_, i) => i !== slot.index));
  return { content: next, select: null };
}

const withIndex = (target: Target, index: number): Target => ({
  root: target.root,
  path: [...target.path.slice(0, -1), index],
});

export function duplicateTarget(content: RawContent, page: string, target: Target): Edit {
  if (isBlockTarget(target)) {
    const found = findBlock(content, page, target.root);
    if (!found) return { content, select: null };
    const copy: RawBlock = { ...structuredClone(found.block), id: newId() };
    return insertBlock(content, page, copy, found.block.id);
  }
  const slot = itemSlot(content, page, target);
  if (!slot) return { content, select: null };
  const list = [...slot.list];
  list.splice(slot.index + 1, 0, structuredClone(slot.list[slot.index]));
  return { content: setIn(content, slot.listPath, list), select: withIndex(target, slot.index + 1) };
}

export function canMoveTarget(content: RawContent, page: string, target: Target, delta: -1 | 1): boolean {
  if (isBlockTarget(target)) {
    const found = findBlock(content, page, target.root);
    const to = (found?.index ?? -1) + delta;
    return !!found && to >= 0 && to < pageBlocks(content, page).length;
  }
  const slot = itemSlot(content, page, target);
  return !!slot && slot.index + delta >= 0 && slot.index + delta < slot.list.length;
}

const swap = <T>(list: readonly T[], a: number, b: number): T[] => {
  const copy = [...list];
  [copy[a], copy[b]] = [copy[b]!, copy[a]!];
  return copy;
};

export function moveTarget(content: RawContent, page: string, target: Target, delta: -1 | 1): Edit {
  if (!canMoveTarget(content, page, target, delta)) return { content, select: target };
  if (isBlockTarget(target)) {
    const { index } = findBlock(content, page, target.root)!;
    const next = setIn(content, blocksPath(page), swap(pageBlocks(content, page), index, index + delta));
    return { content: next, select: target };
  }
  const slot = itemSlot(content, page, target)!;
  const next = setIn(content, slot.listPath, swap(slot.list, slot.index, slot.index + delta));
  return { content: next, select: withIndex(target, slot.index + delta) };
}

/** Inserts a block after another block, or at the end of the page when `afterId` is null or missing. */
export function insertBlock(content: RawContent, page: string, entry: RawBlock, afterId: string | null): Edit {
  const blocks = [...pageBlocks(content, page)];
  const after = afterId ? blocks.findIndex((existing) => existing.id === afterId) : -1;
  blocks.splice(after < 0 ? blocks.length : after + 1, 0, entry);
  return { content: setIn(content, blocksPath(page), blocks), select: { root: entry.id, path: [] } };
}

/** Inserts a fresh item into a list at `index` (the end when omitted). `list` targets the list itself. */
export function insertItem(def: SiteDef, content: RawContent, page: string, list: Target, index?: number): Edit {
  const field = fieldForTarget(def, content, page, list);
  const path = absolutePath(content, page, list);
  const current = path ? getIn(content, path) : undefined;
  if (field?.kind !== "list" || !path || !Array.isArray(current)) return { content, select: null };
  const at = Math.max(0, Math.min(index ?? current.length, current.length));
  const next = [...current];
  next.splice(at, 0, defaultValue((field as ListField).item as Field));
  return { content: setIn(content, path, next), select: { root: list.root, path: [...list.path, at] } };
}

/** Inserts a fresh item right after an item target. */
export const insertItemAfter = (def: SiteDef, content: RawContent, page: string, target: Target): Edit =>
  insertItem(def, content, page, { root: target.root, path: target.path.slice(0, -1) }, (target.path[target.path.length - 1] as number) + 1);

/** Replaces every string equal to a key of `assets` with its value, e.g. pending upload paths with data URLs. */
export function replaceStrings<T>(value: T, assets: Record<string, string>): T {
  if (typeof value === "string") return (assets[value] ?? value) as T;
  if (Array.isArray(value)) return value.map((entry) => replaceStrings(entry, assets)) as T;
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceStrings(entry, assets)])) as T;
  }
  return value;
}
