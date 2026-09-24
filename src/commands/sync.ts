import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findProject, isRegion } from "../config/project.js";
import { resolveProfile } from "../config/profiles.js";
import { createPrompts, type InitPrompts } from "../cli/prompts.js";
import { createLambdaClient } from "../aws/lambda.js";
import { listFunctionNames } from "./init.js";
import { acquireLock, ignoreLocalState, readState } from "../sync/state.js";
import { awsRemote, type Remote } from "../sync/remote.js";
import { resolveSyncTargets, type SyncOptions } from "../sync/targets.js";
import { prepareSync, validatePrepared, applyPrepared, type PreparedSync, type OperationContext } from "../sync/operation.js";

export type { SyncOptions } from "../sync/targets.js";
interface SyncDependencies {
  directory?: string;
  prompts?: InitPrompts;
  remote?: Remote;
  functions?: typeof listFunctionNames;
  log?: (message: string) => void;
}

export interface SyncResult {
  name: string;
  status: "ready" | "unchanged" | "preview" | "success" | "failed" | "skipped" | "cancelled";
  error?: string;
}

export class SyncBatchError extends Error {
  constructor(message: string, public readonly results: SyncResult[]) {
    super(message);
  }
}

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : "Sync failed.";
}

function confirmation(action: "pull" | "push", plans: PreparedSync[]) {
  if (plans.length === 1) {
    const plan = plans[0]!;
    if (action === "pull") return plan.localChanged ? "Back up and replace local changes?" : "Apply this pull?";
    return `Update ${plan.current.arn} ($LATEST)${plan.firstPush ? " without a saved baseline" : ""}?`;
  }
  const extra = action === "pull"
    ? plans.filter((plan) => plan.localChanged).map((plan) => plan.name)
    : plans.filter((plan) => plan.firstPush).map((plan) => plan.name);
  const details = extra.length
    ? ` ${action === "pull" ? "Back up and replace local changes in" : "Without a saved baseline for"}: ${extra.join(", ")}.`
    : "";
  return `${action === "pull" ? "Pull" : "Update $LATEST for"} all ${plans.length} reviewed functions?${details}`;
}

export async function syncCommand(
  action: "pull" | "push", input?: string | string[], options: SyncOptions = {}, dependencies: SyncDependencies = {},
): Promise<SyncResult[]> {
  const project = await findProject(dependencies.directory);
  if (!project) throw new Error("No l.config.json found. Run `l init` in your project first.");
  const root = await fs.realpath(project.directory);
  const region = options.region ?? project.config.region;
  const profile = resolveProfile(options.profile, project.config.profile);
  if (!isRegion(region)) throw new Error("Invalid AWS region format.");
  const log = dependencies.log ?? console.log;
  let prompts = dependencies.prompts;
  const ask = () => prompts ??= createPrompts(action);
  let release: (() => Promise<void>) | undefined;
  let client: Awaited<ReturnType<typeof createLambdaClient>> | undefined;
  let staging: string | undefined;
  let results: SyncResult[] = [];
  const summarize = () => {
    if (results.length < 2) return;
    log(`\n${action.toUpperCase()} summary`);
    for (const result of results) log(`${result.name.padEnd(24)} ${result.status}${result.error ? ` — ${result.error}` : ""}`);
  };
  const fail = (error: unknown, message: string): never => {
    for (const result of results) if (result.status === "ready") result.status = "skipped";
    summarize();
    if (results.length === 1) throw error;
    throw new SyncBatchError(message, results);
  };

  try {
    log(`Profile: ${profile}`);
    const names = await resolveSyncTargets(input, options, {
      action, root, config: project.config,
      list: () => (dependencies.functions ?? listFunctionNames)(region, profile),
      select: (candidates) => ask().select("Select one Lambda function", candidates),
    });
    results = names.map((name) => ({ name, status: "ready" }));
    if (names.length > 1) log(`Preparing ${action} for ${names.length} functions: ${names.join(", ")}`);
    if (!options.dryRun) release = await acquireLock(root);
    const state = await readState(root);
    const remote = dependencies.remote ?? awsRemote(client = await createLambdaClient(region, profile));
    staging = await fs.mkdtemp(path.join(os.tmpdir(), "l-sync-packages-"));
    const context: OperationContext = { action, root, region, state, remote, staging, log };
    const plans: PreparedSync[] = [];
    let firstFailure: unknown;
    // Stage one package at a time on disk instead of keeping every ZIP in memory.
    for (const result of results) {
      try {
        const plan = await prepareSync(result.name, context);
        if (plan.localChanged && options.yes && !options.dryRun) {
          throw new Error("Local changes need explicit review. Run pull without --yes to confirm replacement and backup.");
        }
        plans.push(plan);
        if (plan.noChanges) result.status = "unchanged";
      } catch (error) {
        firstFailure ??= error;
        result.status = "failed";
        result.error = failureMessage(error);
      }
    }
    if (results.some((result) => result.status === "failed")) {
      fail(firstFailure, "Preflight failed. No function code or sync baseline was changed; fix the listed failures and retry.");
    }
    if (options.dryRun) {
      for (const result of results) if (result.status === "ready") result.status = "preview";
      log("Dry run: no function code, upload, sync-state, or .gitignore changes.");
      summarize();
      return results;
    }
    const pending = plans.filter((plan) => !plan.noChanges);
    if (!pending.length) {
      log("No code changes to push.");
      summarize();
      return results;
    }
    if ((!options.yes || pending.some((plan) => plan.firstPush)) && !await ask().confirm(confirmation(action, pending))) {
      for (const result of results) if (result.status === "ready") result.status = "cancelled";
      log(`${action === "pull" ? "Pull" : "Push"} cancelled. No function code was changed.`);
      summarize();
      return results;
    }
    // Check every approved target again before the first mutation, then per target during execution.
    for (const plan of pending) {
      try { await validatePrepared(plan, context); }
      catch (error) {
        const result = results.find((result) => result.name === plan.name)!;
        result.status = "failed";
        result.error = failureMessage(error);
        fail(error, "Targets changed after preview. No function code was changed; review the listed failure and retry.");
      }
    }
    await ignoreLocalState(root);
    for (const plan of pending) {
      const result = results.find((result) => result.name === plan.name)!;
      try {
        await applyPrepared(plan, context);
        result.status = "success";
      } catch (error) {
        result.status = "failed";
        result.error = failureMessage(error);
        fail(error, "Sync stopped after a failure. Successful functions remain applied; remaining functions were skipped. Check failed AWS updates before retrying.");
      }
    }
    summarize();
    return results;
  } finally {
    client?.destroy();
    prompts?.close();
    // Always release the project lock, including when removing package staging fails.
    try { if (staging) await fs.rm(staging, { recursive: true, force: true }); }
    finally { await release?.(); }
  }
}
