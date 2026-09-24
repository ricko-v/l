import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { directoryAt, readTextFile, validateEntryPath, type Manifest } from "./files.js";
import { isFunctionName } from "../config/project.js";

export interface SyncEntry {
  arn: string;
  revisionId: string;
  codeSha256: string;
  files: Manifest;
}
export interface SyncState { version: 1; functions: Record<string, SyncEntry> }

export async function readState(root: string): Promise<SyncState> {
  if (!await directoryAt(root, ".l")) return { version: 1, functions: {} };
  const text = await readTextFile(path.join(root, ".l/state.json"));
  if (text === null) return { version: 1, functions: {} };
  try {
    const state = JSON.parse(text);
    if (state?.version !== 1 || !state.functions || typeof state.functions !== "object" || Array.isArray(state.functions)) throw new Error();
    for (const [name, value] of Object.entries(state.functions)) {
      const entry = value as SyncEntry;
      if (!isFunctionName(name) || !entry || !entry.arn?.startsWith("arn:") || typeof entry.revisionId !== "string"
        || !entry.revisionId || typeof entry.codeSha256 !== "string" || !entry.codeSha256
        || !entry.files || typeof entry.files !== "object" || Array.isArray(entry.files)) throw new Error();
      for (const [file, hash] of Object.entries(entry.files)) {
        validateEntryPath(file);
        if (typeof hash !== "string" || !/^[A-Za-z0-9+/]{43}=:(420|493)$/.test(hash)) throw new Error();
      }
    }
    return state;
  } catch {
    throw new Error("Invalid .l/state.json. Restore its backup before syncing; do not discard revision history to bypass a conflict.");
  }
}

export async function atomicText(file: string, text: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

export async function saveState(root: string, state: SyncState) {
  await atomicText(path.join(root, ".l/state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

export async function acquireLock(root: string) {
  await directoryAt(root, ".l", true);
  const lock = path.join(root, ".l/sync.lock");
  let handle;
  try { handle = await fs.open(lock, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Another sync may be running. Check .l/sync.lock; remove a stale lock only after confirming its process has stopped.");
    }
    throw error;
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); }
  catch (error) { await fs.rm(lock, { force: true }); throw error; }
  finally { await handle.close(); }
  return () => fs.rm(lock, { force: true });
}

export async function ignoreLocalState(root: string) {
  const file = path.join(root, ".gitignore");
  const previous = await readTextFile(file) ?? "";
  // Put the rule last, after any user negation rules.
  if (previous.trimEnd().split(/\r?\n/).at(-1) === "/.l/") return;
  await atomicText(file, `${previous}${previous && !previous.endsWith("\n") ? "\n" : ""}/.l/\n`);
}
