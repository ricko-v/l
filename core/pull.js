import { execSync } from "node:child_process";
import { getConfig } from "../utils/get-config.js";
import { getCurrentDir } from "../utils/get-current-dir.js";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import normalizeConfig from "../utils/normalize-config.js";

export const pull = async (withConfig = false) => {
  const currentDir = getCurrentDir();
  const config = await getConfig();
  const functionName = path.basename(currentDir);
  const dir = path.dirname(currentDir);
  const functionDir = path.join(dir, functionName);

  fs.mkdirSync(functionDir, { recursive: true });

  if (withConfig) {
    const output = execSync(
      `aws lambda get-function-configuration --function-name ${functionName} --region ${config.region} --profile ${config.profile}`,
      { encoding: "utf8" }
    );

    fs.writeFileSync(`${functionDir}/config.json`, output);

    const configRaw = fs.readFileSync(`${functionDir}/config.json`, "utf8");
    const configFile = JSON.parse(configRaw);
    const normalize = normalizeConfig(configFile);

    fs.writeFileSync(
      `${functionDir}/config.json`,
      JSON.stringify(normalize, null, 2)
    );

    console.log(`✅ Lambda configuration ${functionName} pulled successfully`);
  } else {
    const url = execSync(
      `aws lambda get-function --function-name ${functionName} --query "Code.Location" --region ${config.region} --profile ${config.profile} --output text`,
      { encoding: "utf8" }
    ).trim();

    const zipPath = path.join(dir, `${functionName}.zip`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ZIP: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(zipPath, buffer);

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(functionDir, true);

    fs.unlinkSync(zipPath);

    console.log(`✅ Lambda function ${functionName} pulled successfully`);
  }
};
