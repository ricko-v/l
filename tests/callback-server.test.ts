import assert from "node:assert/strict";
import { test } from "node:test";
import { createCallbackServer } from "../src/auth/callback-server.js";

test("unrelated callbacks cannot cancel login; valid callback is not a success claim", async (t) => {
  const callback = await createCallbackServer("expected");
  t.after(() => callback.close());
  for (const query of ["code=test&state=wrong", "error=denied&state=wrong", "code=test", "state=expected"]) {
    const response = await fetch(`${callback.redirectUri}?${query}`);
    assert.equal(response.status, 400);
    await response.text();
  }
  const response = await fetch(`${callback.redirectUri}?code=test&state=expected`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(await response.text(), /terminal to check the login result/);
  assert.deepEqual(await callback.waitForCallback(), { code: "test", state: "expected" });
});

test("valid OAuth error rejects the pending login", async (t) => {
  const callback = await createCallbackServer("expected");
  t.after(() => callback.close());
  const rejected = assert.rejects(callback.waitForCallback(), /User declined/);
  const response = await fetch(`${callback.redirectUri}?error=denied&error_description=User+declined&state=expected`);
  assert.equal(response.status, 400);
  await response.text();
  await rejected;
});

test("timeout rejects login and releases the listening port", async (t) => {
  const callback = await createCallbackServer("expected", { timeoutMs: 25 });
  t.after(() => callback.close());
  await assert.rejects(callback.waitForCallback(), /timed out/);
  await assert.rejects(fetch(callback.redirectUri));
});

test("cleanup before a callback cancels waiting and is repeatable", async () => {
  const callback = await createCallbackServer("expected");
  callback.close();
  callback.close();
  await assert.rejects(callback.waitForCallback(), /cancelled/);
  await assert.rejects(fetch(callback.redirectUri));
});
