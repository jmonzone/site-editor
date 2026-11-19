import type { Browser } from "playwright-core";
import type {} from "../protocol.js";
import type { RawContent } from "../schema.js";

/**
 * Captures a draft page for Figma with a headless Chromium on this machine: a full-page PNG at 2x, or SVG that
 * Figma turns into layers. Local only (`next dev`), using the site's `playwright-core` dev dependency.
 */

export type CaptureFormat = "png" | "svg";

export class CaptureError extends Error {}

const PLAYWRIGHT = "playwright-core";
const IDLE_MS = 2 * 60 * 1000;
const MAX_HEIGHT = 16000;

let browser: Promise<Browser> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** One browser serves every capture, closing after two idle minutes. */
async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = (async () => {
      let playwright: typeof import("playwright-core");
      try {
        // Not bundled: it's only on developers' machines, and only loaded when a capture is asked for.
        playwright = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ PLAYWRIGHT);
      } catch {
        throw new CaptureError("Capturing needs playwright-core: run `npm install -D playwright-core` in this site.");
      }
      try {
        return await playwright.chromium.launch();
      } catch (error) {
        throw new CaptureError(`Couldn't start Chromium. Run \`npx playwright install chromium\`. (${(error as Error).message.split("\n")[0]})`);
      }
    })();
    browser.catch(() => {
      browser = null;
    });
  }
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void browser?.then((instance) => instance.close()).catch(() => undefined);
    browser = null;
  }, IDLE_MS);
  return browser;
}

/** Runs in the page: drop dev overlays, load lazy images, and wait for fonts, images and a painted frame. */
async function settle() {
  for (const element of document.querySelectorAll("nextjs-portal")) element.remove();
  for (const image of document.images) if (image.loading === "lazy") image.loading = "eager";
  await document.fonts.ready;
  await Promise.all(
    [...document.images].map((image) =>
      image.complete ? undefined : new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      }),
    ),
  );
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export interface CaptureOptions {
  /** Origin of the running site, e.g. http://localhost:8002. */
  origin: string;
  canvasPath: string;
  content: RawContent;
  page: string;
  width: number;
  format: CaptureFormat;
}

export async function capturePage(options: CaptureOptions): Promise<{ body: Uint8Array | string; type: string }> {
  const instance = await getBrowser();
  const context = await instance.newContext({
    viewport: { width: options.width, height: 900 },
    deviceScaleFactor: options.format === "png" ? 2 : 1,
  });
  try {
    const tab = await context.newPage();
    await tab.goto(`${options.origin}${options.canvasPath}?capture`, { waitUntil: "load" });
    await tab.waitForFunction(() => !!window.__siteEditorCapture, null, { timeout: 30_000 });
    await tab.evaluate(([content, page]) => window.__siteEditorCapture!.render(content, page), [options.content, options.page] as const);
    await tab.evaluate(settle);
    // Make the viewport as tall as the page, so everything lays out and loads as if on screen.
    const height = await tab.evaluate(() => document.documentElement.scrollHeight);
    await tab.setViewportSize({ width: options.width, height: Math.min(height, MAX_HEIGHT) });
    await tab.evaluate(settle);

    if (options.format === "svg") {
      return { body: await tab.evaluate(() => window.__siteEditorCapture!.svg()), type: "image/svg+xml" };
    }
    return { body: await tab.screenshot({ fullPage: true, type: "png", animations: "disabled" }), type: "image/png" };
  } finally {
    await context.close();
  }
}
