import { isRecord, normalizeContent, type RawContent, type SiteDef } from "../schema.js";
import { capturePage, CaptureError } from "./capture.js";
import { sendSignInLink } from "./email.js";
import { isAllowedEmail, readEnv, storageOf, type EditorEnv } from "./env.js";
import { gitBlobSha, preparePublish, RequestError } from "./files.js";
import { commitFiles, EDITOR_TRAILER, listHistory, readFile, type RepoFile } from "./github.js";
import { localHistory, localVersion, readLocal, writeLocal } from "./local.js";
import {
  createToken,
  LOGIN_TTL_SECONDS,
  readCookie,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookie,
  verifyToken,
} from "./session.js";

export interface EditorPaths {
  /** Where the site mounts `createEditorRoutes`, as `app/<apiPath>/[...action]/route.ts`. */
  apiPath: string;
  /** Where the site mounts `createEditorPage`; the canvas lives at `<editPath>/canvas`. */
  editPath: string;
}

export const DEFAULT_PATHS: EditorPaths = { apiPath: "/api/edit", editPath: "/edit" };

type Session = { email: string };
type Handler = (request: Request, env: EditorEnv, session: Session) => Promise<Response>;

const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers });
const fail = (message: string, status: number) => json({ error: message }, status);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function sessionFromRequest(request: Request, env: EditorEnv): Session | null {
  if (env.skipLogin) return { email: "local" };
  if (!env.secret) return null;
  const session = verifyToken(readCookie(request.headers.get("cookie"), SESSION_COOKIE), "session", env.secret);
  return session && isAllowedEmail(env, session.email) ? session : null;
}

/** Rejects cross-site posts. The session cookie is SameSite=Lax too; this is the second lock. */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return [request.headers.get("host"), request.headers.get("x-forwarded-host"), new URL(request.url).host].includes(host);
  } catch {
    return false;
  }
}

/**
 * The editor's API, for `app/api/edit/[...action]/route.ts`:
 *
 *   const routes = createEditorRoutes(schema);
 *   export const GET = routes.GET;
 *   export const POST = routes.POST;
 */
