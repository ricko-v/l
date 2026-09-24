import assert from "node:assert/strict";
import { test } from "node:test";
import { GetFunctionCommand, UpdateFunctionCodeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { awsRemote, downloadPackage } from "../src/sync/remote.js";
import { sha256 } from "../src/sync/files.js";
import { ARN } from "./sync-fixtures.js";

test("AWS adapter pins code update to ARN + revision and does not publish a version", async (t) => {
  const client = new LambdaClient({ region: "us-east-1", credentials: { accessKeyId: "fake", secretAccessKey: "fake" } });
  t.after(() => client.destroy());
  let uploaded = false;
  const zip = Buffer.from("zip");
  t.mock.method(client, "send", async (command: GetFunctionCommand | UpdateFunctionCodeCommand) => {
    if (command instanceof UpdateFunctionCodeCommand) {
      assert.deepEqual(command.input, { FunctionName: ARN, RevisionId: "revision", ZipFile: zip, Publish: false });
      uploaded = true; return {};
    }
    return { Configuration: { PackageType: "Zip", FunctionArn: ARN, RevisionId: "revision", CodeSha256: sha256(zip), LastUpdateStatus: "Successful" } };
  });
  const remote = awsRemote(client);
  const current = await remote.get("api");
  await remote.update(current, zip);
  assert.ok(uploaded);
  assert.equal((await remote.wait(current)).status, "Successful");
});

test("AWS adapter rejects image packages", async (t) => {
  const client = new LambdaClient({ region: "us-east-1" });
  t.after(() => client.destroy());
  t.mock.method(client, "send", async () => ({ Configuration: { PackageType: "Image" } }));
  await assert.rejects(awsRemote(client).get("api"), /Only ZIP-based/);
});

test("download validates checksum and never includes signed URLs in its message", async (t) => {
  const zip = Buffer.from("downloaded zip bytes");
  const remote = { arn: ARN, revisionId: "r", codeSha256: sha256(zip), location: "https://example.invalid/code?signature=secret" };
  t.mock.method(globalThis, "fetch", async () => new Response(zip));
  assert.deepEqual(await downloadPackage(remote), zip);
  await assert.rejects(downloadPackage({ ...remote, codeSha256: "wrong" }), (error: Error) => {
    assert.match(error.message, /Unable to download or verify/);
    assert.ok(!error.message.includes("secret")); return true;
  });
  await assert.rejects(downloadPackage({ ...remote, location: "http://example.invalid/code" }), /HTTPS/);
});
