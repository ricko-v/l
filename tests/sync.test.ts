import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { syncCommand } from "../src/commands/sync.js";
import { readState, acquireLock } from "../src/sync/state.js";
import { packArchive, unpackArchive } from "../src/sync/archive.js";
import { sha256 } from "../src/sync/files.js";
import { saveProjectConfig, readProjectConfig } from "../src/config/project.js";
import { fixture, ARN } from "./sync-fixtures.js";

test("pull and push retain executable deployment files without false changes", async (t) => {
  const f = await fixture(t);
  const remoteFiles = await unpackArchive(f.remote.zip);
  remoteFiles.set("bootstrap", { data: Buffer.from("executable"), mode: 0o755 });
  f.remote.zip = await packArchive(remoteFiles);
  f.remote.current.codeSha256 = sha256(f.remote.zip);
  await syncCommand("pull", undefined, { yes: true }, f);
  await syncCommand("pull", undefined, { yes: true }, f); // No false local conflict on Windows.
  await syncCommand("push", undefined, { yes: true }, f);
  assert.equal(f.remote.updates.length, 0);
  await fs.writeFile(path.join(f.directory, "lambda/api/bootstrap"), "edited executable");
  await syncCommand("push", undefined, { yes: true }, f);
  assert.equal(f.remote.updates.length, 1);
  const deployed = (await unpackArchive(f.remote.updates[0]!.zip)).get("bootstrap")!;
  assert.equal(deployed.mode, 0o755);
  assert.equal(deployed.data.toString(), "edited executable");
});

test("first push retains remote executable mode when there is no local baseline", async (t) => {
  const f = await fixture(t);
  const remoteFiles = await unpackArchive(f.remote.zip);
  remoteFiles.set("bootstrap", { data: Buffer.from("original"), mode: 0o755 });
  f.remote.zip = await packArchive(remoteFiles);
  f.remote.current.codeSha256 = sha256(f.remote.zip);
  await fs.mkdir(path.join(f.directory, "lambda/api"), { recursive: true });
  await fs.writeFile(path.join(f.directory, "lambda/api/bootstrap"), "new executable", { mode: 0o755 });
  await syncCommand("push", undefined, {}, f);
  assert.equal((await unpackArchive(f.remote.updates[0]!.zip)).get("bootstrap")!.mode, 0o755);
});

test("pull → edit → push preserves target revision, tracks additions/deletions, and avoids redundant pushes", async (t) => {
  const f = await fixture(t);
  await syncCommand("pull", undefined, { yes: true }, f);
  const source = path.join(f.directory, "lambda/api");
  assert.equal(await fs.readFile(path.join(source, "index.js"), "utf8"), "original");
  assert.match(await fs.readFile(path.join(f.directory, ".gitignore"), "utf8"), /\/\.l\//);
  await fs.writeFile(path.join(source, "index.js"), "changed");
  await fs.writeFile(path.join(source, "new.js"), "new");
  await fs.unlink(path.join(source, "old.js"));
  await syncCommand("push", undefined, { yes: true }, f);
  assert.equal(f.remote.updates.length, 1);
  assert.equal(f.remote.updates[0].target.arn, ARN);
  assert.equal(f.remote.updates[0].target.revisionId, "initial");
  assert.deepEqual([...(await unpackArchive(f.remote.updates[0].zip)).keys()].sort(), ["index.js", "new.js"]);
  const state = await readState(f.directory);
  assert.equal(state.functions.api.revisionId, "updated");
  assert.ok(!Object.hasOwn(state.functions.api.files, "old.js"));
  await syncCommand("push", undefined, { yes: true }, f);
  assert.equal(f.remote.updates.length, 1);
});

test("pull dry-run writes neither source, .l, nor .gitignore", async (t) => {
  const f = await fixture(t);
  await syncCommand("pull", undefined, { dryRun: true }, f);
  assert.deepEqual(await fs.readdir(f.directory), ["l.config.json"]);
  assert.equal(f.confirmations.length, 0);
});

test("pull preserves local edits on cancellation and backs them up on explicit confirmation", async (t) => {
  const f = await fixture(t);
  await syncCommand("pull", undefined, { yes: true }, f);
  const file = path.join(f.directory, "lambda/api/index.js");
  await fs.writeFile(file, "local edit");
  await assert.rejects(syncCommand("pull", undefined, { yes: true }, f), /Local changes need explicit review/);
  await syncCommand("pull", undefined, {}, { ...f, prompts: { ...f.prompts, async confirm() { return false; } } });
  assert.equal(await fs.readFile(file, "utf8"), "local edit");
  await syncCommand("pull", undefined, {}, f);
  assert.equal(await fs.readFile(file, "utf8"), "original");
  const backups = await fs.readdir(path.join(f.directory, ".l/backups"));
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(path.join(f.directory, ".l/backups", backups[0], "code/index.js"), "utf8"), "local edit");
  assert.match(f.confirmations[0], /Back up and replace/);
});

test("pull refuses corrupt download, ZIP failures, and remote changes without touching local code", async (t) => {
  const f = await fixture(t);
  await syncCommand("pull", undefined, { yes: true }, f);
  const before = await readState(f.directory);
  f.remote.zip = Buffer.from("invalid archive");
  await assert.rejects(syncCommand("pull", undefined, { yes: true }, f), /checksum mismatch/);
  assert.deepEqual(await readState(f.directory), before);
  assert.equal(await fs.readFile(path.join(f.directory, "lambda/api/index.js"), "utf8"), "original");
});

