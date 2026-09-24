import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { directoryAt, readFiles, manifest, diff, writeFiles, sha256, type Files, type Manifest } from "./files.js";
import { packageFilter, packArchive, unpackArchive } from "./archive.js";
import { readState, saveState, atomicText, type SyncEntry, type SyncState } from "./state.js";
import type { Remote, RemoteFunction } from "./remote.js";

export interface OperationContext {
  action: "pull" | "push";
  root: string;
  region: string;
  state: SyncState;
  remote: Remote;
  staging: string;
  log: (message: string) => void;
}

export interface PreparedSync {
  name: string;
  current: RemoteFunction;
  existed: boolean;
  before: Manifest;
  after: Manifest;
  archive: string;
  archiveHash: string;
  changes: number;
  localChanged: boolean;
  firstPush: boolean;
  noChanges: boolean;
}

function ready(remote: RemoteFunction) {
  if (remote.status === "InProgress" || remote.state === "Pending") {
    throw new Error("Lambda is being updated. Wait for the current operation to finish, then retry.");
  }
}

export async function prepareSync(name: string, context: OperationContext): Promise<PreparedSync> {
  const { action, root, region, state, remote, staging, log } = context;
  if (await directoryAt(root, "lambda")) {
    const names = await fs.readdir(path.join(root, "lambda"));
    if (names.some((candidate) => candidate !== name && candidate.toLowerCase() === name.toLowerCase())) {
      throw new Error("Function directory conflicts with another name differing only in letter case.");
    }
  }
  const existed = await directoryAt(root, `lambda/${name}`);
  if (action === "push" && !existed) throw new Error(`No local code at lambda/${name}. Run pull first or prepare the deployment files there.`);
  const previous = Object.hasOwn(state.functions, name) ? state.functions[name] : undefined;
  const current = await remote.get(name);
  const arn = current.arn.split(":");
  if (arn[3] !== region || arn[5] !== "function" || arn[6] !== name || arn.length !== 7 || !/^\d{12}$/.test(arn[4] ?? "")) {
    throw new Error("AWS returned a function identity that does not match the requested target.");
  }
  if (previous && previous.arn !== current.arn) {
    throw new Error("Account or region differs from this folder's sync history. Use the original login/region or a separate project folder.");
  }
  ready(current);
  log(`\n${action.toUpperCase()} ${name}\nAccount: ${arn[4]}\nRegion: ${region}\nTarget: ${current.arn}\nLocal: ${path.join(root, "lambda", name)}`);
  if (action === "push" && previous && (previous.revisionId !== current.revisionId || previous.codeSha256 !== current.codeSha256)) {
    throw new Error("Remote revision conflict. AWS changed since the last pull/push. Pull and review the changes before pushing; --yes cannot override this conflict.");
  }

  const source = path.join(root, "lambda", name);
  const local = existed ? await readFiles(source, action === "push" ? await packageFilter(root) : undefined) : new Map() as Files;
  const before = manifest(local);
  let after: Manifest;
  let baseline: Manifest;
  let zip: Buffer;
  if (action === "pull" || !previous) {
    log("Downloading deployment package...");
    const downloaded = await remote.download(current);
    if (sha256(downloaded) !== current.codeSha256) throw new Error("Deployment package checksum mismatch. Local files were not changed.");
    const remoteFiles = await unpackArchive(downloaded);
    if (action === "pull") {
      zip = downloaded;
      after = manifest(remoteFiles);
      baseline = before;
    } else {
      baseline = manifest(remoteFiles);
      after = before;
      zip = await packArchive(local);
    }
  } else {
    baseline = previous.files;
    after = before;
    zip = await packArchive(local);
  }
  const changes = diff(baseline, after);
  changes.forEach((change) => log(`${change.kind.padEnd(8)} ${change.name}`));
  log(`${changes.length} file changes.${action === "push" ? ` ZIP: ${zip.length} bytes. Deployment target: $LATEST.` : ""}`);

  const localChanged = action === "pull" && changes.length > 0
    && (previous ? diff(previous.files, before).length > 0 : local.size > 0);
  const firstPush = action === "push" && !previous;
  if (localChanged) log("Local edits or untracked files will be replaced; a backup will be kept in .l/backups.");
  if (firstPush) log("First push: no saved revision baseline. Review the AWS target and remote file comparison.");
  const archive = path.join(staging, `${name}.zip`);
  await fs.writeFile(archive, zip, { flag: "wx", mode: 0o600 });
  return {
    name, current, existed, before, after, archive, archiveHash: sha256(zip), changes: changes.length,
    localChanged, firstPush, noChanges: action === "push" && !!previous && !changes.length,
  };
}

