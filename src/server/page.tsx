import { cookies } from "next/headers";
import { connection } from "next/server";
import { EditorShell } from "../client/shell/EditorShell.js";
import { SignIn } from "../client/SignIn.js";
import { normalizeContent, type RawContent, type SiteDef } from "../schema.js";
import { isAllowedEmail, readEnv, setupProblems, storageOf, type EditorEnv } from "./env.js";
import { readFile } from "./github.js";
import { readLocal } from "./local.js";
import { DEFAULT_PATHS, type EditorPaths } from "./routes.js";
import { SESSION_COOKIE, verifyToken } from "./session.js";

/** The signed-in editor, or null. Under `next dev` everyone is signed in as "local". */
export async function getEditorSession(env: EditorEnv = readEnv()): Promise<{ email: string } | null> {
  if (env.skipLogin) return { email: "local" };
  if (!env.secret) return null;
  const session = verifyToken((await cookies()).get(SESSION_COOKIE)?.value, "session", env.secret);
  return session && isAllowedEmail(env, session.email) ? session : null;
}

/** The latest content from GitHub (or the working tree locally), so edits never start from a stale build. */
export async function loadEditorContent(site: SiteDef, env: EditorEnv = readEnv()): Promise<{ content: RawContent; sha: string | null }> {
  const file = storageOf(env) === "github" ? await readFile(env.github!, site.contentFile) : await readLocal(site.contentFile);
  return { content: normalizeContent(site, file ? JSON.parse(file.text) : {}), sha: file?.sha ?? null };
}

function SetupNeeded({ siteName, problems }: { siteName: string; problems: string[] }) {
  return (
    <main className="se-signin">
      <div className="se-signin-card">
        <p className="se-eyebrow">Site editor</p>
        <h1 className="se-signin-title">{siteName}</h1>
        <p>The editor needs a few settings before it can run here. Add these environment variables and redeploy:</p>
        <ul className="se-setup">
          {problems.map((problem) => (
            <li key={problem}>
              <code>{problem.slice(0, problem.indexOf(":"))}</code>
              {problem.slice(problem.indexOf(":"))}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

/**
 * The editor page, for `app/edit/page.tsx`:
 *
 *   import "@jmonzone/site-editor/editor.css";
 *   export default createEditorPage(schema);
 */
export function createEditorPage(site: SiteDef, options: Partial<EditorPaths> = {}) {
  const paths = { ...DEFAULT_PATHS, ...options };
  return async function EditorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    // Render per request: settings, session and content must never be frozen into a build.
    await connection();
    const env = readEnv();
    const problems = setupProblems(env);
    if (problems.length > 0) return <SetupNeeded siteName={site.name} problems={problems} />;
    const session = await getEditorSession(env);
    if (!session) {
      const { error } = await searchParams;
      return <SignIn siteName={site.name} apiPath={paths.apiPath} linkExpired={error === "link"} />;
    }
    const { content, sha } = await loadEditorContent(site, env);
    return (
      <EditorShell
        site={site}
        initialContent={content}
        initialSha={sha}
        email={session.email}
        storage={storageOf(env)!}
        apiPath={paths.apiPath}
        canvasPath={`${paths.editPath}/canvas`}
        canCapture={env.local}
      />
    );
  };
}
