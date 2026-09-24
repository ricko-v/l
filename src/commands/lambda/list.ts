import { paginateListFunctions } from "@aws-sdk/client-lambda";

import { createLambdaClient } from "../../aws/lambda.js";
import { findProjectConfig } from "../../config/project.js";
import { resolveProfile } from "../../config/profiles.js";

interface LambdaListOptions {
  prefix?: string;
  region?: string;
  profile?: string;
}

export async function lambdaListCommand(options: LambdaListOptions = {}) {
  const project = await findProjectConfig();
  const prefix = options.prefix ?? project?.lambda?.prefix;
  const profile = resolveProfile(options.profile, project?.profile);
  const client = await createLambdaClient(options.region ?? project?.region, profile);

  const functions = [];

  const paginator = paginateListFunctions(
    {
      client,
    },
    {},
  );

  for await (const page of paginator) {
    if (page.Functions) {
      functions.push(...page.Functions);
    }
  }

  const filteredFunctions = prefix
    ? functions.filter((fn) => fn.FunctionName?.startsWith(prefix))
    : functions;

  if (!filteredFunctions.length) {
    console.log(
      prefix
        ? `No Lambda functions found with prefix "${prefix}".`
        : "No Lambda functions found.",
    );

    return;
  }

  console.table(
    filteredFunctions.map((fn) => ({
      name: fn.FunctionName,
      runtime: fn.Runtime,
      memory: `${fn.MemorySize} MB`,
      timeout: `${fn.Timeout}s`,
    })),
  );
}
