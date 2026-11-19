import type { Upload } from "./state.js";

/** Preparing picked files for publishing: images are resized and re-encoded in the browser first. */

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2000;
const IMAGE_QUALITY = 0.85;

const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/avif": "avif",
  "application/pdf": "pdf",
};

function slug(name: string): string {
  const base = name.replace(/\.[^.]*$/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
}

const suffix = () => Math.random().toString(36).slice(2, 7);

const toBlob = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, IMAGE_QUALITY));

const readDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file."));
    reader.readAsDataURL(blob);
  });

/** Shrinks an image to at most 2000px a side and re-encodes it as WebP, falling back to PNG or JPEG. */
async function shrinkImage(file: File): Promise<Blob> {
  // Animated GIFs would lose their animation.
  if (file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const webp = await toBlob(canvas, "image/webp");
  if (webp?.type === "image/webp") return webp;
  const fallback = await toBlob(canvas, file.type === "image/png" ? "image/png" : "image/jpeg");
  if (!fallback) throw new Error("Couldn't process that image.");
  return fallback;
}

/** Turns a picked file into an upload under `publicDir` (e.g. "/uploads"), or throws a message for the user. */
export async function prepareUpload(file: File, kind: "image" | "file", publicDir: string): Promise<Upload> {
  if (kind === "image") {
    if (file.type === "image/svg+xml") throw new Error("SVG images aren't supported. Use PNG, JPG or WebP.");
    if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  }
  const blob = kind === "image" ? await shrinkImage(file) : file;
  const extension = EXTENSIONS[blob.type];
  if (!extension) throw new Error("That type of file isn't supported. Use an image or a PDF.");
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(`That file is ${(blob.size / 1024 / 1024).toFixed(1)} MB. Files must be under 3 MB.`);
  }
  return { path: `${publicDir}/${slug(file.name)}-${suffix()}.${extension}`, dataUrl: await readDataUrl(blob) };
}
