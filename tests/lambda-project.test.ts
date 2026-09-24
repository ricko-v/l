import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { SESSION_PATH } from "../src/config/paths.js";
import { saveProjectConfig, type ProjectConfig } from "../src/config/project.js";
import { lambdaInfoCommand } from "../src/commands/lambda/info.js";
import { lambdaListCommand } from "../src/commands/lambda/list.js";

async function fixture(t: TestContext, config?: ProjectConfig) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "l-lambda-project-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  if (config) await saveProjectConfig(directory, config);
  t.mock.method(process, "cwd", () => directory);
  const originalReadFile = fs.readFile.bind(fs);
  t.mock.method(fs, "readFile", (...args: Parameters<typeof fs.readFile>) => {
    if (args[0] !== SESSION_PATH) return originalReadFile(...args);
    return Promise.resolve(JSON.stringify({
      accessKeyId: "global-access", secretAccessKey: "global-secret", sessionToken: "global-token",
      refreshToken: "fake", dpopPrivateKey: "fake", clientId: "fake",
      region: "ap-southeast-1", expiresAt: "2030-01-01T00:00:00.000Z",
    }));
  });
  t.mock.method(console, "log", () => {});
}

test("info uses project defaults and explicit name/region override them", async (t) => {
  await fixture(t, { version: 1, name: "billing", region: "us-east-1", lambda: { functionName: "project-api" } });
  const requests: Array<{ name: string; region: string }> = [];
  t.mock.method(LambdaClient.prototype, "send", async function (this: LambdaClient, command: { input: { FunctionName: string } }) {
    requests.push({ name: command.input.FunctionName, region: await this.config.region() });
    assert.equal((await this.config.credentials()).accessKeyId, "global-access");
    return { Configuration: { FunctionName: command.input.FunctionName } };
  });
  t.mock.method(console, "table", () => {});
  await lambdaInfoCommand();
  await lambdaInfoCommand("override-api", { region: "eu-west-1" });
  assert.deepEqual(requests, [
    { name: "project-api", region: "us-east-1" },
    { name: "override-api", region: "eu-west-1" },
  ]);
});

test("list uses project prefix, explicit override, and allows an empty prefix to show all", async (t) => {
  await fixture(t, { version: 1, name: "billing", region: "us-east-1", lambda: { prefix: "billing-" } });
  const regions: string[] = [];
  t.mock.method(LambdaClient.prototype, "send", async function (this: LambdaClient) {
    regions.push(await this.config.region());
    return { Functions: [{ FunctionName: "billing-api" }, { FunctionName: "other-api" }] };
  });
  const output: string[][] = [];
  t.mock.method(console, "table", (rows: { name: string }[]) => output.push(rows.map((row) => row.name)));
  await lambdaListCommand();
  await lambdaListCommand({ prefix: "other-", region: "eu-west-1" });
  await lambdaListCommand({ prefix: "" });
  assert.deepEqual(output, [["billing-api"], ["other-api"], ["billing-api", "other-api"]]);
  assert.deepEqual(regions, ["us-east-1", "eu-west-1", "us-east-1"]);
});

test("commands without project config retain the global session region", async (t) => {
  await fixture(t);
  t.mock.method(LambdaClient.prototype, "send", async function (this: LambdaClient) {
    assert.equal(await this.config.region(), "ap-southeast-1");
    return { Functions: [] };
  });
  await lambdaListCommand();
  await assert.rejects(lambdaInfoCommand(), /Specify a Lambda function name/);
  await assert.rejects(lambdaListCommand({ region: "bad-region" }), /Invalid AWS region/);
});
