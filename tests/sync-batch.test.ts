import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { syncCommand, SyncBatchError } from "../src/commands/sync.js";
import { resolveSyncTargets } from "../src/sync/targets.js";
import type { Remote } from "../src/sync/remote.js";
import { readState } from "../src/sync/state.js";
import { readProjectConfig, saveProjectConfig } from "../src/config/project.js";
import { FakeRemote, fixture } from "./sync-fixtures.js";

const names = ["api", "worker", "cron"];
async function batchFixture(t: TestContext) {
  const f = await fixture(t);
  const targets = new Map<string, FakeRemote>();
  const calls: string[] = [];
  for (const name of names) {
    const target = await new FakeRemote().seed({ "index.js": `original-${name}` });
    target.current.arn = target.current.arn.replace(/:api$/, `:${name}`);
    targets.set(name, target);
  }
  const target = (nameOrArn: string) => {
    const name = nameOrArn.split(":").at(-1)!;
    const match = targets.get(name);
    if (!match) throw new Error(`Missing function ${name}`);
    return match;
  };
  const remote: Remote = {
    async get(name) { calls.push(`get:${name}`); return target(name).get(); },
    async download(current) { calls.push(`download:${current.arn}`); return target(current.arn).download(); },
    async update(current, zip) { calls.push(`update:${current.arn}`); await target(current.arn).update(current, zip); },
    async wait(current) { return target(current.arn).wait(); },
  };
  const staging: string[] = [];
  const originalMkdtemp = fs.mkdtemp.bind(fs);
  t.mock.method(fs, "mkdtemp", async (prefix: string) => {
    const folder = await originalMkdtemp(prefix);
    if (prefix.includes("l-sync-packages-")) staging.push(folder);
    return folder;
  });
  t.after(async () => {
    for (const folder of staging) await assert.rejects(fs.access(folder), { code: "ENOENT" });
    await assert.rejects(fs.access(path.join(f.directory, ".l/sync.lock")), { code: "ENOENT" });
  });
  return { ...f, remote, targets, calls, functions: async () => [...names] };
}

async function edit(directory: string, selected = names) {
  for (const name of selected) await fs.writeFile(path.join(directory, "lambda", name, "index.js"), `edited-${name}`);
}

test("multiple names pull and push with one confirmation and independent state", async (t) => {
  const f = await batchFixture(t);
  const selected = ["api", "worker"];
  const pulled = await syncCommand("pull", [...selected, "api"], {}, f);
  assert.deepEqual(pulled.map((result) => [result.name, result.status]), [["api", "success"], ["worker", "success"]]);
  assert.equal(f.confirmations.length, 1);
  for (const name of selected) assert.equal(await fs.readFile(path.join(f.directory, "lambda", name, "index.js"), "utf8"), `original-${name}`);
  await edit(f.directory, selected);
  await syncCommand("push", selected, {}, f);
  assert.equal(f.confirmations.length, 2);
  const state = await readState(f.directory);
  assert.deepEqual(Object.keys(state.functions).sort(), selected);
  for (const name of selected) {
    assert.equal(state.functions[name].revisionId, "updated");
    assert.equal(f.targets.get(name)!.updates.length, 1);
    assert.equal(f.targets.get(name)!.updates[0].target.revisionId, "initial");
  }
  assert.equal(f.targets.get("cron")!.updates.length, 0);
});

test("preflight failure on a later target prevents all uploads", async (t) => {
  const f = await batchFixture(t);
  await syncCommand("pull", names, { yes: true }, f);
  const before = await readState(f.directory);
  await edit(f.directory);
  f.targets.get("worker")!.current.revisionId = "external-update";
  await assert.rejects(syncCommand("push", names, { yes: true }, f), (error: SyncBatchError) => {
    assert.ok(error instanceof SyncBatchError);
    assert.deepEqual(error.results.map((result) => result.status), ["skipped", "failed", "skipped"]);
    assert.match(error.results[1].error!, /revision conflict/);
    return true;
  });
  for (const target of f.targets.values()) assert.equal(target.updates.length, 0);
  assert.deepEqual(await readState(f.directory), before);
  assert.equal(f.confirmations.length, 0);
});

