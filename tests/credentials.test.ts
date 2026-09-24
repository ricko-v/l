import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test, type TestContext } from "node:test";
import { AccessDeniedException, OAuth2ErrorCode, SigninClient } from "@aws-sdk/client-signin";
import { createDpopKey } from "../src/auth/dpop.js";
import { getCredentials } from "../src/auth/credentials.js";
import { SESSION_PATH } from "../src/config/paths.js";

function fixture(t: TestContext, expiresAt = "2020-01-01T00:00:00.000Z") {
  const session = {
    accessKeyId: "fake-access", secretAccessKey: "fake-secret", sessionToken: "fake-session",
    refreshToken: "fake-refresh", dpopPrivateKey: createDpopKey().privateKeyPem,
    region: "ap-southeast-1", clientId: "fake-client", expiresAt,
  };
  const originalReadFile = fs.readFile.bind(fs);
  t.mock.method(fs, "readFile", (...args: Parameters<typeof fs.readFile>) => {
    if (args[0] === SESSION_PATH) return Promise.resolve(JSON.stringify(session));
    return originalReadFile(...args);
  });
  // Any attempt to persist or remove the real global session fails this test.
  const writes = ["mkdir", "chmod", "open", "rename", "rm"].map((method) =>
    t.mock.method(fs, method as "mkdir", () => assert.fail(`Unexpected session mutation: ${method}`)),
  );
  const output: string[] = [];
  t.mock.method(console, "log", (message: string) => output.push(message));
  const destroy = t.mock.method(SigninClient.prototype, "destroy", () => {});
  return { session, output, destroy, writes };
}

test("expired refresh token returns actionable login instructions without writing or returning stale credentials", async (t) => {
  const { output, destroy, writes } = fixture(t);
  const failure = new AccessDeniedException({
    message: "The refresh token has expired.", error: OAuth2ErrorCode.TOKEN_EXPIRED, $metadata: { httpStatusCode: 401 },
  });
  const send = t.mock.method(SigninClient.prototype, "send", async function (this: SigninClient, command: { input: { tokenInput: unknown } }) {
    assert.equal(await this.config.region(), "ap-southeast-1");
    assert.deepEqual(command.input.tokenInput, { clientId: "fake-client", grantType: "refresh_token", refreshToken: "fake-refresh" });
    throw failure;
  });
  await assert.rejects(getCredentials(), (error: Error) => {
    assert.match(error.message, /AWS session expired/);
    assert.match(error.message, /Run `l login --profile default`/);
    assert.match(error.message, /retry your command/);
    assert.equal(error.cause, failure);
    return true;
  });
  assert.equal(send.mock.callCount(), 1);
  assert.equal(destroy.mock.callCount(), 1);
  assert.deepEqual(output, ["Refreshing AWS session..."]);
  writes.forEach((write) => assert.equal(write.mock.callCount(), 0));
});

test("OAuth TOKEN_EXPIRED is recognized even when AWS changes the message", async (t) => {
  fixture(t);
  t.mock.method(SigninClient.prototype, "send", async () => {
    throw new AccessDeniedException({ message: "Please authenticate.", error: OAuth2ErrorCode.TOKEN_EXPIRED, $metadata: {} });
  });
  await assert.rejects(getCredentials(), /Run `l login --profile default`/);
});

test("message-only expired refresh token responses also guide the user to login", async (t) => {
  fixture(t);
  t.mock.method(SigninClient.prototype, "send", async () => { throw new Error("The refresh token has expired."); });
  await assert.rejects(getCredentials(), /Run `l login --profile default`/);
});

test("network, permission, and other token failures retain their original error", async (t) => {
  const { destroy } = fixture(t);
  const failures = [
    new Error("Connection timed out"),
    new AccessDeniedException({ message: "Access denied", error: OAuth2ErrorCode.INSUFFICIENT_PERMISSIONS, $metadata: {} }),
    new Error("The authorization code has expired."),
    new Error("The access token has expired."),
  ];
  let nextFailure: Error;
  t.mock.method(SigninClient.prototype, "send", async () => { throw nextFailure; });
  for (const failure of failures) {
    nextFailure = failure;
    await assert.rejects(getCredentials(), (error) => error === failure);
  }
  assert.equal(destroy.mock.callCount(), failures.length);
});

test("unexpired credentials do not attempt refresh", async (t) => {
  const { session, output } = fixture(t, new Date(Date.now() + 3_600_000).toISOString());
  const send = t.mock.method(SigninClient.prototype, "send", () => assert.fail("Unexpected refresh"));
  assert.deepEqual(await getCredentials(), {
    accessKeyId: session.accessKeyId, secretAccessKey: session.secretAccessKey,
    sessionToken: session.sessionToken, expiration: new Date(session.expiresAt),
  });
  assert.equal(send.mock.callCount(), 0);
  assert.deepEqual(output, []);
});
