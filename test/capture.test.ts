import { describe, expect, it } from "vitest";
import { firstFontFamily, placeImage } from "../src/client/canvas/svg.js";
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

describe("placeImage", () => {
  // A nearly square photo in a 4:5 frame, like a portrait in a hero.
  const photo = { width: 2000, height: 2000 };
  const frame = { width: 200, height: 250 };

  it("covers the frame, cropping the sides around the object-position", () => {
    expect(placeImage("cover", "50% 50%", photo, frame)).toEqual({ x: -25, y: 0, width: 250, height: 250 });
    expect(placeImage("cover", "0% 50%", photo, frame)).toEqual({ x: 0, y: 0, width: 250, height: 250 });
    expect(placeImage("cover", "100% 50%", photo, frame)).toEqual({ x: -50, y: 0, width: 250, height: 250 });
    expect(placeImage("cover", "-10px 0px", photo, frame)).toEqual({ x: -10, y: 0, width: 250, height: 250 });
  });

  it("fits the whole image for contain and scale-down", () => {
    expect(placeImage("contain", "50% 50%", photo, frame)).toEqual({ x: 0, y: 25, width: 200, height: 200 });
    expect(placeImage("scale-down", "50% 50%", { width: 100, height: 100 }, frame)).toEqual({ x: 50, y: 75, width: 100, height: 100 });
  });

  it("stretches for fill and keeps natural size for none", () => {
    expect(placeImage("fill", "50% 50%", photo, frame)).toEqual({ x: 0, y: 0, width: 200, height: 250 });
    expect(placeImage("none", "50% 50%", { width: 100, height: 100 }, frame)).toEqual({ x: 50, y: 75, width: 100, height: 100 });
  });
});