test("bad pull package prevents installing any function in the batch", async (t) => {
  const f = await batchFixture(t);
  f.targets.get("worker")!.zip = Buffer.from("corrupt");
  await assert.rejects(syncCommand("pull", names, { yes: true }, f), /Preflight failed/);
  await assert.rejects(fs.access(path.join(f.directory, "lambda")), { code: "ENOENT" });
  assert.deepEqual((await readState(f.directory)).functions, {});
});

test("batch dry-run and cancellation apply nothing and clean up staged packages", async (t) => {
  const f = await batchFixture(t);
  const preview = await syncCommand("pull", names, { dryRun: true }, f);
  assert.ok(preview.every((result) => result.status === "preview"));
  assert.deepEqual(await fs.readdir(f.directory), ["l.config.json"]);
  const cancelled = await syncCommand("pull", names, {}, { ...f, prompts: {
    ...f.prompts, async confirm(message) { f.confirmations.push(message); return false; },
  } });
  assert.ok(cancelled.every((result) => result.status === "cancelled"));
  assert.equal(f.confirmations.length, 1);
  await assert.rejects(fs.access(path.join(f.directory, "lambda")), { code: "ENOENT" });
});

test("all targets are revalidated after confirmation before any upload", async (t) => {
  const f = await batchFixture(t);
  await syncCommand("pull", names, { yes: true }, f);
  await edit(f.directory);
  await assert.rejects(syncCommand("push", names, {}, { ...f, prompts: {
    ...f.prompts, async confirm() { f.targets.get("worker")!.current.revisionId = "changed-after-preview"; return true; },
  } }), /Targets changed after preview/);
  for (const target of f.targets.values()) assert.equal(target.updates.length, 0);
});

test("execution failure keeps successful state and skips remaining targets", async (t) => {
  const f = await batchFixture(t);
  await syncCommand("pull", names, { yes: true }, f);
  await edit(f.directory);
  f.targets.get("worker")!.updateFailure = new Error("upload failed");
  await assert.rejects(syncCommand("push", names, { yes: true }, f), (error: SyncBatchError) => {
    assert.deepEqual(error.results.map((result) => result.status), ["success", "failed", "skipped"]);
    return true;
  });
  const state = await readState(f.directory);
  assert.equal(state.functions.api.revisionId, "updated");
  assert.equal(state.functions.worker.revisionId, "initial");
  assert.equal(state.functions.cron.revisionId, "initial");
  assert.equal(f.targets.get("api")!.updates.length, 1);
  assert.equal(f.targets.get("worker")!.updates.length, 1);
  assert.equal(f.targets.get("cron")!.updates.length, 0);
  f.targets.get("worker")!.updateFailure = undefined;
  await syncCommand("push", ["worker", "cron"], { yes: true }, f);
  assert.equal(f.targets.get("api")!.updates.length, 1);
  assert.equal((await readState(f.directory)).functions.cron.revisionId, "updated");
});

test("partial pull failure restores the failed folder without reverting completed functions", async (t) => {
  const f = await batchFixture(t);
  await syncCommand("pull", names, { yes: true }, f);
  await edit(f.directory);
  const original = fs.rename.bind(fs);
  t.mock.method(fs, "rename", async (source: string, destination: string) => {
    if (destination === path.join(f.directory, ".l/state.json")) {
      const next = JSON.parse(await fs.readFile(source, "utf8"));
      if (next.functions.worker.revisionId === "new-worker") throw new Error("state write failed");
    }
    return original(source, destination);
  });
  for (const name of names) f.targets.get(name)!.current.revisionId = `new-${name}`;
  await assert.rejects(syncCommand("pull", names, {}, f), /Sync stopped after a failure/);
  assert.equal(await fs.readFile(path.join(f.directory, "lambda/api/index.js"), "utf8"), "original-api");
  assert.equal(await fs.readFile(path.join(f.directory, "lambda/worker/index.js"), "utf8"), "edited-worker");
  assert.equal(await fs.readFile(path.join(f.directory, "lambda/cron/index.js"), "utf8"), "edited-cron");
  const state = await readState(f.directory);
  assert.equal(state.functions.api.revisionId, "new-api");
  assert.equal(state.functions.worker.revisionId, "initial");
});