test("a failed state save rolls pull code back to its previous contents", async (t) => {
  const f = await fixture(t);
  await syncCommand("pull", undefined, { yes: true }, f);
  const before = await readState(f.directory);
  await f.remote.seed({ "index.js": "remote change" });
  const original = fs.rename.bind(fs);
  t.mock.method(fs, "rename", async (source: string, target: string) => {
    if (target === path.join(f.directory, ".l/state.json")) throw new Error("disk write failed");
    return original(source, target);
  });
  await assert.rejects(syncCommand("pull", undefined, { yes: true }, f), /disk write failed/);
  assert.equal(await fs.readFile(path.join(f.directory, "lambda/api/index.js"), "utf8"), "original");
  assert.deepEqual(await readState(f.directory), before);
});

test("push stops on remote revision or account mismatch even with --yes", async (t) => {
  const f = await fixture(t);
  await syncCommand("pull", undefined, { yes: true }, f);
  f.remote.current.revisionId = "someone-else";
  await assert.rejects(syncCommand("push", undefined, { yes: true }, f), /Remote revision conflict/);
  f.remote.current.arn = ARN.replace("123456789012", "222222222222");
  await assert.rejects(syncCommand("push", undefined, { yes: true }, f), /Account or region differs/);
  assert.equal(f.remote.updates.length, 0);
});

test("push detects revision changing after preview and local edits made during confirmation", async (t) => {
  const f = await fixture(t);
  await syncCommand("pull", undefined, { yes: true }, f);
  const file = path.join(f.directory, "lambda/api/index.js");
  await fs.writeFile(file, "ready to push");
  await assert.rejects(syncCommand("push", undefined, {}, { ...f, prompts: {
    ...f.prompts, async confirm() { f.remote.current.revisionId = "raced"; return true; },
  } }), /changed during this operation/);
  f.remote.current.revisionId = "initial";
  await assert.rejects(syncCommand("push", undefined, {}, { ...f, prompts: {
    ...f.prompts, async confirm() { await fs.writeFile(file, "new edit"); return true; },
  } }), /Local package changed/);
  assert.equal(f.remote.updates.length, 0);
});

test("push dry-run and declined first push do not upload or advance state", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.directory, "lambda/api"), { recursive: true });
  await fs.writeFile(path.join(f.directory, "lambda/api/index.js"), "new deployment");
  await syncCommand("push", undefined, { dryRun: true }, f);
  assert.ok(!(await fs.readdir(f.directory)).includes(".l"));
  await syncCommand("push", undefined, { yes: true }, { ...f, prompts: {
    ...f.prompts, async confirm(message) { f.confirmations.push(message); return false; },
  } });
  assert.match(f.confirmations[0], /without a saved baseline/);
  assert.equal(f.remote.updates.length, 0);
  assert.deepEqual((await readState(f.directory)).functions, {});
});

test("first push requires explicit target confirmation even with --yes", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.directory, "lambda/api"), { recursive: true });
  await fs.writeFile(path.join(f.directory, "lambda/api/index.js"), "first deployment");
  await syncCommand("push", undefined, { yes: true }, f);
  assert.match(f.confirmations[0], /123456789012:function:api/);
  assert.equal(f.remote.updates.length, 1);
});

test("upload failure, timeout, and superseded update never advance the saved baseline", async (t) => {
  for (const failure of ["upload", "timeout", "superseded"]) {
    const f = await fixture(t);
    await syncCommand("pull", undefined, { yes: true }, f);
    const before = await readState(f.directory);
    await fs.writeFile(path.join(f.directory, "lambda/api/index.js"), "changed");
    if (failure === "upload") f.remote.updateFailure = Object.assign(new Error("revision mismatch"), { name: "PreconditionFailedException" });
    if (failure === "timeout") f.remote.waitFailure = new Error("Update status uncertain or timed out");
    if (failure === "superseded") f.remote.afterUpdate = () => { f.remote.current.codeSha256 = "other-code"; };
    await assert.rejects(syncCommand("push", undefined, { yes: true }, f));
    assert.deepEqual(await readState(f.directory), before);
  }
});

test("sync resolves project root from subfolders and prefix selection", async (t) => {
  const f = await fixture(t);
  const old = (await readProjectConfig(f.directory))!;
  await saveProjectConfig(f.directory, { ...old.config, lambda: { prefix: "a" } }, old.contents);
  const nested = path.join(f.directory, "subfolder");
  await fs.mkdir(nested);
  await syncCommand("pull", undefined, { yes: true }, {
    ...f, directory: nested,
    functions: async (region) => { assert.equal(region, "us-east-1"); return ["api", "unrelated"]; },
  });
  assert.equal(await fs.readFile(path.join(f.directory, "lambda/api/index.js"), "utf8"), "original");
  assert.deepEqual(await fs.readdir(nested), []);
});

test("lock blocks concurrent sync and malformed state is not silently ignored", async (t) => {
  const f = await fixture(t);
  const unlock = await acquireLock(f.directory);
  await assert.rejects(syncCommand("pull", undefined, { yes: true }, f), /Another sync may be running/);
  await unlock();
  await fs.writeFile(path.join(f.directory, ".l/state.json"), "invalid JSON");
  await assert.rejects(syncCommand("pull", undefined, { yes: true }, f), /Invalid .l\/state.json/);
});

test("symlinked source roots and local state directories are rejected", async (t) => {
  for (const component of ["lambda", ".l"]) {
    const f = await fixture(t);
    const outside = path.join(f.directory, "outside");
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(f.directory, component), "junction");
    await assert.rejects(syncCommand("pull", undefined, { yes: true }, f), /Expected a real directory/);
    assert.deepEqual(await fs.readdir(outside), []);
  }
});
