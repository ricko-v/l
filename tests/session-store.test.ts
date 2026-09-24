import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { createSessionStore, type AuthSession } from "../src/auth/session-store.js";

const session: AuthSession = {
  accessKeyId: "fake-access-key", secretAccessKey: "fake-secret",
  sessionToken: "fake-session", expiresAt: "2030-01-01T00:00:00.000Z",
  refreshToken: "fake-refresh", dpopPrivateKey: "fake-test-key",
  clientId: "test-client", region: "ap-southeast-1",
};

async function fixture(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "l-session-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, "session.json"), ...createSessionStore(directory) };
}

test("missing session returns null", async (t) => {
  const store = await fixture(t);
  assert.equal(await store.getSession(), null);
});

test("saving replaces session and tightens existing permissions", async (t) => {
  const store = await fixture(t);
  await fs.chmod(store.directory, 0o755);
  await fs.writeFile(store.file, "old data", { mode: 0o644 });
  await store.saveSession(session);
  assert.deepEqual(await store.getSession(), session);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(store.file)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(store.directory)).mode & 0o777, 0o700);
  }
  assert.deepEqual(await fs.readdir(store.directory), ["session.json"]);
});

test("invalid JSON, missing fields and bad expiry are rejected without exposing contents", async (t) => {
  const store = await fixture(t);
  for (const content of ["fake-secret invalid JSON", "null", "[]", "{}", JSON.stringify({ ...session, expiresAt: "bad" })]) {
    await fs.writeFile(store.file, content);
    await assert.rejects(store.getSession(), { message: "Invalid AWS session. Run `l login` again." });
  }
});

test("invalid replacement preserves the prior session", async (t) => {
  const store = await fixture(t);
  await store.saveSession(session);
  await assert.rejects(store.saveSession({ ...session, refreshToken: "" }), /Invalid AWS session/);
  assert.deepEqual(await store.getSession(), session);
});

test("failed rename preserves the destination and removes temporary files", async (t) => {
  const store = await fixture(t);
  await fs.mkdir(store.file);
  await assert.rejects(store.saveSession(session));
  assert.deepEqual(await fs.readdir(store.directory), ["session.json"]);
  assert.ok((await fs.stat(store.file)).isDirectory());
});

test("read errors are not reported as unauthenticated", async (t) => {
  const store = await fixture(t);
  await fs.mkdir(store.file);
  await assert.rejects(store.getSession(), /Cannot read AWS session/);
});
