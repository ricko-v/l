import { Command } from "commander";
import { createRequire } from "node:module";
import { initCommand } from "./commands/init.js";
import { syncCommand } from "./commands/sync.js";
import { PromptCancelledError } from "./cli/prompts.js";

import { loginCommand } from "./commands/login.js";
import { whoamiCommand } from "./commands/whoami.js";
import { lambdaListCommand } from "./commands/lambda/list.js";
import { lambdaInfoCommand } from "./commands/lambda/info.js";

const program = new Command();

const { version } = createRequire(import.meta.url)("../package.json");
program.name("l").description("AWS Lambda maintenance CLI").version(version);
program.option("--profile <name>", "Override the project auth profile (default: default)");
program.configureHelp({ showGlobalOptions: true });

for (const action of ["pull", "push"] as const) {
  program.command(`${action} [names...]`)
    .description(action === "pull" ? "Download Lambda code to this project" : "Upload local code to Lambda $LATEST")
    .option("-r, --region <region>", "Override the project resource region")
    .option("--dry-run", "Preview changes without applying them")
    .option("--all", "Target every matching function (AWS for pull, local folders for push)")
    .option("-p, --prefix <prefix>", "Target all function names starting with this prefix")
    .option("-y, --yes", "Skip normal confirmation (conflicts and first push still require review)")
    .action(async (name, _options, command) => {
      try { await syncCommand(action, name, command.optsWithGlobals()); }
      catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = error instanceof PromptCancelledError ? 130 : 1;
      }
    });
}

program
  .command("init")
  .description("Interactively configure this project in l.config.json")
  .action(async (_options, command) => {
    try {
      await initCommand({}, command.optsWithGlobals());
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = error instanceof PromptCancelledError ? 130 : 1;
    }
  });

program
  .command("login")
  .description("Authenticate with AWS")
  .option("-r, --region <region>", "AWS sign-in region (defaults to AWS_REGION/AWS_DEFAULT_REGION)")
  .action(async (_options, command) => {
    try {
      await loginCommand(command.optsWithGlobals());
    } catch (error) {
      console.error("");

      console.error(error instanceof Error ? error.message : error);

      process.exitCode = 1;
    }
  });

program
  .command("whoami")
  .description("Show current AWS identity")
  .action(async (_options, command) => {
    try {
      await whoamiCommand(command.optsWithGlobals());
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);

      process.exitCode = 1;
    }
  });

const lambda = program.command("lambda").description("Manage AWS Lambda");

lambda
  .command("list")
  .description("List Lambda functions")
  .option("-p, --prefix <prefix>", "Filter Lambda functions by name prefix")
  .option("-r, --region <region>", "Override the project resource region")
  .action(async (_options, command) => {
    try {
      await lambdaListCommand(command.optsWithGlobals());
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);

      process.exitCode = 1;
    }
  });

lambda
  .command("info [name]")
  .description("Show Lambda function details")
  .option("-r, --region <region>", "Override the project resource region")
  .action(async (name, _options, command) => {
    try {
      await lambdaInfoCommand(name, command.optsWithGlobals());
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);

      process.exitCode = 1;
    }
  });

await program.parseAsync();
