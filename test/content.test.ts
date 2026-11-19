import { describe, expect, it } from "vitest";
import {
  canMoveTarget,
  duplicateTarget,
  fieldForTarget,
  getTargetValue,
  insertBlock,
  insertItem,
  insertItemAfter,
  labelForTarget,
  moveTarget,
  parentTarget,
  removeTarget,
  replaceStrings,
  setIn,
  setTargetValue,
  SITE_ROOT,
  targetChain,
} from "../src/content.js";
import { newBlock, normalizeContent, type RawContent } from "../src/schema.js";
import { raw, site } from "./fixtures.js";

const content = (): RawContent => normalizeContent(site, raw);
const blocksOf = (c: RawContent) => c.pages.home!.blocks;
const titles = (c: RawContent) => (blocksOf(c)[1]!.data.items as { title: string }[]).map((p) => p.title);

describe("setIn", () => {
  it("copies only along the path", () => {
    const before = content();
    const after = setIn(before, ["pages", "home", "blocks", 1, "data", "heading"], "X");
    expect(blocksOf(after)[1]!.data.heading).toBe("X");
    expect(blocksOf(before)[1]!.data.heading).toBe("Research");
    expect(blocksOf(after)[0]).toBe(blocksOf(before)[0]);
    expect(after.site).toBe(before.site);
  });
});

describe("reading and writing targets", () => {
  it("reads and writes block, item and site values", () => {
    const c = content();
    expect(getTargetValue(c, "home", { root: "papers1", path: ["items", 1, "title"] })).toBe("Second");
    expect(getTargetValue(c, "home", { root: "papers1", path: [] })).toBe(blocksOf(c)[1]!.data);
    const next = setTargetValue(c, "home", { root: SITE_ROOT, path: ["name"] }, "Grace");
    expect(next.site.name).toBe("Grace");
  });

  it("leaves content alone when the block is gone", () => {
    const c = content();
    expect(setTargetValue(c, "home", { root: "nope", path: ["x"] }, 1)).toBe(c);
  });

  it("finds a target's field", () => {
    expect(fieldForTarget(site, content(), "home", { root: "papers1", path: ["items", 0, "tags"] })).toMatchObject({
      kind: "list",
      itemLabel: "Topic",
    });
  });
});

describe("parents and labels", () => {
  it("finds the selectable parent", () => {
    expect(parentTarget({ root: "p", path: ["items", 0, "tags", 1] })).toEqual({ root: "p", path: ["items", 0] });
    expect(parentTarget({ root: "p", path: ["items", 0] })).toEqual({ root: "p", path: [] });
    expect(parentTarget({ root: "p", path: [] })).toBeNull();
  });

  it("lists the chain from the block down", () => {
    expect(targetChain({ root: "p", path: ["items", 0, "title"] })).toEqual([
      { root: "p", path: [] },
      { root: "p", path: ["items", 0] },
    ]);
  });

  it("labels blocks, items and the site", () => {
    const c = content();
    expect(labelForTarget(site, c, "home", { root: "papers1", path: [] })).toBe("Papers");
    expect(labelForTarget(site, c, "home", { root: "papers1", path: ["items", 0] })).toBe("First");
    expect(labelForTarget(site, c, "home", { root: "papers1", path: ["items", 0, "tags", 1] })).toBe("b");
    expect(labelForTarget(site, c, "home", { root: SITE_ROOT, path: [] })).toBe("Site settings");
  });
});

describe("structural edits", () => {
  it("removes blocks and items", () => {
    expect(blocksOf(removeTarget(content(), "home", { root: "hero1", path: [] }).content)).toHaveLength(1);
    expect(titles(removeTarget(content(), "home", { root: "papers1", path: ["items", 0] }).content)).toEqual(["Second"]);
  });

  it("duplicates a block with a new id, right after it", () => {
    const { content: next, select } = duplicateTarget(content(), "home", { root: "hero1", path: [] });
    const blocks = blocksOf(next);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]!.id).not.toBe("hero1");
    expect(blocks[1]!.data).toEqual(blocks[0]!.data);
    expect(blocks[1]!.data).not.toBe(blocks[0]!.data);
    expect(select).toEqual({ root: blocks[1]!.id, path: [] });
  });

  it("duplicates an item and selects the copy", () => {
    const { content: next, select } = duplicateTarget(content(), "home", { root: "papers1", path: ["items", 0] });
    expect(titles(next)).toEqual(["First", "First", "Second"]);
    expect(select).toEqual({ root: "papers1", path: ["items", 1] });
  });

  it("moves blocks and items within bounds", () => {
    const c = content();
    expect(canMoveTarget(c, "home", { root: "hero1", path: [] }, -1)).toBe(false);
    expect(blocksOf(moveTarget(c, "home", { root: "hero1", path: [] }, 1).content).map((b) => b.id)).toEqual(["papers1", "hero1"]);
    const moved = moveTarget(c, "home", { root: "papers1", path: ["items", 1] }, -1);
    expect(titles(moved.content)).toEqual(["Second", "First"]);
    expect(moved.select).toEqual({ root: "papers1", path: ["items", 0] });
    expect(moveTarget(c, "home", { root: "papers1", path: ["items", 1] }, 1).content).toBe(c);
  });

  it("inserts blocks after another block or at the end", () => {
    const entry = newBlock(site, "papers");
    expect(blocksOf(insertBlock(content(), "home", entry, "hero1").content)[1]).toBe(entry);
    expect(blocksOf(insertBlock(content(), "home", entry, null).content)[2]).toBe(entry);
  });

  it("inserts default items", () => {
    const after = insertItemAfter(site, content(), "home", { root: "papers1", path: ["items", 0] });
    expect(titles(after.content)).toEqual(["First", "New paper", "Second"]);
    expect(after.select).toEqual({ root: "papers1", path: ["items", 1] });
    const appended = insertItem(site, content(), "home", { root: SITE_ROOT, path: ["nav"] });
    expect(appended.content.site.nav).toEqual([{ label: "About", href: "#about" }, { label: "Link", href: "#" }]);
    expect(appended.select).toEqual({ root: SITE_ROOT, path: ["nav", 1] });
  });
});

describe("replaceStrings", () => {
  it("swaps exact matches anywhere in the tree", () => {
    expect(replaceStrings({ a: ["/u/x.webp", "keep"], b: { src: "/u/x.webp" } }, { "/u/x.webp": "data:x" })).toEqual({
      a: ["data:x", "keep"],
      b: { src: "data:x" },
    });
  });
});
