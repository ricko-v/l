import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { STSClient } from "@aws-sdk/client-sts";
import { SESSION_PATH } from "../src/config/paths.js";
import { whoamiCommand } from "../src/commands/whoami.js";

test("whoami prints expiration from the credentials used by STS", async (t) => {
  const previousExpiry = "2020-01-01T00:00:00.000Z";
  const refreshedExpiry = "2030-01-01T00:00:00.000Z";
  const originalReadFile = fs.readFile.bind(fs);
  t.mock.method(fs, "readFile", async (...args: Parameters<typeof fs.readFile>) => {
    if (args[0] !== SESSION_PATH) return originalReadFile(...args);
    return JSON.stringify({
      accessKeyId: "fake", secretAccessKey: "fake", sessionToken: "fake",
      refreshToken: "fake", dpopPrivateKey: "fake", clientId: "fake",
      region: "ap-southeast-1", expiresAt: previousExpiry,
    });
  });
  t.mock.method(STSClient.prototype, "send", async function (this: STSClient) {
    this.config.credentials = async () => ({
      accessKeyId: "refreshed", secretAccessKey: "refreshed",
      expiration: new Date(refreshedExpiry),
    });
    return { Account: "test-account", Arn: "test-arn" };
  });
  const output: string[] = [];
  t.mock.method(console, "log", (line: string) => output.push(line));
  await whoamiCommand();
  assert.ok(output.includes(`Expires   ${refreshedExpiry}`));
  assert.ok(!output.some((line) => line.includes(previousExpiry)));
});
