import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isProfileName } from "./profiles.js";

export const PROJECT_CONFIG_FILE = "l.config.json";

export interface ProjectConfig {
  version: 1;
  name: string;
  region: string;
  profile?: string;
  lambda?: { functionName: string; prefix?: never } | { prefix: string; functionName?: never };
}

export function isRegion(value: string): boolean {
  return /^[a-z]{2,}(?:-[a-z]+)+-\d+$/.test(value);
}

export function isFunctionName(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validateProjectConfig(value: unknown): asserts value is ProjectConfig {
  const invalid = (reason: string): never => {
    throw new Error(`Invalid ${PROJECT_CONFIG_FILE}: ${reason}`);
  };
  if (!isRecord(value)) return invalid("expected an object.");
  if (Object.keys(value).some((key) => !["version", "name", "region", "profile", "lambda"].includes(key))) {
    return invalid("unknown fields are not allowed; credentials belong in the global session.");
  }
  if (value.version !== 1) return invalid("version must be 1.");
  if (typeof value.name !== "string" || !value.name.trim()) return invalid("name is required.");
  if (typeof value.region !== "string" || !isRegion(value.region)) return invalid("region format is invalid.");
  if (value.profile !== undefined && !isProfileName(value.profile)) return invalid("profile must contain 1–64 lowercase letters, digits, underscores or hyphens, starting with a letter or digit.");
  if (value.lambda !== undefined) {
    if (!isRecord(value.lambda)) return invalid("lambda must be an object.");
    const keys = Object.keys(value.lambda);
    if (keys.length !== 1) return invalid("lambda must contain either functionName or prefix.");
    const key = keys[0];
    const entry = value.lambda[key!];
    if (!["functionName", "prefix"].includes(key!) || typeof entry !== "string" || !isFunctionName(entry)) {
      return invalid("Lambda names and prefixes must contain 1–64 letters, digits, underscores or hyphens.");
    }
  }
}

export async function readProjectConfig(directory: string) {
  const configPath = path.join(directory, PROJECT_CONFIG_FILE);
  let contents: string;
  try {
    contents = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let config: unknown;
  try {
    config = JSON.parse(contents);
  } catch {
    throw new Error(`Invalid ${PROJECT_CONFIG_FILE}: malformed JSON at ${configPath}. Fix the file before continuing.`);
  }
  validateProjectConfig(config);
  return { config, contents, path: configPath };
}

export async function findProjectConfig(startDirectory = process.cwd()) {
  return (await findProject(startDirectory))?.config ?? null;
}

export async function findProject(startDirectory = process.cwd()) {
  let directory = path.resolve(startDirectory);
  while (true) {
    const found = await readProjectConfig(directory);
    if (found) return { directory, config: found.config };
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export async function saveProjectConfig(
  directory: string,
  config: ProjectConfig,
  previousContents: string | null = null,
) {
  validateProjectConfig(config);
  const destination = path.join(directory, PROJECT_CONFIG_FILE);
  const temporary = path.join(directory, `.l.config-${randomUUID()}.tmp`);
  try {
    const file = await fs.open(temporary, "wx", 0o644);
    try {
      await file.writeFile(`${JSON.stringify(config, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    if (previousContents === null) {
      // Publishing with a hard link fails if another process has created the config.
      await fs.link(temporary, destination);
    } else {
      const current = await fs.readFile(destination, "utf8");
      if (current !== previousContents) {
        throw new Error(`${PROJECT_CONFIG_FILE} changed during initialization. Run \`l init\` again.`);
      }
      await fs.rename(temporary, destination);
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
