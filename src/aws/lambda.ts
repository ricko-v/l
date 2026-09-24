import { LambdaClient } from "@aws-sdk/client-lambda";

import { getCredentials } from "../auth/credentials.js";
import { getSession } from "../auth/session-store.js";
import { isRegion } from "../config/project.js";
import { resolveProfile, loginHint } from "../config/profiles.js";

export async function createLambdaClient(resourceRegion?: string, selectedProfile?: string) {
  const profile = resolveProfile(selectedProfile);
  if (resourceRegion !== undefined && !isRegion(resourceRegion)) {
    throw new Error("Invalid AWS region format.");
  }
  const session = await getSession(profile);

  if (!session) {
    throw new Error(`Not authenticated for profile "${profile}". Run \`${loginHint(profile)}\` first.`);
  }

  return new LambdaClient({
    region: resourceRegion ?? session.region,
    credentials: () => getCredentials(profile),
  });
}
