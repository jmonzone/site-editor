import { createHash } from "node:crypto";
import { normalizeContent, publicUploadsPath, type RawContent, type SiteDef } from "../schema.js";

/** Turning a publish request into the files to commit. */

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const MAX_CONTENT_BYTES = 1024 * 1024;
const UPLOAD_EXTENSIONS = ["webp", "png", "jpg", "jpeg", "gif", "avif", "pdf"];

export interface FileToWrite {
  /** Repo-relative path. */
  path: string;
  /** UTF-8 text, or base64 when `base64` is set. */
  content: string;
  base64?: boolean;
}

export const serializeContent = (content: RawContent) => `${JSON.stringify(content, null, 2)}\n`;

/** The SHA git gives a file with this text, so local and GitHub content can be compared the same way. */
export function gitBlobSha(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface PublishRequest {
  content: RawContent;
  text: string;
  files: FileToWrite[];
}

/**
 * Validates a publish body: normalizes the content and keeps only uploads it references, with safe names,
 * allowed types and sizes. Throws a RequestError explaining what's wrong.
 */
export function preparePublish(site: SiteDef, body: unknown): PublishRequest {
  const input = (typeof body === "object" && body !== null ? body : {}) as { content?: unknown; uploads?: unknown };
  if (typeof input.content !== "object" || input.content === null) throw new RequestError("Missing content.");
  const content = normalizeContent(site, input.content);
  const text = serializeContent(content);
  if (Buffer.byteLength(text) > MAX_CONTENT_BYTES) throw new RequestError("The content is too large to publish.");

  const base = publicUploadsPath(site);
  const namePattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/([a-z0-9][a-z0-9._-]{0,120}\\.(${UPLOAD_EXTENSIONS.join("|")}))$`);
  const files: FileToWrite[] = [{ path: site.contentFile, content: text }];
  const seen = new Set<string>();

  for (const upload of Array.isArray(input.uploads) ? input.uploads : []) {
    const { path, data } = (upload ?? {}) as { path?: unknown; data?: unknown };
    if (typeof path !== "string" || typeof data !== "string") throw new RequestError("Malformed upload.");
    const match = namePattern.exec(path);
    if (!match) throw new RequestError(`Uploads can't be saved as "${path}".`);
    if (seen.has(path) || !text.includes(JSON.stringify(path))) continue;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new RequestError(`"${path}" isn't valid file data.`);
    if (Buffer.byteLength(data, "base64") > MAX_UPLOAD_BYTES) throw new RequestError(`"${path}" is over 3 MB.`);
    seen.add(path);
    files.push({ path: `${site.uploadsDir}/${match[1]}`, content: data, base64: true });
  }
  return { content, text, files };
}
