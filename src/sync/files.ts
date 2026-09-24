import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const MAX_UNPACKED_BYTES = 250 * 1024 * 1024;
export const MAX_FILES = 10_000;
export type Files = Map<string, { data: Buffer; mode: number }>;
export type Manifest = Record<string, string>;

export function sha256(data: Buffer) {
  return createHash("sha256").update(data).digest("base64");
}

export function validateEntryPath(name: string) {
  if (!name || name.includes("\\") || name.startsWith("/") || name.split("/").some((part) =>
    !part || part === "." || part === ".." || /[\x00-\x1f\x7f<>:"|?*]/.test(part)
    || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) {
    throw new Error(`Unsafe package path: ${JSON.stringify(name)}`);
  }
}

export function normalizedMode(mode: number) {
  return mode & 0o111 ? 0o755 : 0o644;
}

// Windows stat/chmod cannot represent POSIX executable bits. Keep the deployment
// mode from the baseline, including when file contents have been edited locally.
export function preserveDeploymentModes(files: Files, baseline: Manifest = {}, platform = process.platform) {
  if (platform === "win32") {
    for (const [name, file] of files) {
      file.mode = Object.hasOwn(baseline, name) && baseline[name]?.endsWith(":493") ? 0o755 : 0o644;
    }
  }
  return files;
}

export async function directoryAt(root: string, relative: string, create = false) {
  validateEntryPath(relative);
  let current = root;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    if (create) await fs.mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a real directory: ${current}`);
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  return true;
}

export async function readTextFile(file: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular file: ${file}`);
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readFiles(directory: string, ignored: (name: string) => boolean = () => false, baseline: Manifest = {}): Promise<Files> {
  const files: Files = new Map();
  let bytes = 0;
  let entries = 0;
  async function walk(relative: string) {
    const children = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${child.name}` : child.name;
      if (ignored(name + (child.isDirectory() ? "/" : ""))) continue;
      validateEntryPath(name);
      if (++entries > MAX_FILES) throw new Error(`Package exceeds ${MAX_FILES} entries.`);
      if (child.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${name}`);
      if (child.isDirectory()) { await walk(name); continue; }
      if (!child.isFile()) throw new Error(`Unsupported file type: ${name}`);
      const file = await fs.open(path.join(directory, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > MAX_UNPACKED_BYTES - bytes) throw new Error("Package exceeds 250 MiB uncompressed.");
        const chunks: Buffer[] = [];
        const stream = file.createReadStream({ autoClose: false });
        for await (const chunk of stream) {
          bytes += chunk.length;
          if (bytes > MAX_UNPACKED_BYTES) throw new Error("Package exceeds 250 MiB uncompressed.");
          chunks.push(chunk);
        }
        files.set(name, { data: Buffer.concat(chunks), mode: normalizedMode(stat.mode) });
      } finally { await file.close(); }
    }
  }
  await walk("");
  return preserveDeploymentModes(files, baseline);
}

export function manifest(files: Files): Manifest {
  return Object.fromEntries([...files].map(([name, file]) => [name, `${sha256(file.data)}:${file.mode}`]));
}

export function diff(before: Manifest, after: Manifest) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((name) => {
    const old = Object.hasOwn(before, name) ? before[name] : undefined;
    const next = Object.hasOwn(after, name) ? after[name] : undefined;
    return old === next ? [] : [{ name, kind: !old ? "added" : !next ? "deleted" : "modified" }];
  });
}

export async function writeFiles(directory: string, files: Files) {
  for (const [name, file] of files) {
    validateEntryPath(name);
    const target = path.join(directory, name);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    await fs.writeFile(target, file.data, { flag: "wx", mode: file.mode });
    await fs.chmod(target, file.mode);
  }
}
