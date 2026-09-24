import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test, type TestContext } from "node:test";
import { initCommand, listFunctionNames } from "../src/commands/init.js";
import { PromptCancelledError, type InitPrompts } from "../src/cli/prompts.js";
import { readProjectConfig, saveProjectConfig } from "../src/config/project.js";
import type { AuthSession } from "../src/auth/session-store.js";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { SESSION_PATH } from "../src/config/paths.js";

const session: AuthSession = {
  accessKeyId: "fake-access", secretAccessKey: "fake-secret", sessionToken: "fake-session",
  refreshToken: "fake-refresh", dpopPrivateKey: "fake-key", expiresAt: "2030-01-01T00:00:00.000Z",
  region: "ap-southeast-1", clientId: "fake-client",
};

function scripted(answers: Array<string | number | boolean | Error>) {
  let closed = false;
  function next() {
    assert.ok(answers.length, "unexpected prompt");
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  }
  const prompts: InitPrompts = {
    async input(_message, initial, validate) {
      const answer = next();
      assert.equal(typeof answer, "string");
      const value = (answer as string) || initial;
      assert.ok(validate(value));
      return value;
    },
    async select() { const answer = next(); assert.equal(typeof answer, "number"); return answer as number; },
    async confirm() { const answer = next(); assert.equal(typeof answer, "boolean"); return answer as boolean; },
    close() { closed = true; },
  };
  return { prompts, done() { assert.equal(answers.length, 0); assert.ok(closed); } };
}

async function fixture(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "l-init-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("manual initialization works offline, defaults to package name, and saves only project data", async (t) => {
  const directory = await fixture(t);
  await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "@team/billing" }));
  const input = scripted(["default", "", "us-east-1", 1, "billing-api", true]);
  await initCommand({ directory, prompts: input.prompts, session: async () => null, functions: async () => { assert.fail("unexpected AWS call"); }, log() {} });
  assert.deepEqual((await readProjectConfig(directory))?.config, {
    version: 1, name: "@team/billing", region: "us-east-1", profile: "default", lambda: { functionName: "billing-api" },
  });
  input.done();
});

test("AWS function selection uses resource region while secrets stay global", async (t) => {
  const directory = await fixture(t);
  const input = scripted(["default", "billing", "us-west-2", 0, 1, true]);
  await initCommand({ directory, prompts: input.prompts, session: async () => session,
    functions: async (region) => { assert.equal(region, "us-west-2"); return ["api-one", "api-two"]; }, log() {} });
  const saved = (await readProjectConfig(directory))!;
  assert.equal(saved.config.lambda?.functionName, "api-two");
  assert.ok(!saved.contents.includes("fake-"));
  assert.equal(session.region, "ap-southeast-1");
  input.done();
});

test("missing login and empty or failed AWS listing allow manual fallback", async (t) => {
  for (const scenario of ["missing", "empty", "failed"]) {
    const directory = await fixture(t);
    const input = scripted(["default", "billing", "us-east-1", 0, 2, "billing-", true]);
    await initCommand({ directory, prompts: input.prompts,
      session: async () => scenario === "missing" ? null : session,
      functions: async () => { if (scenario === "failed") throw new Error("Access denied"); assert.notEqual(scenario, "missing"); return []; }, log() {} });
    assert.deepEqual((await readProjectConfig(directory))?.config.lambda, { prefix: "billing-" });
    input.done();
  }
});

test("skip uses folder name when package metadata is unavailable", async (t) => {
  const directory = await fixture(t);
  const input = scripted(["default", "", "us-east-1", 3, true]);
  await initCommand({ directory, prompts: input.prompts, session: async () => null, log() {} });
  assert.deepEqual((await readProjectConfig(directory))?.config, { version: 1, name: path.basename(directory), region: "us-east-1", profile: "default" });
  input.done();
});

test("declining save and Ctrl+C leave no configuration or temporary files", async (t) => {
  for (const cancel of [false, new PromptCancelledError()]) {
    const directory = await fixture(t);
    const input = scripted(["default", "billing", "us-east-1", 3, cancel]);
    const run = initCommand({ directory, prompts: input.prompts, session: async () => null, log() {} });
    if (cancel instanceof Error) await assert.rejects(run, PromptCancelledError);
    else await run;
    assert.deepEqual(await fs.readdir(directory), []);
    input.done();
  }
});

test("updating requires confirmation, prefills old values, and can remove the Lambda selector", async (t) => {
  const directory = await fixture(t);
  const config = { version: 1 as const, name: "existing", region: "us-east-1", lambda: { functionName: "api" } };
  await saveProjectConfig(directory, config);
  const declined = scripted([false]);
  await initCommand({ directory, prompts: declined.prompts, session: async () => { assert.fail("unnecessary session read"); }, log() {} });
  assert.deepEqual((await readProjectConfig(directory))?.config, config);
  declined.done();
  const update = scripted([true, "", "", "", 3, true]);
  await initCommand({ directory, prompts: update.prompts, session: async () => null, log() {} });
  assert.deepEqual((await readProjectConfig(directory))?.config, { version: 1, name: "existing", region: "us-east-1", profile: "default" });
  update.done();
});

test("invalid existing config is preserved and closes prompts", async (t) => {
  const directory = await fixture(t);
  const configPath = path.join(directory, "l.config.json");
  await fs.writeFile(configPath, "invalid JSON");
  const input = scripted([]);
  await assert.rejects(initCommand({ directory, prompts: input.prompts, log() {} }), /malformed JSON/);
  assert.equal(await fs.readFile(configPath, "utf8"), "invalid JSON");
  input.done();
});

test("function picker consumes pagination, sorts names, and destroys the client", async (t) => {
  const originalReadFile = fs.readFile.bind(fs);
  t.mock.method(fs, "readFile", (...args: Parameters<typeof fs.readFile>) => args[0] === SESSION_PATH ? Promise.resolve(JSON.stringify(session)) : originalReadFile(...args));
  const markers: unknown[] = [];
  t.mock.method(LambdaClient.prototype, "send", async function (this: LambdaClient, command: { input: { Marker?: string } }) {
    assert.equal(await this.config.region(), "us-west-2");
    markers.push(command.input.Marker);
    return command.input.Marker ? { Functions: [{ FunctionName: "a" }, { FunctionName: "z" }] } : { Functions: [{ FunctionName: "z" }], NextMarker: "next" };
  });
  const destroy = t.mock.method(LambdaClient.prototype, "destroy", () => {});
  assert.deepEqual(await listFunctionNames("us-west-2"), ["a", "z"]);
  assert.deepEqual(markers, [undefined, "next"]);
  assert.equal(destroy.mock.callCount(), 1);
});

test("non-interactive init fails clearly without writing files", async (t) => {
  const directory = await fixture(t);
  const cli = path.resolve("src/index.ts");
  const loader = path.resolve("node_modules/tsx/dist/loader.mjs");
  const result = spawnSync(process.execPath, ["--import", loader, cli, "init"], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires an interactive terminal/);
  assert.deepEqual(await fs.readdir(directory), []);
});
