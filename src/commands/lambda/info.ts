import { GetFunctionCommand } from "@aws-sdk/client-lambda";

import { createLambdaClient } from "../../aws/lambda.js";
import { findProjectConfig } from "../../config/project.js";
import { resolveProfile } from "../../config/profiles.js";

export async function lambdaInfoCommand(name?: string, options: { region?: string; profile?: string } = {}) {
  const project = await findProjectConfig();
  name = name ?? project?.lambda?.functionName;
  if (!name) {
    throw new Error("Specify a Lambda function name or run `l init` to configure one.");
  }
  const profile = resolveProfile(options.profile, project?.profile);
  const client = await createLambdaClient(options.region ?? project?.region, profile);

  const response = await client.send(
    new GetFunctionCommand({
      FunctionName: name,
    }),
  );

  const config = response.Configuration;

  if (!config) {
    throw new Error(`Lambda "${name}" not found.`);
  }

  console.table({
    Name: config.FunctionName,
    Runtime: config.Runtime,
    Handler: config.Handler,
    Memory: `${config.MemorySize} MB`,
    Timeout: `${config.Timeout}s`,
    Architecture: config.Architectures?.join(", "),
    State: config.State,
    LastUpdateStatus: config.LastUpdateStatus,
    LastModified: config.LastModified,
    Role: config.Role,
  });
}
