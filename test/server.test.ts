import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readEnv, setupProblems, type EditorEnv } from "../src/server/env.js";
import { gitBlobSha, preparePublish, RequestError, serializeContent } from "../src/server/files.js";
import { commitFiles, describeCommit, readFile } from "../src/server/github.js";
import { createEditorRoutes } from "../src/server/routes.js";
import { createToken, readCookie, verifyToken } from "../src/server/session.js";
import { normalizeContent } from "../src/schema.js";
import { raw, site } from "./fixtures.js";

const SECRET = "x".repeat(40);

describe("tokens", () => {
  it("round-trips and lowercases the email", () => {
    const token = createToken("session", "Ada@Example.com", SECRET, 60);
    expect(verifyToken(token, "session", SECRET)).toEqual({ email: "ada@example.com" });
  });

  it("rejects other purposes, secrets, tampering and expiry", () => {
    const token = createToken("login", "ada@example.com", SECRET, 60, 1_000_000);
    expect(verifyToken(token, "session", SECRET, 1_000_000)).toBeNull();
    expect(verifyToken(token, "login", "y".repeat(40), 1_000_000)).toBeNull();
    const [body, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ p: "login", e: "eve@example.com", x: 9e12 })).toString("base64url");
    expect(verifyToken(`${forged}.${signature}`, "login", SECRET, 1_000_000)).toBeNull();
    expect(verifyToken(`${body}.${signature}`, "login", SECRET, 1_000_000 + 61_000)).toBeNull();
    expect(verifyToken("garbage", "login", SECRET)).toBeNull();
  });

  it("reads cookies", () => {
    expect(readCookie("a=1; se_session=abc.def==; b=2", "se_session")).toBe("abc.def==");
    expect(readCookie(null, "se_session")).toBeNull();
  });
});

describe("env", () => {
  it("needs GitHub and sign-in settings in production", () => {
    const env = readEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(setupProblems(env).join(" ")).toMatch(/EDITOR_GITHUB_TOKEN.*EDITOR_SECRET.*EDITOR_EMAILS.*RESEND_API_KEY/);
  });

  it("is ready locally with nothing set", () => {
    expect(setupProblems(readEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv))).toEqual([]);
  });

  it("takes the repo from Vercel's variables", () => {
    const env = readEnv({
      NODE_ENV: "production",
      EDITOR_GITHUB_TOKEN: "t",
      VERCEL_GIT_REPO_OWNER: "jmonzone",
      VERCEL_GIT_REPO_SLUG: "site",
      EDITOR_EMAILS: " Ada@x.org, b@y.org ",
    } as NodeJS.ProcessEnv);
    expect(env.github).toEqual({ token: "t", owner: "jmonzone", repo: "site", branch: "main" });
    expect(env.emails).toEqual(["ada@x.org", "b@y.org"]);
  });
});

describe("preparePublish", () => {
  const content = normalizeContent(site, raw);
  const withPhoto = (src: string) => ({
    ...content,
    pages: {
      home: {
        blocks: content.pages.home!.blocks.map((entry) =>
          entry.type === "hero" ? { ...entry, data: { ...entry.data, photo: { src, alt: "Ada" } } } : entry,
        ),
      },
    },
  });
  const png = Buffer.from("png-bytes").toString("base64");

  it("serializes content and keeps referenced uploads", () => {
    const prepared = preparePublish(site, {
      content: withPhoto("/uploads/ada-12ab.webp"),
      uploads: [
        { path: "/uploads/ada-12ab.webp", data: png },
        { path: "/uploads/unused-99.webp", data: png },
      ],
    });
    expect(prepared.files.map((file) => file.path)).toEqual(["content.json", "public/uploads/ada-12ab.webp"]);
    expect(prepared.text).toBe(serializeContent(prepared.content));
  });

  it("refuses unsafe names and types", () => {
    for (const bad of ["/uploads/../x.webp", "/elsewhere/x.webp", "/uploads/x.svg", "/uploads/X.webp", "/uploads/x.html"]) {
      expect(() => preparePublish(site, { content: withPhoto(bad), uploads: [{ path: bad, data: png }] })).toThrow(RequestError);
    }
  });

  it("refuses oversized uploads", () => {
    const big = Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64");
    expect(() =>
      preparePublish(site, { content: withPhoto("/uploads/big.png"), uploads: [{ path: "/uploads/big.png", data: big }] }),
    ).toThrow(/over 3 MB/);
  });
});

