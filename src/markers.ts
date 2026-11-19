import { parsePath, SITE_ROOT, type Target } from "./content.js";

/**
 * Site components mark what's editable with data attributes. They're inert markup, so components stay plain
 * and render the same on the live site; the editor reads them to map clicks on the page back to content.
 *
 *   <h3 {...field("title")}>{paper.title}</h3>           text you can type into
 *   <article {...item("items", i)}>…</article>          one entry of a list: select, move, duplicate, delete
 *   <li {...textItem("keywords", i)}>{keyword}</li>      a list entry that is itself text
 *   <a {...field("site:name")}>{site.name}</a>          a site-wide field, wherever it appears
 *
 * Paths are relative to the enclosing item, then the block. A `site:` prefix makes a path start at the site
 * fields instead. Mark only elements whose sole child is the text, so typing into them can't disturb React.
 * Marking anything else (a photo, say) makes clicking it open that field in the editor panel instead.
 */

export const BLOCK_ATTR = "data-se-block";
export const ITEM_ATTR = "data-se-item";
export const FIELD_ATTR = "data-se-field";

const SITE_PREFIX = "site:";

export const field = (path: string) => ({ [FIELD_ATTR]: path }) as { "data-se-field": string };

export const item = (list: string, index: number) => ({ [ITEM_ATTR]: `${list}.${index}` }) as { "data-se-item": string };

export const textItem = (list: string, index: number) =>
  ({ [ITEM_ATTR]: `${list}.${index}`, [FIELD_ATTR]: "." }) as { "data-se-item": string; "data-se-field": string };

/** The DOM surface marker resolution needs, so it can be tested without a browser. */
export interface MarkedNode {
  getAttribute(name: string): string | null;
  readonly parentElement: MarkedNode | null;
}

const siteRelative = (value: string) => (value.startsWith(SITE_PREFIX) ? value.slice(SITE_PREFIX.length) : null);

/** Walks up from `start`, prefixing item paths, until a block or a `site:` path anchors the result. */
function resolveUp(start: MarkedNode | null, tail: Target["path"]): Target | null {
  const path = [...tail];
  for (let node = start; node; node = node.parentElement) {
    const itemPath = node.getAttribute(ITEM_ATTR);
    if (itemPath !== null) {
      const site = siteRelative(itemPath);
      if (site !== null) return { root: SITE_ROOT, path: [...parsePath(site), ...path] };
      path.unshift(...parsePath(itemPath));
    }
    const blockId = node.getAttribute(BLOCK_ATTR);
    if (blockId !== null) return { root: blockId, path };
  }
  return null;
}

/** The content target of an element carrying `data-se-field`. */
export function resolveField(element: MarkedNode): Target | null {
  const value = element.getAttribute(FIELD_ATTR);
  if (value === null) return null;
  const site = siteRelative(value);
  if (site !== null) return { root: SITE_ROOT, path: parsePath(site) };
  return resolveUp(element, parsePath(value));
}

/** The content target of an element carrying `data-se-item` or `data-se-block`. */
export const resolveItem = (element: MarkedNode): Target | null => resolveUp(element, []);
