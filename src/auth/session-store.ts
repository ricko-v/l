import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { L_HOME } from "../config/paths.js";
import { DEFAULT_PROFILE, resolveProfile, loginHint } from "../config/profiles.js";

export interface AuthSession {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;

  expiresAt: string;

  refreshToken: string;

  idToken?: string;

  dpopPrivateKey: string;

  clientId: string;
  region: string;

  accountId?: string;
  arn?: string;
}

function validateSession(value: unknown): asserts value is AuthSession {
  const invalid = () => new Error("Invalid AWS session. Run `l login` again.");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid();
  }
  const session = value as Record<string, unknown>;
  for (const field of [
    "accessKeyId", "secretAccessKey", "sessionToken", "expiresAt",
    "refreshToken", "dpopPrivateKey", "clientId", "region",
  ]) {
    if (typeof session[field] !== "string" || !session[field].trim()) {
      throw invalid();
    }
  }
  if (!Number.isFinite(Date.parse(session.expiresAt as string))) {
    throw invalid();
  }
  for (const field of ["idToken", "accountId", "arn"]) {
    if (session[field] !== undefined && typeof session[field] !== "string") {
      throw invalid();
    }
  }
}

export function createSessionStore(directory: string) {
  const sessionPath = path.join(directory, "session.json");

  async function saveSession(session: AuthSession) {
    validateSession(session);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);

    // Rename only after the complete replacement has been written and flushed.
    const temporaryPath = path.join(directory, `.session-${randomUUID()}.tmp`);
    try {
      const file = await fs.open(temporaryPath, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(session, null, 2), "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await fs.rename(temporaryPath, sessionPath);
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
  }

  async function getSession(): Promise<AuthSession | null> {
    let content: string;
    try {
      content = await fs.readFile(sessionPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("Cannot read AWS session. Check the session file permissions.");
    }

    let session: unknown;
    try {
      session = JSON.parse(content);
    } catch {
      // JSON parse errors may include credential contents; never print them.
      throw new Error("Invalid AWS session. Run `l login` again.");
    }
    validateSession(session);
    return session;
  }

  return { saveSession, getSession };
}

export function createProfileSessionStore(profile = DEFAULT_PROFILE, home = L_HOME) {
  profile = resolveProfile(profile);
  // Keep default at the legacy path, including compatibility with l-tui.
  const directories = profile === DEFAULT_PROFILE ? [] : [path.join(home, "profiles"), path.join(home, "profiles", profile)];
  const directory = directories.at(-1) ?? home;
  const store = createSessionStore(directory);
  async function checkDirectories(create: boolean) {
    if (create && directories.length) {
      await fs.mkdir(home, { recursive: true, mode: 0o700 });
      await fs.chmod(home, 0o700);
    }
    for (const entry of directories) {
      if (create) await fs.mkdir(entry, { recursive: true, mode: 0o700 });
      const stat = await fs.lstat(entry).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error("Profile directories must be real directories, not symlinks.");
      if (create) await fs.chmod(entry, 0o700);
    }
    const stat = await fs.lstat(path.join(directory, "session.json")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat?.isSymbolicLink() && directories.length) throw new Error("Profile sessions must not be symlinks.");
  }
  function profileError(error: unknown): never {
    if (error instanceof Error && error.message.startsWith("Invalid AWS session.")) {
      throw new Error(`Invalid AWS session for profile "${profile}". Run \`${loginHint(profile)}\` again.`);
    }
    throw error;
  }
  return {
    async getSession() {
      if (directories.length) await checkDirectories(false);
      try { return await store.getSession(); } catch (error) { return profileError(error); }
    },
    async saveSession(session: AuthSession) {
      validateSession(session);
      if (directories.length) await checkDirectories(true);
      try { await store.saveSession(session); } catch (error) { profileError(error); }
    },
  };
}

export function getSession(profile = DEFAULT_PROFILE) {
  return createProfileSessionStore(profile).getSession();
}

export function saveSession(session: AuthSession, profile = DEFAULT_PROFILE) {
  return createProfileSessionStore(profile).saveSession(session);
}