describe("gitBlobSha", () => {
  it("matches git hash-object", () => {
    const text = '{\n  "a": "é"\n}\n';
    const dir = mkdtempSync(path.join(tmpdir(), "se-sha-"));
    writeFileSync(path.join(dir, "f.json"), text);
    expect(gitBlobSha(text)).toBe(execFileSync("git", ["hash-object", path.join(dir, "f.json")]).toString().trim());
  });
});

describe("GitHub", () => {
  const config = { token: "t", owner: "o", repo: "r", branch: "main" };
  const file = (text: string) => ({ sha: gitBlobSha(text), content: Buffer.from(text).toString("base64"), encoding: "base64" });

  /** A fake GitHub API: routes "METHOD /path" to handlers and records every call. */
  function fakeGitHub(routes: Record<string, (body: unknown) => [number, unknown]>) {
    const calls: { key: string; body: unknown }[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${String(url).replace("https://api.github.com/repos/o/r", "")}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ key, body });
      const route = routes[key];
      if (!route) return new Response("missing", { status: 404 });
      const [status, payload] = route(body);
      return Response.json(payload, { status });
    });
    return { calls, fetcher: fetcher as unknown as typeof fetch };
  }

  const base = {
    "GET /git/refs/heads/main": () => [200, { object: { sha: "head1" } }] as [number, unknown],
    "GET /contents/content.json?ref=head1": () => [200, file("old\n")] as [number, unknown],
    "GET /git/commits/head1": () => [200, { tree: { sha: "tree1" } }] as [number, unknown],
    "POST /git/blobs": () => [201, { sha: "blob1" }] as [number, unknown],
    "POST /git/trees": () => [201, { sha: "tree2" }] as [number, unknown],
    "POST /git/commits": () => [201, { sha: "commit2" }] as [number, unknown],
    "PATCH /git/refs/heads/main": () => [200, {}] as [number, unknown],
  };

  it("commits text and uploads in one fast-forward commit", async () => {
    const { calls, fetcher } = fakeGitHub(base);
    const result = await commitFiles(
      config,
      {
        files: [
          { path: "content.json", content: "new\n" },
          { path: "public/uploads/a.png", content: "cG5n", base64: true },
        ],
        message: "Update",
        expected: { path: "content.json", sha: gitBlobSha("old\n") },
      },
      fetcher,
    );
    expect(result).toEqual({ commit: "commit2" });
    const tree = calls.find((call) => call.key === "POST /git/trees")!.body;
    expect(tree).toEqual({
      base_tree: "tree1",
      tree: [
        { path: "content.json", mode: "100644", type: "blob", content: "new\n" },
        { path: "public/uploads/a.png", mode: "100644", type: "blob", sha: "blob1" },
      ],
    });
    expect(calls.find((call) => call.key === "POST /git/commits")!.body).toEqual({ message: "Update", tree: "tree2", parents: ["head1"] });
    expect(calls.find((call) => call.key === "PATCH /git/refs/heads/main")!.body).toEqual({ sha: "commit2", force: false });
  });

  it("writes nothing when the file changed since the editor loaded it", async () => {
    const { calls, fetcher } = fakeGitHub(base);
    const result = await commitFiles(
      config,
      { files: [{ path: "content.json", content: "new\n" }], message: "m", expected: { path: "content.json", sha: "stale" } },
      fetcher,
    );
    expect(result).toEqual({ conflict: { text: "old\n", sha: gitBlobSha("old\n") } });
    expect(calls.some((call) => call.key.startsWith("POST"))).toBe(false);
  });

  it("reports a conflict when the branch moves mid-commit", async () => {
    const { fetcher } = fakeGitHub({
      ...base,
      "PATCH /git/refs/heads/main": () => [422, { message: "Update is not a fast forward" }],
      "GET /contents/content.json?ref=main": () => [200, file("newer\n")],
    });
    const result = await commitFiles(
      config,
      { files: [{ path: "content.json", content: "new\n" }], message: "m", expected: { path: "content.json", sha: gitBlobSha("old\n") } },
      fetcher,
    );
    expect(result).toEqual({ conflict: { text: "newer\n", sha: gitBlobSha("newer\n") } });
  });

  it("reads missing files as null", async () => {
    const { fetcher } = fakeGitHub({});
    expect(await readFile(config, "content.json", "main", fetcher)).toBeNull();
  });

  it("names the editor who published", () => {
    expect(describeCommit("Update site content\n\nPublished from the site editor by ada@x.org", "Jonan")).toEqual({
      message: "Update site content",
      author: "ada@x.org",
    });
    expect(describeCommit("Fix typo", "Jonan")).toEqual({ message: "Fix typo", author: "Jonan" });
  });
});

