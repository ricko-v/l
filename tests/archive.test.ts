import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import yazl from "yazl";
import { packArchive, unpackArchive, packageFilter } from "../src/sync/archive.js";
import { manifest, readFiles, MAX_UNPACKED_BYTES } from "../src/sync/files.js";
import { fixture, files } from "./sync-fixtures.js";

async function rawZip(entries: Array<{ name: string; mode?: number }>) {
  const zip = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    zip.on("error", reject);
    zip.outputStream.on("error", reject);
    zip.outputStream.on("data", (data: Buffer) => chunks.push(data));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const entry of entries) zip.addBuffer(Buffer.from("data"), entry.name, { mode: entry.mode ?? 0o100644 });
  zip.end();
  return result;
}

test("ZIP round trip preserves binary contents, root layout, and executable permissions", async () => {
  const source = files({ "index.js": "entry", "nested/data.bin": "\x00\xff", "bootstrap": "binary" });
  source.get("bootstrap")!.mode = 0o755;
  const zip = await packArchive(source);
  assert.deepEqual(manifest(await unpackArchive(zip)), manifest(source));
  assert.deepEqual(zip, await packArchive(source));
});

test("archive rejects traversal, symlinks, duplicate and case-colliding paths", async () => {
  const safe = await rawZip([{ name: "safe.txt" }]);
  const traversal = Buffer.from(safe);
  let offset = 0;
  while ((offset = traversal.indexOf("safe.txt", offset)) >= 0) {
    traversal.write("../x.txt", offset); offset += 8;
  }
  await assert.rejects(unpackArchive(traversal));
  await assert.rejects(unpackArchive(await rawZip([{ name: "link", mode: 0o120777 }])));
  await assert.rejects(unpackArchive(await rawZip([{ name: "same" }, { name: "same" }])));
  await assert.rejects(unpackArchive(await rawZip([{ name: "File" }, { name: "file" }])));
  await assert.rejects(unpackArchive(await rawZip([{ name: "Dir/a" }, { name: "dir/b" }])));
  await assert.rejects(unpackArchive(await rawZip([{ name: "parent" }, { name: "parent/child" }])));
});

test("archive rejects corrupt ZIPs, wrong CRCs, and excessive declared decompressed size", async () => {
  await assert.rejects(unpackArchive(Buffer.from("not a zip")));
  const zip = await rawZip([{ name: "safe.txt" }]);
  const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const badCRC = Buffer.from(zip);
  badCRC.writeUInt32LE(0, central + 16);
  await assert.rejects(unpackArchive(badCRC), /checksum mismatch/);
  const oversized = Buffer.from(zip);
  oversized.writeUInt32LE(MAX_UNPACKED_BYTES + 1, central + 24);
  await assert.rejects(unpackArchive(oversized), /250 MiB/);
  await assert.rejects(packArchive(new Map()), /No deployable files/);
});

test(".lignore uses gitignore rules, excludes CLI metadata, and keeps runtime dependencies", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.directory, ".lignore"), "*.test.js\n.env*\n!keep.test.js\n!.git/\n!.l/\n");
  const source = path.join(f.directory, "code");
  await fs.mkdir(path.join(source, "node_modules/runtime"), { recursive: true });
  for (const name of ["index.js", "skip.test.js", "keep.test.js", ".env", "l.config.json", ".lignore", "node_modules/runtime/index.js"]) {
    await fs.writeFile(path.join(source, name), "data");
  }
  await fs.mkdir(path.join(source, ".git"));
  await fs.writeFile(path.join(source, ".git/config"), "git metadata");
  await fs.symlink("/does-not-exist", path.join(source, ".l"));
  const packaged = await readFiles(source, await packageFilter(f.directory));
  assert.deepEqual([...packaged.keys()].sort(), ["index.js", "keep.test.js", "node_modules/runtime/index.js"]);
  await fs.symlink(path.join(source, "index.js"), path.join(source, "linked.js"));
  await assert.rejects(readFiles(source, await packageFilter(f.directory)), /Symbolic links/);
});
