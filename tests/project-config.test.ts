import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { findProjectConfig, readProjectConfig, saveProjectConfig, validateProjectConfig, type ProjectConfig } from "../src/config/project.js";

const config: ProjectConfig = { version: 1, name: "billing", region: "us-east-1", lambda: { functionName: "billing-api" } };

async function fixture(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "l-project-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("config can be read from a nested directory; nearest project takes precedence", async (t) => {
  const directory = await fixture(t);
  const nested = path.join(directory, "child");
  await fs.mkdir(nested);
  await saveProjectConfig(directory, config);
  assert.deepEqual(await findProjectConfig(nested), config);
  const childConfig = { ...config, name: "child" };
  await saveProjectConfig(nested, childConfig);
  assert.deepEqual(await findProjectConfig(nested), childConfig);
});

test("new config never overwrites an existing destination", async (t) => {
  const directory = await fixture(t);
  await saveProjectConfig(directory, config);
  await assert.rejects(saveProjectConfig(directory, { ...config, name: "other" }), { code: "EEXIST" });
  assert.deepEqual((await readProjectConfig(directory))?.config, config);
  assert.deepEqual(await fs.readdir(directory), ["l.config.json"]);
});

for (const code of ["EACCES", "EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"]) {
  test(`new config falls back to an exclusive copy when link fails with ${code}`, async (t) => {
    const directory = await fixture(t);
    t.mock.method(fs, "link", async () => { throw Object.assign(new Error("link unavailable"), { code }); });
    await saveProjectConfig(directory, config);
    assert.deepEqual((await readProjectConfig(directory))?.config, config);
    assert.deepEqual(await fs.readdir(directory), ["l.config.json"]);
  });
}

test("fallback refuses a config created by another process during publication", async (t) => {
  const directory = await fixture(t);
  const otherContents = JSON.stringify({ ...config, name: "other-process" });
  t.mock.method(fs, "link", async () => {
    await fs.writeFile(path.join(directory, "l.config.json"), otherContents);
    throw Object.assign(new Error("link denied"), { code: "EACCES" });
  });
  await assert.rejects(saveProjectConfig(directory, config), { code: "EEXIST" });
  assert.equal(await fs.readFile(path.join(directory, "l.config.json"), "utf8"), otherContents);
  assert.deepEqual(await fs.readdir(directory), ["l.config.json"]);
});

test("fallback refuses a destination symlink without modifying its target", async (t) => {
  const directory = await fixture(t);
  const target = path.join(directory, "target.json");
  await fs.writeFile(target, "unchanged");
  await fs.symlink(target, path.join(directory, "l.config.json"));
  t.mock.method(fs, "link", async () => { throw Object.assign(new Error("link denied"), { code: "EPERM" }); });
  await assert.rejects(saveProjectConfig(directory, config), { code: "EEXIST" });
  assert.equal(await fs.readFile(target, "utf8"), "unchanged");
  assert.ok((await fs.lstat(path.join(directory, "l.config.json"))).isSymbolicLink());
  assert.deepEqual((await fs.readdir(directory)).sort(), ["l.config.json", "target.json"]);
});

test("fallback propagates copy permission failures and cleans up the temporary file", async (t) => {
  const directory = await fixture(t);
  const failure = Object.assign(new Error("copy denied"), { code: "EACCES" });
  t.mock.method(fs, "link", async () => { throw Object.assign(new Error("link denied"), { code: "EACCES" }); });
  t.mock.method(fs, "copyFile", async () => { throw failure; });
  await assert.rejects(saveProjectConfig(directory, config), (error) => error === failure);
  assert.deepEqual(await fs.readdir(directory), []);
});

test("unexpected hard link failures do not trigger a copy", async (t) => {
  const directory = await fixture(t);
  const failure = Object.assign(new Error("disk failure"), { code: "EIO" });
  t.mock.method(fs, "link", async () => { throw failure; });
  const copy = t.mock.method(fs, "copyFile", async () => { assert.fail("unexpected copy"); });
  await assert.rejects(saveProjectConfig(directory, config), (error) => error === failure);
  assert.equal(copy.mock.callCount(), 0);
  assert.deepEqual(await fs.readdir(directory), []);
});

test("update replaces a complete config and refuses changes made during the wizard", async (t) => {
  const directory = await fixture(t);
  await saveProjectConfig(directory, config);
  const original = (await readProjectConfig(directory))!;
  const updated: ProjectConfig = { ...config, lambda: { prefix: "billing-" } };
  await saveProjectConfig(directory, updated, original.contents);
  await assert.rejects(saveProjectConfig(directory, config, original.contents), /changed during initialization/);
  assert.deepEqual((await readProjectConfig(directory))?.config, updated);
  assert.deepEqual(await fs.readdir(directory), ["l.config.json"]);
});

test("failed publication cleans up temporary files and preserves the destination", async (t) => {
  const directory = await fixture(t);
  await fs.mkdir(path.join(directory, "l.config.json"));
  await assert.rejects(saveProjectConfig(directory, config));
  assert.deepEqual(await fs.readdir(directory), ["l.config.json"]);
});

test("invalid config, unsupported versions, ambiguous selectors, and secrets are rejected", () => {
  for (const value of [
    null, [], {}, { ...config, version: 2 }, { ...config, name: " " },
    { ...config, region: "invalid" }, { ...config, secretAccessKey: "secret" },
    { ...config, lambda: {} }, { ...config, lambda: { functionName: "api", prefix: "api-" } },
    { ...config, lambda: { functionName: "invalid name" } },
    { ...config, lambda: { prefix: "" } },
  ]) assert.throws(() => validateProjectConfig(value), /Invalid l.config.json/);
});

test("malformed project blocks parent fallback without exposing file contents", async (t) => {
  const directory = await fixture(t);
  await saveProjectConfig(directory, config);
  const nested = path.join(directory, "child");
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, "l.config.json"), "sensitive invalid JSON");
  await assert.rejects(findProjectConfig(nested), (error: Error) => {
    assert.match(error.message, /malformed JSON/);
    assert.ok(!error.message.includes("sensitive"));
    return true;
  });
});
