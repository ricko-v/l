import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { STSClient } from "@aws-sdk/client-sts";
import { SigninClient } from "@aws-sdk/client-signin";
import { L_HOME } from "../src/config/paths.js";
import { resolveProfile } from "../src/config/profiles.js";
import { createProfileSessionStore, createSessionStore, getSession, type AuthSession } from "../src/auth/session-store.js";
import { createDpopKey } from "../src/auth/dpop.js";
import { getCredentials } from "../src/auth/credentials.js";
import { readProjectConfig, saveProjectConfig, validateProjectConfig } from "../src/config/project.js";
import { loginCommand } from "../src/commands/login.js";
import { whoamiCommand } from "../src/commands/whoami.js";
import { lambdaInfoCommand } from "../src/commands/lambda/info.js";
import { lambdaListCommand } from "../src/commands/lambda/list.js";
import { initCommand, listFunctionNames } from "../src/commands/init.js";
import { syncCommand } from "../src/commands/sync.js";
import { createLambdaClient } from "../src/aws/lambda.js";
import { FakeRemote } from "./sync-fixtures.js";

function session(name: string, expired = false): AuthSession {
  return {
    accessKeyId: `${name}-access`, secretAccessKey: `${name}-secret`, sessionToken: `${name}-token`,
    refreshToken: `${name}-refresh`, dpopPrivateKey: createDpopKey().privateKeyPem, clientId: "fake-client",
    expiresAt: expired ? "2020-01-01T00:00:00.000Z" : "2035-01-01T00:00:00.000Z", region: "ap-southeast-1",
  };
}

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "l-profiles-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, "auth");
  const directory = path.join(root, "project");
  await fs.mkdir(directory);
  // Redirect every global auth access to a temporary store. Never use real credentials.
  const remap = (value: unknown) => typeof value === "string" && (value === L_HOME || value.startsWith(L_HOME + path.sep))
    ? home + value.slice(L_HOME.length) : value;
  for (const method of ["readFile", "mkdir", "chmod", "open", "rename", "rm", "lstat"] as const) {
    const original = fs[method].bind(fs) as (...args: any[]) => unknown;
    t.mock.method(fs, method, (...args: any[]) => {
      args[0] = remap(args[0]);
      if (method === "rename") args[1] = remap(args[1]);
      return original(...args);
    });
  }
  t.mock.method(process, "cwd", () => directory);
  const logs: string[] = [];
  t.mock.method(console, "log", (value: string) => { logs.push(value); });
  t.mock.method(console, "table", () => {});
  const store = (profile: string) => createProfileSessionStore(profile, home);
  return { root, home, directory, store, logs };
}

test("default reads the legacy session unchanged; named profile writes are independent and private", async (t) => {
  const f = await fixture(t);
  const legacy = session("default");
  await createSessionStore(f.home).saveSession(legacy);
  const before = await fs.readFile(path.join(f.home, "session.json"), "utf8");
  await f.store("production").saveSession(session("production"));
  await f.store("staging").saveSession(session("staging"));
  assert.deepEqual(await getSession(), legacy);
  assert.equal(await fs.readFile(path.join(f.home, "session.json"), "utf8"), before);
  assert.equal((await getSession("production"))?.accessKeyId, "production-access");
  assert.equal((await getSession("staging"))?.accessKeyId, "staging-access");
  for (const name of ["production", "staging"]) {
    const directory = path.join(f.home, "profiles", name);
    assert.deepEqual(await fs.readdir(directory), ["session.json"]);
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
      assert.equal((await fs.stat(path.join(directory, "session.json"))).mode & 0o777, 0o600);
    }
  }
});

test("profile precedence is explicit > project > default; unsafe names and case aliases are rejected", () => {
  assert.equal(resolveProfile("staging", "production"), "staging");
  assert.equal(resolveProfile(undefined, "production"), "production");
  assert.equal(resolveProfile(), "default");
  assert.equal(resolveProfile("default", "production"), "default");
  for (const name of ["", "../prod", "/tmp/prod", ".", "prod.test", "Prod", "a\\b", " bad", "a".repeat(65), "con", "nul", "aux", "prn", "com1", "lpt9"]) {
    assert.throws(() => resolveProfile(name), /Invalid profile/);
    assert.throws(() => createProfileSessionStore(name), /Invalid profile/);
    assert.throws(() => validateProjectConfig({ version: 1, name: "test", region: "us-east-1", profile: name }), /Invalid l.config.json/);
  }
});

