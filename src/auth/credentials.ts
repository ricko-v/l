import type { AwsCredentialIdentity } from "@aws-sdk/types";

import {
  CreateOAuth2TokenCommand,
  OAuth2ErrorCode,
  type CreateOAuth2TokenCommandOutput,
} from "@aws-sdk/client-signin";

import { getSession, saveSession, type AuthSession } from "./session-store.js";
import { DEFAULT_PROFILE, resolveProfile, loginHint } from "../config/profiles.js";

import { createSigninClient } from "./signin-client.js";

const EXPIRY_BUFFER = 60 * 1000;

function isExpiredSoon(expiresAt: string) {
  return Date.now() >= new Date(expiresAt).getTime() - EXPIRY_BUFFER;
}

function isRefreshTokenExpired(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "error" in error ? error.error : undefined;
  if (code !== undefined) return code === OAuth2ErrorCode.TOKEN_EXPIRED;

  // Some responses only contain the service message, without an OAuth error code.
  return "message" in error && typeof error.message === "string"
    && /\brefresh token (?:has |is )?expired\b/i.test(error.message);
}

async function refreshCredentials(profile: string) {
  const session = await getSession(profile);

  if (!session) {
    throw new Error(`Not authenticated for profile "${profile}". Run \`${loginHint(profile)}\` first.`);
  }

  console.log(profile === DEFAULT_PROFILE ? "Refreshing AWS session..." : `Refreshing AWS session (${profile})...`);

  // ✅ menggunakan DPoP private key
  // yang sama dengan saat login
  const signin = createSigninClient(session.region, session.dpopPrivateKey);

  let response: CreateOAuth2TokenCommandOutput;
  try {
    response = await signin.send(
      new CreateOAuth2TokenCommand({
        tokenInput: {
          clientId: session.clientId,
          grantType: "refresh_token",
          refreshToken: session.refreshToken,
        },
      }),
    );
  } catch (error) {
    if (isRefreshTokenExpired(error)) {
      throw new Error(
        `AWS session expired for profile "${profile}": the refresh token has expired. Run \`${loginHint(profile)}\` to sign in again, then retry your command.`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    signin.destroy();
  }

  const output = response.tokenOutput;

  const credentials = output?.accessToken;

  if (
    !credentials?.accessKeyId ||
    !credentials.secretAccessKey ||
    !credentials.sessionToken ||
    !output?.refreshToken
  ) {
    throw new Error("AWS did not return refreshed credentials.");
  }

  const expiresAt = new Date(
    Date.now() + (output.expiresIn ?? 900) * 1000,
  ).toISOString();

  const newSession = {
    ...session,

    accessKeyId: credentials.accessKeyId,

    secretAccessKey: credentials.secretAccessKey,

    sessionToken: credentials.sessionToken,

    expiresAt,

    // sangat penting:
    // refresh token dirotate
    refreshToken: output.refreshToken,
  };

  await saveSession(newSession, profile);

  console.log("AWS session refreshed.");

  return newSession;
}

const refreshing = new Map<string, Promise<AuthSession>>();

export async function getCredentials(profile = DEFAULT_PROFILE): Promise<AwsCredentialIdentity> {
  profile = resolveProfile(profile);
  let session = await getSession(profile);

  if (!session) {
    throw new Error(`Not authenticated for profile "${profile}". Run \`${loginHint(profile)}\` first.`);
  }

  if (isExpiredSoon(session.expiresAt)) {
    let pending = refreshing.get(profile);
    if (!pending) {
      pending = refreshCredentials(profile).finally(() => { refreshing.delete(profile); });
      refreshing.set(profile, pending);
    }
    session = await pending;
  }

  return {
    accessKeyId: session.accessKeyId,

    secretAccessKey: session.secretAccessKey,

    sessionToken: session.sessionToken,

    expiration: new Date(session.expiresAt),
  };
}
