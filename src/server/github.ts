import type { GitHubConfig } from "./env.js";
import type { FileToWrite } from "./files.js";

/** The few GitHub REST calls the editor needs: read a file, commit files atomically, list a file's history. */

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

async function call<T>(config: GitHubConfig, path: string, init: RequestInit = {}, fetcher: Fetch = fetch): Promise<T> {
  const response = await fetcher(`https://api.github.com/repos/${config.owner}/${config.repo}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "jmonzone-site-editor",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GitHubError(`GitHub ${init.method ?? "GET"} ${path} failed: ${response.status} ${detail.slice(0, 200)}`, response.status);
  }
  return (await response.json()) as T;
}

export interface RepoFile {
  text: string;
  sha: string;
}

/** A file's text and blob SHA at a ref, or null when it doesn't exist there. */
export async function readFile(config: GitHubConfig, path: string, ref = config.branch, fetcher?: Fetch): Promise<RepoFile | null> {
  try {
    const file = await call<{ sha: string; content?: string; encoding?: string }>(
      config,
      `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
      {},
      fetcher,
    );
    // The contents API leaves files over 1 MB empty; the blobs API serves them.
    const content =
      file.encoding === "base64" && file.content
        ? file.content
        : (await call<{ content: string }>(config, `/git/blobs/${file.sha}`, {}, fetcher)).content;
    return { text: Buffer.from(content, "base64").toString("utf8"), sha: file.sha };
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

export type CommitResult = { commit: string } | { conflict: RepoFile | null };

/**
 * Commits files to the branch in one commit. When `expected` is given and that file's SHA on the branch isn't
 * `expected.sha` (null: the file mustn't exist), nothing is written and the current file is returned as a
 * conflict. A branch that moves during the commit is also a conflict, since the ref only fast-forwards.
 */
export async function commitFiles(
  config: GitHubConfig,
  options: { files: FileToWrite[]; message: string; expected?: { path: string; sha: string | null } },
  fetcher?: Fetch,
): Promise<CommitResult> {
  const ref = `/git/refs/heads/${encodePath(config.branch)}`;
  const head = (await call<{ object: { sha: string } }>(config, ref, {}, fetcher)).object.sha;

  if (options.expected) {
    const current = await readFile(config, options.expected.path, head, fetcher);
    if ((current?.sha ?? null) !== options.expected.sha) return { conflict: current };
  }

  const baseTree = (await call<{ tree: { sha: string } }>(config, `/git/commits/${head}`, {}, fetcher)).tree.sha;
  const entries = await Promise.all(
    options.files.map(async (file) => {
      if (!file.base64) return { path: file.path, mode: "100644", type: "blob", content: file.content };
      const blob = await call<{ sha: string }>(
        config,
        "/git/blobs",
        { method: "POST", body: JSON.stringify({ content: file.content, encoding: "base64" }) },
        fetcher,
      );
      return { path: file.path, mode: "100644", type: "blob", sha: blob.sha };
    }),
  );
  const tree = await call<{ sha: string }>(
    config,
    "/git/trees",
    { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree: entries }) },
    fetcher,
  );
  const commit = await call<{ sha: string }>(
    config,
    "/git/commits",
    { method: "POST", body: JSON.stringify({ message: options.message, tree: tree.sha, parents: [head] }) },
    fetcher,
  );

  try {
    await call(config, ref, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) }, fetcher);
  } catch (error) {
    // 422: the branch moved since we read it, so this commit no longer fast-forwards.
    if (error instanceof GitHubError && error.status === 422 && options.expected) {
      return { conflict: await readFile(config, options.expected.path, config.branch, fetcher) };
    }
    throw error;
  }
  return { commit: commit.sha };
}

export interface HistoryEntry {
  sha: string;
  message: string;
  date: string;
  author: string;
}

/** Who published from the editor, from the line commits made by the editor carry. */
export const EDITOR_TRAILER = "Published from the site editor by ";

export function describeCommit(message: string, fallbackAuthor: string): Pick<HistoryEntry, "message" | "author"> {
  const lines = message.split("\n");
  const trailer = lines.find((line) => line.startsWith(EDITOR_TRAILER));
  return { message: lines[0] ?? "", author: trailer ? trailer.slice(EDITOR_TRAILER.length).trim() : fallbackAuthor };
}

export async function listHistory(config: GitHubConfig, path: string, limit = 20, fetcher?: Fetch): Promise<HistoryEntry[]> {
  const commits = await call<{ sha: string; commit: { message: string; author: { name: string; date: string } } }[]>(
    config,
    `/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(config.branch)}&per_page=${limit}`,
    {},
    fetcher,
  );
  return commits.map((entry) => ({
    sha: entry.sha,
    date: entry.commit.author.date,
    ...describeCommit(entry.commit.message, entry.commit.author.name),
  }));
}
