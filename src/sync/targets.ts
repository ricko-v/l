import fs from "node:fs/promises";
import path from "node:path";
import { isFunctionName, type ProjectConfig } from "../config/project.js";
import { directoryAt } from "./files.js";

export interface SyncOptions {
  profile?: string;
  region?: string;
  dryRun?: boolean;
  yes?: boolean;
  all?: boolean;
  prefix?: string;
}

interface TargetContext {
  action: "pull" | "push";
  root: string;
  config: ProjectConfig;
  list: () => Promise<string[]>;
  select: (names: string[]) => Promise<number>;
}

export async function resolveSyncTargets(
  input: string | string[] | undefined, options: SyncOptions, context: TargetContext,
): Promise<string[]> {
  let names = typeof input === "string" ? [input] : input ?? [];
  if (names.length && (options.all || options.prefix !== undefined)) {
    throw new Error("Use explicit function names or --all/--prefix, not both.");
  }
  if (options.prefix !== undefined && !isFunctionName(options.prefix)) {
    throw new Error("--prefix requires 1–64 letters, digits, underscores, or hyphens. Use --all for every function.");
  }
  if (options.all || options.prefix !== undefined) {
    const prefix = options.prefix ?? context.config.lambda?.prefix;
    if (context.action === "pull") {
      names = (await context.list()).filter((name) => prefix === undefined || name.startsWith(prefix));
    } else {
      if (!await directoryAt(context.root, "lambda")) throw new Error("No local function folders found. Run pull first.");
      const entries = await fs.readdir(path.join(context.root, "lambda"), { withFileTypes: true });
      names = entries.filter((entry) => (entry.isDirectory() || entry.isSymbolicLink())
        && (prefix === undefined || entry.name.startsWith(prefix))).map((entry) => entry.name);
    }
    names.sort();
  } else if (!names.length) {
    if (context.config.lambda?.functionName) names = [context.config.lambda.functionName];
    else if (context.config.lambda?.prefix) {
      const prefix = context.config.lambda.prefix;
      const candidates = [...new Set(await context.list())].filter((name) => name.startsWith(prefix)).sort();
      if (!candidates.length) throw new Error("No Lambda functions match the configured prefix.");
      names = [candidates[await context.select(candidates)]!];
    }
  }
  names = [...new Set(names)];
  if (!names.length) throw new Error("No matching functions. Specify names, adjust the prefix, or run `l init`.");
  if (names.some((name) => !name || !isFunctionName(name))) {
    throw new Error("Specify valid function names without ARN, version, or alias.");
  }
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    throw new Error("Selected function names differ only in letter case and would share a local directory.");
  }
  return names;
}
