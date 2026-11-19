import { block, defineSite, f } from "../src/schema.js";

export const paper = f.object({
  status: f.select([
    { value: "in-progress", label: "Ongoing" },
    { value: "published", label: "Published" },
  ]),
  title: f.text({ label: "Title", default: "New paper" }),
  tags: f.list(f.text({ default: "Topic" }), { itemLabel: "Topic" }),
  url: f.url(),
});

export const site = defineSite({
  name: "Test site",
  site: {
    name: f.text(),
    nav: f.list(f.object({ label: f.text({ default: "Link" }), href: f.url({ default: "#" }) }), {
      itemLabel: "Link",
      labelField: "label",
    }),
  },
  blocks: {
    hero: block({
      label: "Intro",
      fields: { eyebrow: f.text(), photo: f.image(), paragraphs: f.list(f.textarea(), { itemLabel: "Paragraph" }) },
    }),
    papers: block({
      label: "Papers",
      labelField: "heading",
      fields: {
        heading: f.text({ default: "Papers" }),
        items: f.list(paper, { itemLabel: "Paper", labelField: "title" }),
      },
      initial: { heading: "New section" },
    }),
  },
  pages: { home: { label: "Home", path: "/" } },
});

export const raw = {
  site: { name: "Ada", nav: [{ label: "About", href: "#about" }] },
  pages: {
    home: {
      blocks: [
        { id: "hero1", type: "hero", data: { eyebrow: "Hi", paragraphs: ["One", "Two"] } },
        {
          id: "papers1",
          type: "papers",
          data: {
            heading: "Research",
            items: [
              { status: "published", title: "First", tags: ["a", "b"], url: "https://x.org" },
              { status: "in-progress", title: "Second", tags: [], url: "" },
            ],
          },
        },
      ],
    },
  },
};
