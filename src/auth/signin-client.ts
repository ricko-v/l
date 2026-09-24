import { SigninClient } from "@aws-sdk/client-signin";

import { loadDpopKey, createDpopProof } from "./dpop.js";

export function createSigninClient(region: string, dpopPrivateKey: string) {
  const privateKey = loadDpopKey(dpopPrivateKey);

  const client = new SigninClient({
    region,
  });

  client.middlewareStack.add(
    (next) => async (args: any) => {
      const request = args.request;

      const protocol = request.protocol ?? "https:";

      const hostname = request.hostname;

      const port = request.port ? `:${request.port}` : "";

      const url = `${protocol}//${hostname}` + `${port}${request.path}`;

      request.headers["DPoP"] = createDpopProof({
        privateKey,
        method: request.method,
        url,
      });

      return next(args);
    },
    {
      step: "build",
      name: "lDpopMiddleware",
      priority: "high",
    },
  );

  return client;
}
