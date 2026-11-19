import { describe, expect, it } from "vitest";
import { SITE_ROOT } from "../src/content.js";
import { BLOCK_ATTR, FIELD_ATTR, ITEM_ATTR, resolveField, resolveItem, type MarkedNode } from "../src/markers.js";

/** Builds a chain of fake elements, outermost first, and returns the innermost. */
function chain(...attrs: Record<string, string>[]): MarkedNode {
  let parent: MarkedNode | null = null;
  for (const set of attrs) {
    const node: MarkedNode = { getAttribute: (name) => set[name] ?? null, parentElement: parent };
    parent = node;
  }
  return parent!;
}

describe("resolveField", () => {
  it("joins field, item and block paths", () => {
    const el = chain({ [BLOCK_ATTR]: "b1" }, {}, { [ITEM_ATTR]: "items.2" }, { [FIELD_ATTR]: "title" });
    expect(resolveField(el)).toEqual({ root: "b1", path: ["items", 2, "title"] });
  });

  it("handles nested items and text items", () => {
    const el = chain({ [BLOCK_ATTR]: "b1" }, { [ITEM_ATTR]: "items.0" }, { [ITEM_ATTR]: "tags.1", [FIELD_ATTR]: "." });
    expect(resolveField(el)).toEqual({ root: "b1", path: ["items", 0, "tags", 1] });
  });

  it("anchors site: paths at the site fields", () => {
    expect(resolveField(chain({ [BLOCK_ATTR]: "b1" }, { [FIELD_ATTR]: "site:name" }))).toEqual({
      root: SITE_ROOT,
      path: ["name"],
    });
    expect(resolveField(chain({ [ITEM_ATTR]: "site:nav.1" }, { [FIELD_ATTR]: "label" }))).toEqual({
      root: SITE_ROOT,
      path: ["nav", 1, "label"],
    });
  });

  it("returns null outside any block", () => {
    expect(resolveField(chain({}, { [FIELD_ATTR]: "title" }))).toBeNull();
    expect(resolveField(chain({}))).toBeNull();
  });
});

describe("resolveItem", () => {
  it("resolves items and blocks", () => {
    expect(resolveItem(chain({ [BLOCK_ATTR]: "b1" }, { [ITEM_ATTR]: "items.3" }))).toEqual({ root: "b1", path: ["items", 3] });
    expect(resolveItem(chain({ [BLOCK_ATTR]: "b1" }))).toEqual({ root: "b1", path: [] });
  });
});
