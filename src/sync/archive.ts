import yauzl from "yauzl";
import yazl from "yazl";
import ignore from "ignore";
import path from "node:path";
import { crc32 } from "node:zlib";
import { readTextFile, validateEntryPath, normalizedMode, MAX_FILES, MAX_UNPACKED_BYTES, type Files } from "./files.js";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function pathRegistry() {
  const paths = new Map<string, { name: string; directory: boolean; explicit: boolean }>();
  return (name: string, directory: boolean) => {
    validateEntryPath(name);
    const parts = name.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const current = parts.slice(0, i).join("/");
      const key = current.normalize("NFC").toLowerCase();
      const isDirectory = i < parts.length || directory;
      const explicit = i === parts.length;
      const previous = paths.get(key);
      if (previous && (previous.name !== current || previous.directory !== isDirectory || (previous.explicit && explicit))) {
        throw new Error(`Conflicting ZIP paths: ${current}`);
      }
      paths.set(key, { name: current, directory: isDirectory, explicit: explicit || previous?.explicit || false });
    }
  };
}

export async function unpackArchive(buffer: Buffer): Promise<Files> {
  if (buffer.length > MAX_UNPACKED_BYTES) throw new Error("ZIP download exceeds 250 MiB.");
  const zip = await yauzl.fromBufferPromise(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  const files: Files = new Map();
  const register = pathRegistry();
  let bytes = 0;
  let count = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      if (++count > MAX_FILES) throw new Error(`ZIP exceeds ${MAX_FILES} entries.`);
      const directory = entry.fileName.endsWith("/");
      const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
      register(name, directory);
      const mode = entry.externalFileAttributes >>> 16;
      const type = mode & 0o170000;
      if (entry.isEncrypted() || (type !== 0 && type !== (directory ? 0o040000 : 0o100000))) {
        throw new Error(`Encrypted entries, symbolic links, and special files are unsupported: ${name}`);
      }
      if (directory) continue;
      if (entry.uncompressedSize > MAX_UNPACKED_BYTES - bytes) throw new Error("ZIP exceeds 250 MiB uncompressed.");
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > MAX_UNPACKED_BYTES) throw new Error("ZIP exceeds 250 MiB uncompressed.");
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      if (crc32(data) !== entry.crc32) throw new Error(`ZIP checksum mismatch: ${name}`);
      files.set(name, { data, mode: normalizedMode(mode || 0o644) });
    }
  } finally { zip.close(); }
  if (!files.size) throw new Error("Deployment package contains no files.");
  return files;
}

export async function packArchive(files: Files): Promise<Buffer> {
  if (!files.size) throw new Error("No deployable files found. Check the source directory and .lignore.");
  if (files.size > MAX_FILES) throw new Error(`Package exceeds ${MAX_FILES} files.`);
  const register = pathRegistry();
  const zip = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  let length = 0;
  let unpacked = 0;
  // Attach listeners before adding files; errors must never become unhandled events.
  const result = new Promise<Buffer>((resolve, reject) => {
    zip.on("error", reject);
    zip.outputStream.on("error", reject);
    zip.outputStream.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_UPLOAD_BYTES) {
        reject(new Error("ZIP exceeds the 50 MiB direct-upload limit. Reduce the package; S3 uploads are not supported yet."));
      } else chunks.push(chunk);
    });
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  void result.catch(() => {});
  try {
    for (const [name, file] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      register(name, false);
      unpacked += file.data.length;
      if (unpacked > MAX_UNPACKED_BYTES) throw new Error("Package exceeds 250 MiB uncompressed.");
      zip.addBuffer(file.data, name, {
        mode: 0o100000 | file.mode, mtime: new Date("2000-01-01T00:00:00Z"),
        compressionLevel: 6,
      });
    }
  } finally { zip.end(); }
  return result;
}

export async function packageFilter(root: string) {
  const patterns = await readTextFile(path.join(root, ".lignore")) ?? "";
  const rules = ignore().add(patterns);
  return (name: string) => {
    const parts = name.split("/");
    if (parts.some((part) => [".git", ".l", ".lignore", "l.config.json"].includes(part))) return true;
    return rules.ignores(name);
  };
}
