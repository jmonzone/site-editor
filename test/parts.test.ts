import { describe, expect, expectTypeOf, it } from "vitest";
import { getTargetValue, partAt, partMissing, partsOf, removePart, restorePart, SITE_ROOT } from "../src/content.js";
import { block, defineSite, f, normalizeContent, type BlockData, type SiteData } from "../src/schema.js";

// A site with removable parts: a paper's badge (two fields removed together), its DOI and abstract, a line
// above the heading, and a site-wide LinkedIn link.
const paper = f.object({
  badge: f.optional(
    f.object(
      { status: f.select(["Ongoing", "Published"]), label: f.text({ default: "Ongoing" }) },
      { label: "Badge" },
    ),
  ),
  title: f.text({ default: "New paper" }),
  doi: f.optional(f.text({ label: "DOI" })),
  summary: f.optional(f.textarea({ default: "Abstract" })),
  tags: f.list(f.text()),
});

const site = defineSite({
  name: "Parts",
  site: { name: f.text(), linkedin: f.optional(f.url({ label: "LinkedIn link" })) },
  blocks: {
    papers: block({
      label: "Papers",
      fields: { eyebrow: f.optional(f.text()), heading: f.text(), items: f.list(paper, { itemLabel: "Paper" }) },
    }),
  },
  pages: { home: { label: "Home", path: "/" } },
});

const raw = {
  site: { name: "Ada", linkedin: null },
  pages: {
    home: {
      blocks: [
        {
          id: "p1",
          type: "papers",
          data: {
            eyebrow: "",
            heading: "Papers",
            items: [
              { badge: { status: "Published", label: "Published" }, title: "First", doi: "10.1/x", summary: null, tags: [] },
              { badge: null, title: "Second", doi: "", summary: "Text", tags: [] },
            ],
          },
        },
      ],
    },
  },
};

const content = () => normalizeContent(site, raw);
const item = (index: number) => ({ root: "p1", path: ["items", index] });

describe("optional fields", () => {
  it("add null to the field's type", () => {
    expectTypeOf<BlockData<typeof site, "papers">["eyebrow"]>().toEqualTypeOf<string | null>();
    expectTypeOf<BlockData<typeof site, "papers">["items"][number]["badge"]>().toEqualTypeOf<{
      status: "Ongoing" | "Published";
      label: string;
    } | null>();
    expectTypeOf<BlockData<typeof site, "papers">["heading"]>().toEqualTypeOf<string>();
    expectTypeOf<SiteData<typeof site>["linkedin"]>().toEqualTypeOf<string | null>();
  });

  it("keep null through normalizing, and still fill missing keys with the default", () => {
    const c = content();
    expect(getTargetValue(c, "home", { root: "p1", path: ["items", 1, "badge"] })).toBeNull();
    expect(c.site.linkedin).toBeNull();
    const fresh = normalizeContent(site, { pages: { home: { blocks: [{ id: "p2", type: "papers", data: { items: [{}] } }] } } });
    expect(getTargetValue(fresh, "home", { root: "p2", path: ["items", 0, "badge"] })).toEqual({ status: "Ongoing", label: "Ongoing" });
    expect(getTargetValue(fresh, "home", { root: "p2", path: ["eyebrow"] })).toBe("");
  });

  it("only take null where the field is optional", () => {
    const c = normalizeContent(site, { pages: { home: { blocks: [{ id: "p", type: "papers", data: { heading: null, items: [] } }] } } });
    expect(getTargetValue(c, "home", { root: "p", path: ["heading"] })).toBe("");
  });
});

describe("partsOf", () => {
  it("lists an item's removable parts in order, with which are missing", () => {
    const parts = partsOf(site, content(), "home", item(0));
    expect(parts.map((p) => [p.label, p.missing])).toEqual([
      ["Badge", false],
      ["DOI", false],
      ["Summary", true],
    ]);
    expect(parts[0]!.target).toEqual({ root: "p1", path: ["items", 0, "badge"] });
  });

  it("counts empty text as missing, but not other empty values", () => {
    const parts = partsOf(site, content(), "home", item(1));
    expect(parts.filter((p) => p.missing).map((p) => p.label)).toEqual(["Badge", "DOI"]);
    expect(partMissing(f.optional(f.list(f.text())), [])).toBe(false);
  });

  it("covers a block's own fields without reaching into its list items, and the site fields", () => {
    expect(partsOf(site, content(), "home", { root: "p1", path: [] }).map((p) => p.label)).toEqual(["Eyebrow"]);
    expect(partsOf(site, content(), "home", { root: SITE_ROOT, path: [] }).map((p) => [p.label, p.missing])).toEqual([["LinkedIn link", true]]);
  });
});

describe("partAt", () => {
  it("finds the closest optional field above a value, within its item", () => {
    const c = content();
    expect(partAt(site, c, "home", { root: "p1", path: ["items", 0, "badge", "label"] })).toEqual({ root: "p1", path: ["items", 0, "badge"] });
    expect(partAt(site, c, "home", { root: "p1", path: ["items", 0, "doi"] })).toEqual({ root: "p1", path: ["items", 0, "doi"] });
    expect(partAt(site, c, "home", { root: "p1", path: ["items", 0, "title"] })).toBeNull();
    expect(partAt(site, c, "home", { root: "p1", path: ["items", 0, "tags", 0] })).toBeNull();
    expect(partAt(site, c, "home", { root: SITE_ROOT, path: ["linkedin"] })).toEqual({ root: SITE_ROOT, path: ["linkedin"] });
  });
});

describe("removing and restoring parts", () => {
  it("removes a part as null and puts it back with its defaults", () => {
    const badge = { root: "p1", path: ["items", 0, "badge"] };
    const removed = removePart(content(), "home", badge);
    expect(getTargetValue(removed, "home", badge)).toBeNull();
    expect(getTargetValue(removed, "home", { root: "p1", path: ["items", 0, "title"] })).toBe("First");
    const back = restorePart(site, removed, "home", badge);
    expect(getTargetValue(back, "home", badge)).toEqual({ status: "Ongoing", label: "Ongoing" });
  });

  it("leaves a part that's there alone, even when it's empty", () => {
    const c = content();
    expect(restorePart(site, c, "home", { root: "p1", path: ["items", 1, "doi"] })).toBe(c);
    expect(restorePart(site, c, "home", { root: "p1", path: ["items", 1, "title"] })).toBe(c);
  });
});