describe("routes in local mode", () => {
  let dir: string;
  let cwd: string;
  const env = (overrides: Partial<EditorEnv> = {}): EditorEnv => ({
    ...readEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv),
    ...overrides,
  });
  const request = (method: string, action: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Request(`http://localhost:3000/api/edit/${action}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(() => {
    cwd = process.cwd();
    dir = mkdtempSync(path.join(tmpdir(), "se-site-"));
    writeFileSync(path.join(dir, "content.json"), serializeContent(normalizeContent(site, raw)));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", "add", "."], { cwd: dir });
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "init"], { cwd: dir });
    process.chdir(dir);
  });
  afterAll(() => process.chdir(cwd));

  it("publishes to the working tree and refuses stale bases", async () => {
    const routes = createEditorRoutes(site, { env: () => env() });
    const latest = await (await routes.GET(request("GET", "latest"))).json();
    expect(latest.sha).toBe(gitBlobSha(readFileSync("content.json", "utf8")));

    const content = { ...latest.content, site: { ...latest.content.site, name: "Grace" } };
    const png = Buffer.from("img").toString("base64");
    const hero = content.pages.home.blocks[0];
    hero.data.photo = { src: "/uploads/g-1.png", alt: "Grace" };
    const published = await routes.POST(
      request("POST", "publish", { content, baseSha: latest.sha, uploads: [{ path: "/uploads/g-1.png", data: png }] }),
    );
    expect(published.status).toBe(200);
    const result = await published.json();
    expect(JSON.parse(readFileSync("content.json", "utf8")).site.name).toBe("Grace");
    expect(result.sha).toBe(gitBlobSha(readFileSync("content.json", "utf8")));
    expect(existsSync("public/uploads/g-1.png")).toBe(true);

    const stale = await routes.POST(request("POST", "publish", { content, baseSha: latest.sha, uploads: [] }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).sha).toBe(result.sha);
  });

  it("lists history and reads old versions", async () => {
    const routes = createEditorRoutes(site, { env: () => env() });
    const { entries } = await (await routes.GET(request("GET", "history"))).json();
    expect(entries[0].message).toBe("init");
    const version = await (await routes.GET(request("GET", `version?sha=${entries[0].sha}`))).json();
    expect(version.content.site.name).toBe("Ada");
  });

  it("refuses cross-site posts", async () => {
    const routes = createEditorRoutes(site, { env: () => env() });
    const response = await routes.POST(request("POST", "publish", {}, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
  });
});

describe("sign-in", () => {
  const env = (): EditorEnv => ({
    ...readEnv({ NODE_ENV: "production", EDITOR_GITHUB_TOKEN: "t", EDITOR_GITHUB_REPO: "o/r" } as NodeJS.ProcessEnv),
    secret: SECRET,
    emails: ["ada@x.org"],
    resend: { key: "k", from: "Editor <e@x.org>" },
    siteUrl: "https://site.example",
  });

  it("emails allowed addresses a link that signs them in", async () => {
    const sent: { to: string[]; text: string }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "1" });
    }) as unknown as typeof fetch;
    try {
      const routes = createEditorRoutes(site, { env });
      const post = (email: string) =>
        routes.POST(new Request("https://site.example/api/edit/login", { method: "POST", body: JSON.stringify({ email }) }));
      expect((await post("nobody@x.org")).status).toBe(200);
      expect(sent).toHaveLength(0);
      expect((await post("Ada@x.org")).status).toBe(200);
      expect(sent).toHaveLength(1);

      const link = /https:\/\/site\.example\/api\/edit\/verify\?token=\S+/.exec(sent[0]!.text)![0];
      const verified = await routes.GET(new Request(link));
      expect(verified.status).toBe(303);
      expect(verified.headers.get("location")).toBe("/edit");
      const cookie = verified.headers.get("set-cookie")!;
      expect(cookie).toMatch(/^se_session=.+HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);

      const token = cookie.split(";")[0]!.split("=").slice(1).join("=");
      expect(verifyToken(token, "session", SECRET)).toEqual({ email: "ada@x.org" });
      expect(verifyToken(new URL(link).searchParams.get("token"), "session", SECRET)).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("sends bad links back to the sign-in page", async () => {
    const routes = createEditorRoutes(site, { env });
    const response = await routes.GET(new Request("https://site.example/api/edit/verify?token=nope"));
    expect(response.headers.get("location")).toBe("/edit?error=link");
  });

  it("guards private routes", async () => {
    const routes = createEditorRoutes(site, { env });
    expect((await routes.GET(new Request("https://site.example/api/edit/latest"))).status).toBe(401);
    expect((await routes.GET(new Request("https://site.example/api/edit/nope"))).status).toBe(404);
  });
});
