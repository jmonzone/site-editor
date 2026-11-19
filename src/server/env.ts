/** Editor configuration, all from environment variables so each site sets them in Vercel. */

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

export interface EditorEnv {
  /** Running under `next dev`: without GitHub settings, content is read from and written to the working tree. */
  local: boolean;
  /** Local and EDITOR_REQUIRE_LOGIN isn't "1": the editor opens without signing in. */
  skipLogin: boolean;
  secret: string | null;
  /** Lowercased emails allowed to sign in. */
  emails: string[];
  github: GitHubConfig | null;
  resend: { key: string; from: string } | null;
  /** Base URL for sign-in links, so they never depend on the request's Host header. */
  siteUrl: string | null;
  /** The commit the running deployment was built from, to tell when a publish is live. */
  deployedSha: string | null;
}

export type Storage = "github" | "local";

const value = (raw: string | undefined) => (raw && raw.trim() ? raw.trim() : null);

export function readEnv(env: NodeJS.ProcessEnv = process.env): EditorEnv {
  const local = env.NODE_ENV === "development";
  const token = value(env.EDITOR_GITHUB_TOKEN) ?? value(env.GITHUB_TOKEN);
  const repoName =
    value(env.EDITOR_GITHUB_REPO) ??
    (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}` : null);
  const [owner, repo] = repoName?.split("/") ?? [];
  const resendKey = value(env.RESEND_API_KEY);
  const from = value(env.EDITOR_EMAIL_FROM);
  const productionUrl = value(env.VERCEL_PROJECT_PRODUCTION_URL);

  return {
    local,
    skipLogin: local && env.EDITOR_REQUIRE_LOGIN !== "1",
    secret: value(env.EDITOR_SECRET),
    emails: (env.EDITOR_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    github:
      token && owner && repo ? { token, owner, repo, branch: value(env.EDITOR_GITHUB_BRANCH) ?? "main" } : null,
    resend: resendKey && from ? { key: resendKey, from } : null,
    siteUrl:
      value(env.EDITOR_SITE_URL) ??
      value(env.NEXT_PUBLIC_SITE_URL) ??
      (productionUrl ? `https://${productionUrl}` : null),
    deployedSha: value(env.VERCEL_GIT_COMMIT_SHA),
  };
}

/** Where content is read from and published to. GitHub wins when configured, even in dev. */
export const storageOf = (env: EditorEnv): Storage | null => (env.github ? "github" : env.local ? "local" : null);

/** What's missing before the editor can run here, as messages naming the variables to set. */
export function setupProblems(env: EditorEnv): string[] {
  const problems: string[] = [];
  if (!storageOf(env)) {
    problems.push("EDITOR_GITHUB_TOKEN: a GitHub token that can write this repo's contents, so publishing can commit.");
    if (!env.github) problems.push("EDITOR_GITHUB_REPO: the repo as owner/name (Vercel provides it when its Git integration is on).");
  }
  if (!env.skipLogin) {
    if (!env.secret || env.secret.length < 32) problems.push("EDITOR_SECRET: at least 32 random characters, to sign sign-in links and sessions.");
    if (env.emails.length === 0) problems.push("EDITOR_EMAILS: comma-separated emails allowed to edit.");
    // Locally the link is printed to the terminal instead.
    if (!env.resend && !env.local) problems.push("RESEND_API_KEY and EDITOR_EMAIL_FROM: to send sign-in links.");
  }
  return problems;
}

export const isAllowedEmail = (env: EditorEnv, email: string) => env.emails.includes(email.trim().toLowerCase());
