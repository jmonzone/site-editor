import { describe, expect, it } from "vitest";
import { aspectRatioFor, firstFontFamily } from "../src/client/canvas/svg.js";
import { readEnv, type EditorEnv } from "../src/server/env.js";
import { createEditorRoutes } from "../src/server/routes.js";
import { raw, site } from "./fixtures.js";

const post = (env: EditorEnv, body: unknown) =>
  createEditorRoutes(site, { env: () => env }).POST(
    new Request("http://localhost:3000/api/edit/capture", { method: "POST", body: JSON.stringify(body) }),
  );

describe("capture route", () => {
  const local = () => readEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
  const valid = { content: raw, page: "home", width: 1280, format: "png" };

  it("only runs under next dev", async () => {
    const env: EditorEnv = { ...local(), local: false, github: { token: "t", owner: "o", repo: "r", branch: "main" } };
    expect((await post(env, valid)).status).toBe(403);
  });

  it("validates the request", async () => {
    for (const body of [
      { ...valid, page: "nope" },
      { ...valid, width: 12 },
      { ...valid, width: 1280.5 },
      { ...valid, format: "gif" },
      { ...valid, content: "x" },
    ]) {
      expect((await post(local(), body)).status).toBe(400);
    }
  });
});

describe("firstFontFamily", () => {
  it("keeps the first family of a CSS stack, unquoted", () => {
    expect(firstFontFamily('Inter, "Inter Fallback"')).toBe("Inter");
    expect(firstFontFamily('"Source Serif 4", "Source Serif 4 Fallback"')).toBe("Source Serif 4");
    expect(firstFontFamily("Georgia")).toBe("Georgia");
  });
});

describe("aspectRatioFor", () => {
  it("draws images the way their object-fit and object-position do", () => {
    expect(aspectRatioFor("cover", "50% 50%")).toBe("xMidYMid slice");
    expect(aspectRatioFor("cover", "50% 0%")).toBe("xMidYMin slice");
    expect(aspectRatioFor("cover", "100% 100%")).toBe("xMaxYMax slice");
    expect(aspectRatioFor("cover", "0px 0px")).toBe("xMinYMin slice");
    expect(aspectRatioFor("contain", "50% 50%")).toBe("xMidYMid meet");
    expect(aspectRatioFor("fill", "50% 50%")).toBe("none");
  });
});
