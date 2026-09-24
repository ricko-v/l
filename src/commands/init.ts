import fs from "node:fs/promises";
import path from "node:path";
import { paginateListFunctions } from "@aws-sdk/client-lambda";
import { createLambdaClient } from "../aws/lambda.js";
import { getSession } from "../auth/session-store.js";
import { DEFAULT_REGION } from "../auth/constanta.js";
import { isProfileName, resolveProfile, loginHint } from "../config/profiles.js";
import { createPrompts, type InitPrompts } from "../cli/prompts.js";
import {
  PROJECT_CONFIG_FILE, isRegion, isFunctionName, readProjectConfig,
  saveProjectConfig, type ProjectConfig,
} from "../config/project.js";

export async function listFunctionNames(region: string, profile?: string): Promise<string[]> {
  const client = await createLambdaClient(region, profile);
  try {
    const names: string[] = [];
    for await (const page of paginateListFunctions({ client }, {})) {
      for (const fn of page.Functions ?? []) {
        if (fn.FunctionName) names.push(fn.FunctionName);
      }
    }
    return [...new Set(names)].sort();
  } finally {
    client.destroy();
  }
}

async function defaultProjectName(directory: string) {
  try {
    const pkg: unknown = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8"));
    if (pkg && typeof pkg === "object" && "name" in pkg && typeof pkg.name === "string" && pkg.name.trim()) {
      return pkg.name.trim();
    }
  } catch {
    // package.json is optional metadata; initializing other types of project is supported.
  }
  return path.basename(directory);
}

interface InitDependencies {
  directory?: string;
  prompts?: InitPrompts;
  session?: typeof getSession;
  functions?: typeof listFunctionNames;
  log?: (message: string) => void;
}

export async function initCommand(dependencies: InitDependencies = {}, options: { profile?: string } = {}) {
  const directory = path.resolve(dependencies.directory ?? process.cwd());
  const prompts = dependencies.prompts ?? createPrompts();
  const log = dependencies.log ?? console.log;
  try {
    log(`Initialize project in ${directory}`);
    const existing = await readProjectConfig(directory);
    if (existing && !await prompts.confirm(`${PROJECT_CONFIG_FILE} already exists. Update it?`)) {
      log("Initialization cancelled. No configuration saved.");
      return;
    }

    const selectedProfile = resolveProfile(options.profile, existing?.config.profile);
    const profile = options.profile !== undefined ? selectedProfile : await prompts.input("AWS profile", selectedProfile, isProfileName);
    let session = null;
    try {
      session = await (dependencies.session ?? getSession)(profile);
    } catch {
      log(`Session for profile "${profile}" is unavailable. Manual configuration is still available; run \`${loginHint(profile)}\` to select from AWS.`);
    }
    const name = await prompts.input(
      "Project name", existing?.config.name ?? await defaultProjectName(directory),
      (value) => !!value.trim(),
    );
    const region = await prompts.input(
      "AWS resource region",
      existing?.config.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? session?.region ?? DEFAULT_REGION,
      isRegion,
    );
    const config: ProjectConfig = { version: 1, name, region, profile };
    let initialMode = existing?.config.lambda?.functionName ? 1 : existing?.config.lambda?.prefix ? 2 : session ? 0 : 1;
    while (true) {
      const mode = await prompts.select("Lambda configuration", [
        "Select existing function from AWS",
        "Enter function name manually",
        "Use a function name prefix",
        "Skip Lambda configuration",
      ], initialMode);
      if (mode === 0) {
        if (!session) {
          log(`Run \`${loginHint(profile)}\` first to select from AWS, or choose manual entry, prefix, or skip.`);
          initialMode = 1;
          continue;
        }
        let names: string[];
        try {
          log(`Loading Lambda functions in ${region}...`);
          names = await (dependencies.functions ?? listFunctionNames)(region, profile);
        } catch (error) {
          log(`Unable to list Lambda functions: ${error instanceof Error ? error.message : "AWS request failed."}`);
          log("Choose another configuration mode or cancel with Ctrl+C.");
          initialMode = 1;
          continue;
        }
        if (!names.length) {
          log(`No Lambda functions found in ${region}. Choose another configuration mode.`);
          initialMode = 1;
          continue;
        }
        const selected = await prompts.select("Lambda function", [...names, "Back"]);
        if (selected === names.length) continue;
        config.lambda = { functionName: names[selected]! };
      } else if (mode === 1) {
        config.lambda = { functionName: await prompts.input(
          "Lambda function name", existing?.config.lambda?.functionName ?? "", isFunctionName,
        ) };
      } else if (mode === 2) {
        config.lambda = { prefix: await prompts.input(
          "Lambda function prefix", existing?.config.lambda?.prefix ?? "", isFunctionName,
        ) };
      }
      break;
    }

    log(`\n${JSON.stringify(config, null, 2)}\n`);
    if (!await prompts.confirm(`Save ${PROJECT_CONFIG_FILE}?`, true)) {
      log("Initialization cancelled. No configuration saved.");
      return;
    }
    await saveProjectConfig(directory, config, existing?.contents ?? null);
    log(`Saved ${path.join(directory, PROJECT_CONFIG_FILE)}`);
    if (!session) log(`Next: run \`${loginHint(profile)}\` to authenticate with AWS.`);
    log(config.lambda?.functionName ? "Next: l lambda info" : "Next: l lambda list");
  } finally {
    prompts.close();
  }
}
