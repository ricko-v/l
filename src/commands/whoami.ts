import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

import { getCredentials } from "../auth/credentials.js";
import { getSession } from "../auth/session-store.js";
import { findProjectConfig } from "../config/project.js";
import { resolveProfile, loginHint } from "../config/profiles.js";

export async function whoamiCommand(options: { profile?: string } = {}) {
  const project = await findProjectConfig();
  const profile = resolveProfile(options.profile, project?.profile);
  const session = await getSession(profile);

  if (!session) {
    throw new Error(`Not authenticated for profile "${profile}". Run \`${loginHint(profile)}\` first.`);
  }

  const sts = new STSClient({
    region: session.region,
    credentials: () => getCredentials(profile),
  });

  try {
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    const credentials = await sts.config.credentials();
    console.log("");
    console.log(`Profile   ${profile}`);
    console.log(`Account   ${identity.Account}`);
    console.log(`Identity  ${identity.Arn}`);
    console.log(`Region    ${session.region}`);
    console.log(`Expires   ${credentials.expiration?.toISOString() ?? "Unknown"}`);
  } finally { sts.destroy(); }
}