export function createEditorRoutes(site: SiteDef, options: Partial<EditorPaths> & { env?: () => EditorEnv } = {}) {
  const paths = { ...DEFAULT_PATHS, ...options };
  const getEnv = options.env ?? (() => readEnv());
  const loginAttempts = new Map<string, number[]>();

  /** At most 5 sign-in emails per address per 15 minutes, per server instance. */
  function rateLimited(email: string): boolean {
    const now = Date.now();
    const recent = (loginAttempts.get(email) ?? []).filter((time) => now - time < 15 * 60 * 1000);
    recent.push(now);
    loginAttempts.set(email, recent);
    return recent.length > 5;
  }

  async function readCurrent(env: EditorEnv, ref?: string): Promise<RepoFile | null> {
    return storageOf(env) === "github" ? readFile(env.github!, site.contentFile, ref) : readLocal(site.contentFile);
  }

  const contentOf = (file: RepoFile | null) => normalizeContent(site, file ? JSON.parse(file.text) : {});

  const conflict = (file: RepoFile | null) =>
    json({ error: "The site changed since you opened the editor.", sha: file?.sha ?? null, content: contentOf(file) }, 409);

  const publicHandlers: Record<string, (request: Request, env: EditorEnv) => Promise<Response>> = {
    "POST login": async (request, env) => {
      const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!EMAIL.test(email)) return fail("Enter a valid email address.", 400);
      if (!env.secret) return fail("Sign-in isn't set up on this site yet.", 500);
      if (rateLimited(email)) return fail("Too many sign-in requests. Try again in a few minutes.", 429);
      // Unknown emails get the same answer, so the form doesn't reveal who can edit.
      if (isAllowedEmail(env, email)) {
        const token = createToken("login", email, env.secret, LOGIN_TTL_SECONDS);
        const base = (env.local ? null : env.siteUrl) ?? new URL(request.url).origin;
        const url = `${base.replace(/\/+$/, "")}${paths.apiPath}/verify?token=${token}`;
        if (env.resend) await sendSignInLink({ resend: env.resend, to: email, url, siteName: site.name });
        else if (env.local) console.info(`[site-editor] Sign-in link for ${email}:\n${url}`);
        else return fail("Sign-in emails aren't set up on this site yet.", 500);
      }
      return json({ ok: true });
    },

    "GET verify": async (request, env) => {
      const token = new URL(request.url).searchParams.get("token");
      const login = env.secret ? verifyToken(token, "login", env.secret) : null;
      if (!login || !isAllowedEmail(env, login.email)) {
        return new Response(null, { status: 303, headers: { Location: `${paths.editPath}?error=link` } });
      }
      const session = createToken("session", login.email, env.secret!, SESSION_TTL_SECONDS);
      return new Response(null, {
        status: 303,
        headers: { Location: paths.editPath, "Set-Cookie": sessionCookie(session, !env.local) },
      });
    },

    "POST logout": async (_request, env) => json({ ok: true }, 200, { "Set-Cookie": sessionCookie(null, !env.local) }),
  };

  const privateHandlers: Record<string, Handler> = {
    "POST publish": async (request, env, session) => {
      const body = (await request.json().catch(() => null)) as { baseSha?: unknown } | null;
      const prepared = preparePublish(site, body);
      const baseSha = typeof body?.baseSha === "string" ? body.baseSha : null;
      const message = `Update site content\n\n${EDITOR_TRAILER}${session.email}`;

      if (storageOf(env) === "github") {
        const result = await commitFiles(env.github!, {
          files: prepared.files,
          message,
          expected: { path: site.contentFile, sha: baseSha },
        });
        if ("conflict" in result) return conflict(result.conflict);
        return json({ sha: gitBlobSha(prepared.text), commit: result.commit, content: prepared.content });
      }

      const current = await readLocal(site.contentFile);
      if ((current?.sha ?? null) !== baseSha) return conflict(current);
      await writeLocal(prepared.files);
      return json({ sha: gitBlobSha(prepared.text), commit: null, content: prepared.content });
    },

    "GET latest": async (_request, env) => {
      const file = await readCurrent(env);
      return json({ sha: file?.sha ?? null, content: contentOf(file) });
    },

    "GET history": async (_request, env) =>
      json({
        entries: storageOf(env) === "github" ? await listHistory(env.github!, site.contentFile) : await localHistory(site.contentFile),
      }),

    "GET version": async (request, env) => {
      const sha = new URL(request.url).searchParams.get("sha") ?? "";
      if (!/^[0-9a-f]{7,40}$/.test(sha)) return fail("Unknown version.", 400);
      const text = storageOf(env) === "github" ? (await readFile(env.github!, site.contentFile, sha))?.text : await localVersion(site.contentFile, sha);
      return text ? json({ content: normalizeContent(site, JSON.parse(text)) }) : fail("That version has no content file.", 404);
    },

    "GET status": async (_request, env) => json({ storage: storageOf(env), deployedSha: env.deployedSha }),

    "POST capture": async (request, env) => {
      if (!env.local) return fail("Capturing for Figma only runs under `next dev`.", 403);
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const { content, page, width, format } = body ?? {};
      if (!isRecord(content) || typeof page !== "string" || !site.pages[page]) return fail("Missing content or page.", 400);
      if (typeof width !== "number" || !Number.isInteger(width) || width < 240 || width > 3840) return fail("Unsupported width.", 400);
      if (format !== "png" && format !== "svg") return fail("Unsupported format.", 400);
      try {
        // Not normalized: the draft may hold data URLs for images that aren't uploaded yet.
        const captured = await capturePage({
          origin: new URL(request.url).origin,
          canvasPath: `${paths.editPath}/canvas`,
          content: content as unknown as RawContent,
          page,
          width,
          format,
        });
        return new Response(captured.body as BodyInit, { headers: { "Content-Type": captured.type, "Cache-Control": "no-store" } });
      } catch (error) {
        if (error instanceof CaptureError) return fail(error.message, 500);
        throw error;
      }
    },
  };

  async function handle(method: "GET" | "POST", request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const action = pathname.startsWith(`${paths.apiPath}/`) ? pathname.slice(paths.apiPath.length + 1) : "";
    const key = `${method} ${action}`;
    const env = getEnv();
    if (method === "POST" && !isSameOrigin(request)) return fail("Cross-site request refused.", 403);

    let signedIn = false;
    try {
      const publicHandler = publicHandlers[key];
      if (publicHandler) return await publicHandler(request, env);
      const handler = privateHandlers[key];
      if (!handler) return fail("Not found.", 404);
      if (!storageOf(env)) return fail("The editor isn't set up on this site yet.", 500);
      const session = sessionFromRequest(request, env);
      if (!session) return fail("Your session ended. Sign in again.", 401);
      signedIn = true;
      return await handler(request, env, session);
    } catch (error) {
      if (error instanceof RequestError) return fail(error.message, error.status);
      console.error(`[site-editor] ${key} failed`, error);
      // Details only go to signed-in editors; they can include GitHub's error text.
      return fail(signedIn && error instanceof Error ? error.message : "Something went wrong.", 500);
    }
  }

  return {
    GET: (request: Request) => handle("GET", request),
    POST: (request: Request) => handle("POST", request),
  };
}
