import { createHash, randomBytes } from "node:crypto";

function base64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function createPkce() {
  const verifier = base64Url(randomBytes(48));

  const challenge = base64Url(createHash("sha256").update(verifier).digest());

  return {
    verifier,
    challenge,
  };
}