test("first push in a batch requires one explicit confirmation even with --yes", async (t) => {
  const f = await batchFixture(t);
  for (const name of names) {
    await fs.mkdir(path.join(f.directory, "lambda", name), { recursive: true });
    await fs.writeFile(path.join(f.directory, "lambda", name, "index.js"), `first-${name}`);
  }
  await syncCommand("push", names, { yes: true }, f);
  assert.equal(f.confirmations.length, 1);
  assert.match(f.confirmations[0], /Without a saved baseline for: api, worker, cron/);
});

test("unchanged functions are reported and omitted from the deployment confirmation", async (t) => {
  const f = await batchFixture(t);
  await syncCommand("pull", names, { yes: true }, f);
  await edit(f.directory, ["worker"]);
  const results = await syncCommand("push", names, {}, f);
  assert.deepEqual(results.map((result) => result.status), ["unchanged", "success", "unchanged"]);
  assert.equal(f.confirmations.length, 1);
  assert.match(f.confirmations[0], /function:worker/);
  assert.equal(f.targets.get("api")!.updates.length, 0);
});

test("pull --all lists AWS; push --all selects only local function folders", async (t) => {
  const f = await batchFixture(t);
  await syncCommand("pull", undefined, { all: true, yes: true }, f);
  await edit(f.directory);
  await fs.writeFile(path.join(f.directory, "lambda/README.md"), "notes");
  const results = await syncCommand("push", undefined, { all: true, yes: true }, {
    ...f, functions: async () => { assert.fail("push --all must not discover remote-only functions"); },
  });
  assert.deepEqual(results.map((result) => result.name), ["api", "cron", "worker"]);
});

test("--all respects config prefix and an explicit prefix overrides it", async (t) => {
  const f = await batchFixture(t);
  const old = (await readProjectConfig(f.directory))!;
  await saveProjectConfig(f.directory, { ...old.config, lambda: { prefix: "a" } }, old.contents);
  const filtered = await syncCommand("pull", undefined, { all: true, dryRun: true }, f);
  assert.deepEqual(filtered.map((result) => result.name), ["api"]);
  const override = await syncCommand("pull", undefined, { prefix: "w", dryRun: true }, f);
  assert.deepEqual(override.map((result) => result.name), ["worker"]);
});

test("ambiguous, empty, invalid, and case-colliding selectors are rejected before AWS work", async (t) => {
  const f = await batchFixture(t);
  const context = {
    action: "pull" as const, root: f.directory,
    config: (await readProjectConfig(f.directory))!.config,
    list: async () => { assert.fail("unexpected AWS listing"); }, select: async () => 0,
  };
  await assert.rejects(resolveSyncTargets(["api"], { all: true }, context), /not both/);
  await assert.rejects(resolveSyncTargets(["api"], { prefix: "a" }, context), /not both/);
  await assert.rejects(resolveSyncTargets(undefined, { prefix: "" }, context), /--prefix requires/);
  await assert.rejects(resolveSyncTargets(["../outside"], {}, context), /valid function names/);
  await assert.rejects(resolveSyncTargets(["api", "API"], {}, context), /letter case/);
  await assert.rejects(resolveSyncTargets(undefined, { all: true }, { ...context, list: async () => [] }), /No matching functions/);
});

test("deleting every tracked local file is still a pull conflict and blocks the batch with --yes", async (t) => {
  const f = await batchFixture(t);
  await syncCommand("pull", names, { yes: true }, f);
  await fs.unlink(path.join(f.directory, "lambda/worker/index.js"));
  await assert.rejects(syncCommand("pull", names, { yes: true }, f), /Preflight failed/);
  assert.deepEqual(await fs.readdir(path.join(f.directory, "lambda/worker")), []);
});
