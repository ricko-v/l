import http from "node:http";

export interface CallbackResult {
  code: string;
  state: string;
}

export async function createCallbackServer(
  expectedState: string,
  { timeoutMs = 5 * 60 * 1000 }: { timeoutMs?: number } = {},
) {
  let resolveCallback!: (value: CallbackResult) => void;
  let rejectCallback!: (reason: Error) => void;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  // The browser may fail before the caller starts waiting for the callback.
  void callbackPromise.catch(() => {});

  function fail(error: Error) {
    if (!settled) {
      settled = true;
      clearTimeout(timer);
      rejectCallback(error);
    }
    server.close();
    server.closeAllConnections();
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");

    if (url.pathname !== "/oauth/callback") {
      res.writeHead(404).end("Not Found");
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET" }).end("Method Not Allowed");
      return;
    }
    if (settled) {
      res.writeHead(409).end("Callback already received.");
      return;
    }

    const state = url.searchParams.get("state");
    if (state !== expectedState) {
      // Ignore unrelated callbacks so they cannot cancel the real login.
      res.writeHead(400).end("OAuth state mismatch.");
      return;
    }

    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (!error && !code) {
      res.writeHead(400).end("Missing authorization code.");
      return;
    }

    settled = true;
    clearTimeout(timer);
    if (error) {
      res.writeHead(400).end("AWS authentication failed. Return to the terminal.");
      rejectCallback(new Error(url.searchParams.get("error_description") ?? error));
    } else {
      res.writeHead(200).end(
        "Authorization response received. Return to the terminal to check the login result. You can close this window.",
      );
      resolveCallback({ code: code!, state });
    }
    server.close();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  server.on("error", fail);

  const address = server.address();
  if (!address || typeof address === "string") {
    const error = new Error("Failed to create callback server.");
    fail(error);
    throw error;
  }

  timer = setTimeout(() => {
    fail(new Error("AWS login timed out. Run `l login` to try again."));
  }, timeoutMs);

  return {
    redirectUri: `http://127.0.0.1:${address.port}/oauth/callback`,
    waitForCallback: () => callbackPromise,
    close() {
      fail(new Error("AWS login cancelled."));
    },
  };
}
