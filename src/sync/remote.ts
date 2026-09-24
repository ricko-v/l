import {
  GetFunctionCommand, UpdateFunctionCodeCommand, waitUntilFunctionUpdatedV2,
  type GetFunctionCommandOutput, type LambdaClient,
} from "@aws-sdk/client-lambda";
import { MAX_UNPACKED_BYTES, sha256 } from "./files.js";

export interface RemoteFunction {
  arn: string;
  revisionId: string;
  codeSha256: string;
  location?: string;
  status?: string;
  statusReason?: string;
  state?: string;
}

function describe(response: GetFunctionCommandOutput): RemoteFunction {
  const config = response.Configuration;
  if (config?.PackageType !== "Zip") throw new Error("Only ZIP-based Lambda functions are supported; container images require a separate deployment workflow.");
  if (!config.FunctionArn || !config.RevisionId || !config.CodeSha256) throw new Error("AWS returned incomplete function metadata.");
  return {
    arn: config.FunctionArn, revisionId: config.RevisionId, codeSha256: config.CodeSha256,
    location: response.Code?.Location, status: config.LastUpdateStatus,
    statusReason: config.LastUpdateStatusReason, state: config.State,
  };
}

export interface Remote {
  get(name: string): Promise<RemoteFunction>;
  download(remote: RemoteFunction): Promise<Buffer>;
  update(remote: RemoteFunction, zip: Buffer): Promise<void>;
  wait(remote: RemoteFunction): Promise<RemoteFunction>;
}

export async function downloadPackage(remote: RemoteFunction): Promise<Buffer> {
  if (!remote.location || new URL(remote.location).protocol !== "https:") throw new Error("AWS did not return an HTTPS deployment-package URL.");
  try {
    const response = await fetch(remote.location, { signal: AbortSignal.timeout(120_000), redirect: "error" });
    if (!response.ok || !response.body) throw new Error(`Download returned HTTP ${response.status}.`);
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > MAX_UNPACKED_BYTES) throw new Error("Download exceeds 250 MiB.");
      chunks.push(Buffer.from(chunk));
    }
    const zip = Buffer.concat(chunks);
    if (sha256(zip) !== remote.codeSha256) throw new Error("Deployment package checksum mismatch.");
    return zip;
  } catch (error) {
    // Never include the signed download URL in terminal output.
    throw new Error("Unable to download or verify the Lambda package. Retry pull; local files were not changed.", { cause: error });
  }
}

export function awsRemote(client: LambdaClient): Remote {
  const get = async (name: string) => describe(await client.send(new GetFunctionCommand({ FunctionName: name })));
  return {
    get,
    download: downloadPackage,
    async update(remote, zip) {
      await client.send(new UpdateFunctionCodeCommand({
        FunctionName: remote.arn, RevisionId: remote.revisionId, ZipFile: zip, Publish: false,
      }));
    },
    async wait(remote) {
      try {
        await waitUntilFunctionUpdatedV2({ client, maxWaitTime: 120, minDelay: 2, maxDelay: 5 }, { FunctionName: remote.arn });
      } catch {
        const latest = await get(remote.arn);
        if (latest.status === "Failed") throw new Error(`Lambda update failed: ${latest.statusReason ?? "AWS reported a failed update."}`);
        throw new Error("Lambda update status is uncertain or timed out. Check AWS before retrying; the local sync baseline was not advanced.");
      }
      return get(remote.arn);
    },
  };
}
