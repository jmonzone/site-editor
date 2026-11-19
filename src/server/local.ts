import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gitBlobSha, type FileToWrite } from "./files.js";
import { describeCommit, type HistoryEntry, type RepoFile } from "./github.js";

/** Local mode for `next dev`: content lives in the working tree and history comes from local git. */

const run = promisify(execFile);
const root = () => process.cwd();

function resolveInside(file: string): string {
  const full = path.resolve(root(), file);
  if (!full.startsWith(root() + path.sep)) throw new Error(`"${file}" is outside the project.`);
  return full;
}

export async function readLocal(file: string): Promise<RepoFile | null> {
  try {
    const text = await fs.readFile(resolveInside(file), "utf8");
    return { text, sha: gitBlobSha(text) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeLocal(files: FileToWrite[]): Promise<void> {
  for (const file of files) {
    const full = resolveInside(file.path);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, file.base64 ? Buffer.from(file.content, "base64") : file.content);
  }
}

const SHA = /^[0-9a-f]{7,40}$/;

export async function localHistory(file: string, limit = 20): Promise<HistoryEntry[]> {
  try {
    const { stdout } = await run("git", ["log", `-n${limit}`, "--format=%H%x1f%an%x1f%aI%x1f%B%x1e", "--", file], { cwd: root() });
    return stdout
      .split("\x1e")
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [sha = "", author = "", date = "", message = ""] = record.split("\x1f");
        return { sha, date, ...describeCommit(message.trim(), author) };
      });
  } catch {
    return [];
  }
}

export async function localVersion(file: string, sha: string): Promise<string | null> {
  if (!SHA.test(sha)) return null;
  try {
    const { stdout } = await run("git", ["show", `${sha}:${file}`], { cwd: root(), maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}
