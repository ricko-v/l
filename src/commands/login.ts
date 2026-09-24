import { randomUUID } from "node:crypto";
import open from "open";
import { CreateOAuth2TokenCommand } from "@aws-sdk/client-signin";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { AWS_SIGNIN_CLIENT_ID, DEFAULT_REGION } from "../auth/constanta.js";
import { createPkce } from "../auth/pkce.js";
import { createDpopKey } from "../auth/dpop.js";
import { createCallbackServer } from "../auth/callback-server.js";
import { saveSession } from "../auth/session-store.js";
import { createSigninClient } from "../auth/signin-client.js";
import { findProjectConfig, isRegion } from "../config/project.js";
import { resolveProfile } from "../config/profiles.js";

interface LoginDependencies {
  callback?: typeof createCallbackServer;
  openBrowser?: (url: string) => Promise<unknown>;
  save?: typeof saveSession;
}

export async function loginCommand(options: { profile?: string; region?: string } = {}, dependencies: LoginDependencies = {}) {
  const project = await findProjectConfig();
  const profile = resolveProfile(options.profile, project?.profile);
  const region = options.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? DEFAULT_REGION;
  if (!isRegion(region)) throw new Error("Invalid AWS region format.");
  console.log(`Authenticating with AWS (${region}), profile: ${profile}...`);
  const state = randomUUID();
  const { verifier, challenge } = createPkce();
  const dpop = createDpopKey();
  const callback = await (dependencies.callback ?? createCallbackServer)(state);
  let signin: ReturnType<typeof createSigninClient> | undefined;
  let sts: STSClient | undefined;
  try {
    const authorizationUrl = new URL(`https://${region}.signin.aws.amazon.com/v1/authorize`);
    authorizationUrl.search = new URLSearchParams({
      response_type: "code", client_id: AWS_SIGNIN_CLIENT_ID, state,
      code_challenge_method: "SHA-256", code_challenge: challenge,
      scope: "openid", redirect_uri: callback.redirectUri,
    }).toString();
    console.log("Opening AWS Sign-In...");
    console.log(authorizationUrl.toString());
    const [, result] = await Promise.all([
      Promise.resolve().then(() => (dependencies.openBrowser ?? open)(authorizationUrl.toString())).catch(() => {
        console.warn("Could not open a browser automatically. Open the URL above in a browser on this computer; waiting for AWS Sign-In...");
      }), callback.waitForCallback(),
    ]);
    if (result.state !== state) throw new Error("OAuth state mismatch.");
    console.log("Exchanging authorization code...");
    signin = createSigninClient(region, dpop.privateKeyPem);
    const token = await signin.send(new CreateOAuth2TokenCommand({
      tokenInput: { clientId: AWS_SIGNIN_CLIENT_ID, grantType: "authorization_code", code: result.code,
        codeVerifier: verifier, redirectUri: callback.redirectUri },
    }));
    const output = token.tokenOutput;
    const credentials = output?.accessToken;
    if (!credentials?.accessKeyId || !credentials.secretAccessKey || !credentials.sessionToken || !output?.refreshToken) {
      throw new Error("AWS did not return credentials.");
    }
    sts = new STSClient({ region, credentials: {
      accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey, sessionToken: credentials.sessionToken,
    } });
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    if (!identity.Account || !identity.Arn) throw new Error("AWS did not return an account and identity.");
    const expiresIn = output.expiresIn ?? 900;
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("AWS returned an invalid session expiry.");
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    await (dependencies.save ?? saveSession)({
      accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey, sessionToken: credentials.sessionToken,
      expiresAt, refreshToken: output.refreshToken, idToken: output.idToken, dpopPrivateKey: dpop.privateKeyPem,
      clientId: AWS_SIGNIN_CLIENT_ID, region, accountId: identity.Account, arn: identity.Arn,
    }, profile);
    console.log("\n✓ Authentication successful\n");
    console.log(`Profile   ${profile}`);
    console.log(`Account   ${identity.Account}`);
    console.log(`Identity  ${identity.Arn}`);
    console.log(`Region    ${region}`);
    console.log(`Expires   ${expiresAt}`);
  } finally {
    signin?.destroy();
    sts?.destroy();
    callback.close();
  }
}