test("missing and corrupt named profiles never fall back to default", async (t) => {
  const f = await fixture(t);
  await f.store("default").saveSession(session("default"));
  assert.equal(await getSession("missing"), null);
  await assert.rejects(getCredentials("missing"), /l login --profile missing/);
  await f.store("production").saveSession(session("production"));
  await fs.writeFile(path.join(f.home, "profiles/production/session.json"), "secret invalid JSON");
  await assert.rejects(getCredentials("production"), (error: Error) => {
    assert.match(error.message, /l login --profile production/);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
  assert.equal((await getSession())?.accessKeyId, "default-access");
});

test("profile directories and session files cannot alias another profile via symlinks", async (t) => {
  const f = await fixture(t);
  await f.store("production").saveSession(session("production"));
  await fs.symlink(path.join(f.home, "profiles/production"), path.join(f.home, "profiles/alias"), "junction");
  await assert.rejects(f.store("alias").getSession(), /symlinks/);
  await assert.rejects(f.store("alias").saveSession(session("alias")), /symlinks/);
  await fs.mkdir(path.join(f.home, "profiles/file-alias"));
  await fs.symlink(path.join(f.home, "profiles/production/session.json"), path.join(f.home, "profiles/file-alias/session.json"));
  await assert.rejects(f.store("file-alias").getSession(), /symlinks/);
  assert.equal((await f.store("production").getSession())?.accessKeyId, "production-access");
});

test("refresh rotates only the selected profile and coalesces concurrent requests", async (t) => {
  const f = await fixture(t);
  const defaultSession = session("default");
  const production = session("production", true);
  await f.store("default").saveSession(defaultSession);
  await f.store("production").saveSession(production);
  let calls = 0;
  t.mock.method(SigninClient.prototype, "send", async function (this: SigninClient, command) {
    calls++;
    assert.equal(command.input.tokenInput.refreshToken, "production-refresh");
    assert.equal(await this.config.region(), production.region);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { tokenOutput: { accessToken: { accessKeyId: "rotated", secretAccessKey: "rotated-secret", sessionToken: "rotated-token" }, refreshToken: "rotated-refresh", expiresIn: 900 } };
  });
  const credentials = await Promise.all([getCredentials("production"), getCredentials("production")]);
  assert.equal(calls, 1);
  assert.ok(credentials.every((value) => value.accessKeyId === "rotated"));
  assert.deepEqual(await getSession(), defaultSession);
  assert.equal((await getSession("production"))?.refreshToken, "rotated-refresh");
  assert.equal((await getSession("production"))?.dpopPrivateKey, production.dpopPrivateKey);
});

test("expired named refresh token gives the exact profile login command without modifying sessions", async (t) => {
  const f = await fixture(t);
  const original = session("production", true);
  await f.store("production").saveSession(original);
  t.mock.method(SigninClient.prototype, "send", async () => { throw new Error("The refresh token has expired."); });
  await assert.rejects(getCredentials("production"), /l login --profile production/);
  assert.deepEqual(await getSession("production"), original);
});

test("Lambda list, info, picker and whoami use the project profile or explicit override", async (t) => {
  const f = await fixture(t);
  for (const name of ["default", "production", "staging"]) await f.store(name).saveSession(session(name));
  await saveProjectConfig(f.directory, { version: 1, name: "test", region: "us-east-1", profile: "production", lambda: { functionName: "api" } });
  const seen: string[] = [];
  t.mock.method(LambdaClient.prototype, "send", async function (this: LambdaClient) {
    seen.push((await this.config.credentials()).accessKeyId);
    assert.equal(await this.config.region(), "us-east-1");
    return { Functions: [{ FunctionName: "api" }], Configuration: { FunctionName: "api" } };
  });
  t.mock.method(STSClient.prototype, "send", async function (this: STSClient) {
    seen.push((await this.config.credentials()).accessKeyId);
    return { Account: "123456789012", Arn: "test-arn" };
  });
  await lambdaListCommand();
  await lambdaInfoCommand();
  await lambdaListCommand({ profile: "staging" });
  await lambdaInfoCommand(undefined, { profile: "default" });
  await whoamiCommand();
  await whoamiCommand({ profile: "staging" });
  await listFunctionNames("us-east-1", "staging");
  assert.deepEqual(seen, ["production-access", "production-access", "staging-access", "default-access", "production-access", "staging-access", "staging-access"]);
  assert.ok(f.logs.includes("Profile   production"));
  const client = await createLambdaClient(undefined, "production");
  assert.equal(await client.config.region(), "ap-southeast-1");
  client.destroy();
});

test("pull and push use the same selected profile for discovery and deployment metadata", async (t) => {
  const f = await fixture(t);
  for (const name of ["production", "staging"]) await f.store(name).saveSession(session(name));
  await saveProjectConfig(f.directory, { version: 1, name: "test", region: "us-east-1", profile: "production", lambda: { prefix: "api" } });
  const remote = await new FakeRemote().seed({ "index.js": "original" });
  const seen: string[] = [];
  t.mock.method(LambdaClient.prototype, "send", async function (this: LambdaClient, command) {
    seen.push(`${command.constructor.name}:${(await this.config.credentials()).accessKeyId}`);
    if (command.constructor.name === "ListFunctionsCommand") return { Functions: [{ FunctionName: "api" }] };
    assert.equal(command.constructor.name, "GetFunctionCommand");
    return { Configuration: { FunctionArn: remote.current.arn, CodeSha256: remote.current.codeSha256, RevisionId: "initial", PackageType: "Zip" }, Code: { Location: "https://example.test/package" } };
  });
  t.mock.method(globalThis, "fetch", async () => new Response(remote.zip));
  await syncCommand("pull", undefined, { all: true, dryRun: true });
  assert.deepEqual(seen, ["ListFunctionsCommand:production-access", "GetFunctionCommand:production-access"]);
  seen.length = 0;
  await fs.mkdir(path.join(f.directory, "lambda/api"), { recursive: true });
  await fs.writeFile(path.join(f.directory, "lambda/api/index.js"), "edited");
  await syncCommand("push", undefined, { all: true, dryRun: true, profile: "staging" });
  assert.deepEqual(seen, ["GetFunctionCommand:staging-access"]);
});

test("login saves only its selected profile; failed verification leaves existing sessions intact", async (t) => {
  const f = await fixture(t);
  const original = session("default");
  await f.store("default").saveSession(original);
  await saveProjectConfig(f.directory, { version: 1, name: "test", region: "us-east-1", profile: "production" });
  const signin = t.mock.method(SigninClient.prototype, "send", async () => ({ tokenOutput: {
    accessToken: { accessKeyId: "new-access", secretAccessKey: "new-secret", sessionToken: "new-token" }, refreshToken: "new-refresh", expiresIn: 900,
  } }));
  let fail = false;
  t.mock.method(STSClient.prototype, "send", async () => {
    if (fail) throw new Error("STS failed");
    return { Account: "123456789012", Arn: "test-arn" };
  });
  let closed = 0;
  const dependencies = {
    callback: async (state: string) => ({ redirectUri: "http://127.0.0.1:12345/oauth/callback", waitForCallback: async () => ({ code: "fake-code", state }), close: () => { closed++; } }),
    openBrowser: async () => {},
  };
  await loginCommand({}, dependencies);
  assert.equal((await getSession("production"))?.accessKeyId, "new-access");
  await loginCommand({ profile: "staging" }, dependencies);
  assert.equal((await getSession("staging"))?.accessKeyId, "new-access");
  const warning = t.mock.method(console, "warn", () => {});
  await loginCommand({ profile: "manual-browser" }, {
    ...dependencies,
    openBrowser: async () => { throw new Error("xdg-open unavailable"); },
  });
  assert.equal((await getSession("manual-browser"))?.accessKeyId, "new-access");
  assert.match(String(warning.mock.calls[0]?.arguments[0]), /Open the URL above/);
  assert.deepEqual(await getSession(), original);
  const before = await getSession("production");
  fail = true;
  await assert.rejects(loginCommand({}, dependencies), /STS failed/);
  assert.deepEqual(await getSession("production"), before);
  assert.deepEqual(await getSession(), original);
  assert.equal(signin.mock.callCount(), 4);
  assert.equal(closed, 4);
});

test("init saves the chosen profile and retains it on update; --profile overrides the wizard default", async (t) => {
  const f = await fixture(t);
  const selected: string[] = [];
  const prompts = {
    async input(message: string, initial: string) {
      if (message === "AWS profile") return initial === "default" ? "production" : initial;
      return initial;
    },
    async select() { return 3; }, async confirm() { return true; }, close() {},
  };
  const dependencies = { directory: f.directory, prompts, session: async (profile?: string) => { selected.push(profile!); return null; }, log() {} };
  await initCommand(dependencies);
  assert.equal((await readProjectConfig(f.directory))?.config.profile, "production");
  await initCommand(dependencies);
  assert.equal((await readProjectConfig(f.directory))?.config.profile, "production");
  await initCommand(dependencies, { profile: "staging" });
  assert.equal((await readProjectConfig(f.directory))?.config.profile, "staging");
  assert.deepEqual(selected, ["production", "production", "staging"]);
});

test("global --profile is parsed before and after nested commands, without colliding with --prefix", async (t) => {
  const f = await fixture(t);
  await saveProjectConfig(f.directory, { version: 1, name: "test", region: "us-east-1", lambda: { functionName: "api" } });
  const cli = path.resolve(import.meta.dirname, "../src/index.ts");
  const loader = pathToFileURL(path.resolve(import.meta.dirname, "../node_modules/tsx/dist/loader.mjs")).href;
  for (const args of [
    ["--profile", "../invalid", "whoami"], ["login", "--profile", "../invalid"],
    ["lambda", "list", "--prefix", "api", "--profile", "../invalid"],
    ["lambda", "info", "api", "--profile", "../invalid"],
    ["pull", "api", "--profile", "../invalid"], ["push", "api", "--profile", "../invalid"],
  ]) {
    const result = spawnSync(process.execPath, ["--import", loader, cli, ...args], { cwd: f.directory, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid profile name/, args.join(" "));
  }
});