export async function validatePrepared(plan: PreparedSync, context: OperationContext) {
  const current = await context.remote.get(plan.current.arn);
  if (plan.current.arn !== current.arn || plan.current.revisionId !== current.revisionId || plan.current.codeSha256 !== current.codeSha256) {
    throw new Error("AWS function changed during this operation. Review the remote code and run pull before pushing again.");
  }
  ready(current);
  const exists = await directoryAt(context.root, `lambda/${plan.name}`);
  const files = exists ? await readFiles(path.join(context.root, "lambda", plan.name),
    context.action === "push" ? await packageFilter(context.root) : undefined) : new Map() as Files;
  if (exists !== plan.existed || diff(plan.before, manifest(files)).length) {
    throw new Error(context.action === "push"
      ? "Local package changed during preview. Retry push to review the updated files."
      : "Local files changed during preview. Retry pull to review the new changes.");
  }
}

async function replaceLocal(root: string, plan: PreparedSync, files: Files, state: SyncState, log: (message: string) => void) {
  await directoryAt(root, "lambda", true);
  const destination = path.join(root, "lambda", plan.name);
  const exists = await directoryAt(root, `lambda/${plan.name}`);
  const stage = await fs.mkdtemp(path.join(root, ".l/pull-stage-"));
  let backup: string | undefined;
  let installed = false;
  try {
    await writeFiles(stage, files);
    if (exists !== plan.existed || diff(plan.before, manifest(exists ? await readFiles(destination) : new Map())).length) {
      throw new Error("Local files changed while staging the pull. Retry after reviewing the changes.");
    }
    if (exists) {
      await directoryAt(root, ".l/backups", true);
      backup = path.join(root, ".l/backups", `${plan.name}-${Date.now()}-${randomUUID()}`);
      await fs.mkdir(backup, { mode: 0o700 });
      await atomicText(path.join(backup, "state.json"), JSON.stringify(await readState(root), null, 2));
      await fs.rename(destination, path.join(backup, "code"));
      log(`Backup: ${backup}`);
    }
    await fs.rename(stage, destination);
    installed = true;
    await saveState(root, state);
  } catch (error) {
    if (installed) await fs.rename(destination, stage);
    if (backup) {
      const savedCode = path.join(backup, "code");
      if (await fs.lstat(savedCode).then(() => true, () => false)) await fs.rename(savedCode, destination);
    }
    throw error;
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}

export async function applyPrepared(plan: PreparedSync, context: OperationContext) {
  const { root, action, state, remote, log } = context;
  // Recheck per target as well: earlier targets may take time to finish.
  await validatePrepared(plan, context);
  const zip = await fs.readFile(plan.archive);
  if (sha256(zip) !== plan.archiveHash) throw new Error("Prepared package changed after preview. Retry the command.");
  let current = plan.current;
  if (action === "push") {
    log(`Uploading deployment package for ${plan.name}...`);
    try { await remote.update(current, zip); }
    catch (error) {
      if (error instanceof Error && error.name === "PreconditionFailedException") {
        throw new Error("Remote revision conflict during upload. Review AWS and pull again before pushing.", { cause: error });
      }
      throw new Error(`Upload did not complete successfully: ${error instanceof Error ? error.message : "AWS request failed"}. Verify AWS status before retrying; sync state was not advanced.`, { cause: error });
    }
    log(`Waiting for Lambda update: ${plan.name}...`);
    const updated = await remote.wait(current);
    if (updated.arn !== current.arn || updated.codeSha256 !== plan.archiveHash || updated.status !== "Successful") {
      throw new Error("AWS update could not be verified or was superseded. Sync state was not advanced; inspect AWS before retrying.");
    }
    current = updated;
  }
  const entry: SyncEntry = {
    arn: current.arn, revisionId: current.revisionId, codeSha256: current.codeSha256, files: plan.after,
  };
  const next: SyncState = { ...state, functions: { ...state.functions, [plan.name]: entry } };
  if (action === "pull" && (plan.changes || !plan.existed)) {
    await replaceLocal(root, plan, await unpackArchive(zip), next, log);
  } else {
    try { await saveState(root, next); }
    catch (error) {
      if (action === "push") throw new Error("AWS code was updated, but local sync state could not be saved. Back up local code and pull to reconcile before pushing again.", { cause: error });
      throw error;
    }
  }
  // Do not let a failed target leak an unsaved baseline into later state writes.
  state.functions = next.functions;
  log(`${action === "pull" ? "Pulled" : "Pushed"} ${plan.name} successfully. Revision: ${current.revisionId}`);
}
