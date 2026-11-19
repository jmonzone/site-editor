import { afterEach, describe, expect, it, vi } from "vitest";
import { setTargetValue } from "../src/content.js";
import { editorReducer, initialState, referencedUploads } from "../src/client/shell/state.js";
import { normalizeContent } from "../src/schema.js";
import { raw, site } from "./fixtures.js";

const start = () => initialState(normalizeContent(site, raw), "sha1", "home");
const rename = (state: ReturnType<typeof start>, name: string) =>
  setTargetValue(state.draft, "home", { root: "@site", path: ["name"] }, name);

afterEach(() => vi.useRealTimers());

describe("editorReducer", () => {
  it("undoes and redoes changes", () => {
    let state = start();
    state = editorReducer(state, { type: "change", draft: rename(state, "B") });
    state = editorReducer(state, { type: "change", draft: rename(state, "C") });
    state = editorReducer(state, { type: "undo" });
    expect(state.draft.site.name).toBe("B");
    state = editorReducer(state, { type: "redo" });
    expect(state.draft.site.name).toBe("C");
    expect(editorReducer(start(), { type: "undo" })).toEqual(start());
  });

  it("treats quick typing in one field as one undo step", () => {
    vi.useFakeTimers();
    let state = start();
    for (const name of ["G", "Gr", "Gra"]) {
      state = editorReducer(state, { type: "change", draft: rename(state, name), coalesceKey: "@site:name" });
      vi.advanceTimersByTime(300);
    }
    expect(state.past).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    state = editorReducer(state, { type: "change", draft: rename(state, "Grace"), coalesceKey: "@site:name" });
    expect(state.past).toHaveLength(2);
    expect(editorReducer(state, { type: "undo" }).draft.site.name).toBe("Gra");
  });

  it("drops a selection whose element was deleted", () => {
    let state = editorReducer(start(), { type: "select", target: { root: "hero1", path: [] } });
    const blocks = state.draft.pages.home!.blocks.filter((entry) => entry.id !== "hero1");
    state = editorReducer(state, { type: "change", draft: { ...state.draft, pages: { home: { blocks } } } });
    expect(state.selection).toBeNull();
  });

  it("keeps edits made while a publish was in flight", () => {
    let state = editorReducer(start(), { type: "change", draft: rename(start(), "Sent") });
    const sent = state.draft;
    state = editorReducer(state, { type: "change", draft: rename(state, "Later") });
    state = editorReducer(state, { type: "published", sha: "sha2", content: sent, sent });
    expect(state.baseSha).toBe("sha2");
    expect(state.published).toBe(sent);
    expect(state.draft.site.name).toBe("Later");
  });

  it("replaces the draft after a clean publish", () => {
    let state = editorReducer(start(), { type: "change", draft: rename(start(), "Sent"), upload: { path: "/uploads/a.png", dataUrl: "data:image/png;base64,QQ==" } });
    const published = normalizeContent(site, state.draft);
    state = editorReducer(state, { type: "published", sha: "sha2", content: published, sent: state.draft });
    expect(state.draft).toBe(published);
    expect(state.uploads).toEqual({});
  });

  it("can load the latest version with the old draft on the undo stack", () => {
    let state = editorReducer(start(), { type: "change", draft: rename(start(), "Mine") });
    const theirs = rename(start(), "Theirs");
    state = editorReducer(state, { type: "rebase", sha: "sha3", content: theirs, keepDraft: false });
    expect(state.draft.site.name).toBe("Theirs");
    expect(editorReducer(state, { type: "undo" }).draft.site.name).toBe("Mine");
  });
});

describe("referencedUploads", () => {
  it("sends only uploads the draft still uses, as base64", () => {
    const draft = setTargetValue(start().draft, "home", { root: "hero1", path: ["photo", "src"] }, "/uploads/a.png");
    expect(
      referencedUploads(draft, {
        "/uploads/a.png": { path: "/uploads/a.png", dataUrl: "data:image/png;base64,QUJD" },
        "/uploads/b.png": { path: "/uploads/b.png", dataUrl: "data:image/png;base64,REVG" },
      }),
    ).toEqual([{ path: "/uploads/a.png", data: "QUJD" }]);
  });
});
