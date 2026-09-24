import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { saveProjectConfig } from "../src/config/project.js";
import { packArchive } from "../src/sync/archive.js";
import { sha256, type Files } from "../src/sync/files.js";
import type { Remote, RemoteFunction } from "../src/sync/remote.js";
import type { InitPrompts } from "../src/cli/prompts.js";

export const ARN = "arn:aws:lambda:us-east-1:123456789012:function:api";
export function files(values: Record<string, string>): Files {
  return new Map(Object.entries(values).map(([name, value]) => [name, { data: Buffer.from(value), mode: 0o644 }]));
}

export class FakeRemote implements Remote {
  current!: RemoteFunction;
  zip!: Buffer;
  updates: Array<{ target: RemoteFunction; zip: Buffer }> = [];
  updateFailure?: Error;
  waitFailure?: Error;
  afterUpdate?: () => void;
  async seed(values: Record<string, string>) {
    this.zip = await packArchive(files(values));
    this.current = { arn: ARN, revisionId: "initial", codeSha256: sha256(this.zip), status: "Successful" };
    return this;
  }
  async get() { return { ...this.current }; }
  async download() { return this.zip; }
  async update(target: RemoteFunction, zip: Buffer) {
    this.updates.push({ target, zip });
    if (this.updateFailure) throw this.updateFailure;
    this.zip = zip;
    this.current = { ...this.current, revisionId: "updated", codeSha256: sha256(zip) };
    this.afterUpdate?.();
  }
  async wait() {
    if (this.waitFailure) throw this.waitFailure;
    return { ...this.current };
  }
}

export async function fixture(t: TestContext) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "l-sync-test-")));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await saveProjectConfig(directory, { version: 1, name: "test", region: "us-east-1", lambda: { functionName: "api" } });
  const remote = await new FakeRemote().seed({ "index.js": "original", "old.js": "old" });
  const output: string[] = [];
  const confirmations: string[] = [];
  const prompts: InitPrompts = {
    async input() { throw new Error("unexpected input"); },
    async select() { return 0; },
    async confirm(message) { confirmations.push(message); return true; },
    close() {},
  };
  return {
    directory, remote, prompts, output, confirmations,
    log: (message: string) => { output.push(message); },
  };
}
