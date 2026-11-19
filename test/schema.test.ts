import { describe, expect, expectTypeOf, it } from "vitest";
import {
  fieldAtPath,
  itemLabel,
  newBlock,
  normalizeContent,
  parseContent,
  siteField,
  type BlockData,
  type ImageValue,
  type SiteData,
} from "../src/schema.js";
import { raw, site } from "./fixtures.js";

describe("types", () => {
  it("infers block and site data from fields", () => {
    expectTypeOf<BlockData<typeof site, "papers">>().toEqualTypeOf<{
      heading: string;
      items: { status: "in-progress" | "published"; title: string; tags: string[]; url: string }[];
    }>();
    expectTypeOf<BlockData<typeof site, "hero">["photo"]>().toEqualTypeOf<ImageValue>();
    expectTypeOf<SiteData<typeof site>["nav"]>().toEqualTypeOf<{ label: string; href: string }[]>();
  });
});

describe("normalizeContent", () => {
  it("keeps valid content as it is", () => {
    const content = normalizeContent(site, raw);
    expect(content.pages.home!.blocks[1]!.data).toEqual(raw.pages.home.blocks[1]!.data);
    expect(content.site).toEqual(raw.site);
  });

  it("fills missing fields with defaults", () => {
    const content = normalizeContent(site, raw);
    expect(content.pages.home!.blocks[0]!.data.photo).toEqual({ src: "", alt: "" });
  });

  it("replaces wrong types and unknown select values with defaults", () => {
    const content = normalizeContent(site, {
      pages: { home: { blocks: [{ id: "p", type: "papers", data: { heading: 4, items: [{ status: "lost", tags: "x" }] } }] } },
    });
    expect(content.pages.home!.blocks[0]!.data).toEqual({
      heading: "Papers",
      items: [{ status: "in-progress", title: "New paper", tags: [], url: "" }],
    });
  });

  it("clears links that could run script", () => {
    const content = normalizeContent(site, {
      site: { nav: [{ label: "x", href: "javascript:alert(1)" }] },
      pages: { home: { blocks: [{ id: "h", type: "hero", data: { photo: { src: " data:text/html,x", alt: "" } } }] } },
    });
    expect((content.site.nav as { href: string }[])[0]!.href).toBe("");
    expect((content.pages.home!.blocks[0]!.data.photo as ImageValue).src).toBe("");
  });

  it("keeps keys and blocks it doesn't know", () => {
    const content = normalizeContent(site, {
      extra: 1,
      site: { name: "A", future: true },
      pages: { home: { blocks: [{ id: "z", type: "gallery", data: { a: 1 } }] } },
    });
    expect((content as unknown as { extra: number }).extra).toBe(1);
    expect(content.site.future).toBe(true);
    expect(content.pages.home!.blocks[0]).toEqual({ id: "z", type: "gallery", data: { a: 1 } });
  });

  it("gives blocks without a usable id a fresh unique one", () => {
    const content = normalizeContent(site, {
      pages: { home: { blocks: [{ type: "hero" }, { id: "a", type: "hero" }, { id: "a", type: "hero" }, { id: "x y", type: "hero" }] } },
    });
    const ids = content.pages.home!.blocks.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[1]).toBe("a");
    ids.forEach((id) => expect(id).toMatch(/^[A-Za-z0-9_-]+$/));
  });

  it("creates pages missing from the file", () => {
    expect(normalizeContent(site, {}).pages).toEqual({ home: { blocks: [] } });
  });

  it("types parsed content", () => {
    const content = parseContent(site, raw);
    expectTypeOf(content.site.name).toEqualTypeOf<string>();
  });
});

describe("newBlock", () => {
  it("uses field defaults under the block's initial values", () => {
    const entry = newBlock(site, "papers");
    expect(entry.type).toBe("papers");
    expect(entry.data).toEqual({ heading: "New section", items: [] });
  });

  it("doesn't share initial values between blocks", () => {
    const a = newBlock(site, "papers");
    const b = newBlock(site, "papers");
    expect(a.id).not.toBe(b.id);
    expect(a.data).not.toBe(b.data);
  });
});

describe("fieldAtPath and itemLabel", () => {
  it("walks objects, lists and images", () => {
    const root = siteField(site);
    expect(fieldAtPath(root, ["nav", 0, "label"])).toMatchObject({ kind: "text" });
    expect(fieldAtPath(root, ["nav", "label"])).toBeNull();
  });

  it("names items by their label field, text or position", () => {
    const nav = fieldAtPath(siteField(site), ["nav"]);
    if (nav?.kind !== "list") throw new Error("expected a list");
    expect(itemLabel(nav, { label: "About" }, 0)).toBe("About");
    expect(itemLabel(nav, { label: "  " }, 2)).toBe("Link 3");
    expect(itemLabel({ kind: "list", item: { kind: "text" } }, "Mpox", 0)).toBe("Mpox");
  });
});
