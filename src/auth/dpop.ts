import {
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

export interface DpopKey {
  privateKey: KeyObject;
  privateKeyPem: string;
}

export function createDpopKey(): DpopKey {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });

  const privateKeyPem = privateKey
    .export({
      type: "sec1",
      format: "pem",
    })
    .toString();

  return {
    privateKey,
    privateKeyPem,
  };
}

export function loadDpopKey(pem: string) {
  return createPrivateKey(pem);
}

export function createDpopProof({
  privateKey,
  method,
  url,
}: {
  privateKey: KeyObject;
  method: string;
  url: string;
}) {
  const publicKey = privateKey.export({
    format: "jwk",
  });

  const header = {
    typ: "dpop+jwt",
    alg: "ES256",

    jwk: {
      kty: publicKey.kty,
      crv: publicKey.crv,
      x: publicKey.x,
      y: publicKey.y,
    },
  };

  const payload = {
    htm: method.toUpperCase(),
    htu: url,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
  };

  const encodedHeader = base64Url(JSON.stringify(header));

  const encodedPayload = base64Url(JSON.stringify(payload));

  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = sign("sha256", Buffer.from(signingInput), {
    key: privateKey,

    // JWT ES256 membutuhkan R || S,
    // bukan DER encoding.
    dsaEncoding: "ieee-p1363",
  });

  return [encodedHeader, encodedPayload, base64Url(signature)].join(".");
}
