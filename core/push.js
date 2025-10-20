import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { execSync } from "node:child_process";
import { getCurrentDir } from "../utils/get-current-dir.js";
import { getConfig } from "../utils/get-config.js";

export const push = async (withConfig = false) => {
  const currentDir = getCurrentDir();
  const config = await getConfig();
  const functionName = path.basename(currentDir);
  const region = config.region;
  const profile = config.profile;

  if (withConfig) {
    console.log(`⬆️  Pushing configuration for ${functionName}...`);
    const configPath = path.join(currentDir, "config.json");

    if (!fs.existsSync(configPath)) {
      console.error(`❌ Configuration file not found at: ${configPath}`);
      return;
    }

    const configJson = fs.readFileSync(configPath, "utf8");

    execSync(
      `aws lambda update-function-configuration --region ${region} --profile ${profile} --cli-input-json "${configJson.replace(
        /"/g,
        '\\"'
      )}"`,
      { stdio: "ignore", shell: true }
    );

    console.log(`✅ Configuration for ${functionName} pushed successfully`);
  } else {
    console.log(`⬆️  Pushing lambda function code for ${functionName}...`);

    const zip = new AdmZip();
    const files = fs.readdirSync(currentDir).filter((f) => f !== "config.json");

    for (const file of files) {
      const filePath = path.join(currentDir, file);
      const stats = fs.lstatSync(filePath);
      if (stats.isDirectory()) {
        zip.addLocalFolder(filePath, file);
      } else {
        zip.addLocalFile(filePath);
      }
    }

    const zipPath = path.join(currentDir, "function.zip");
    zip.writeZip(zipPath);

    execSync(
      `aws lambda update-function-code --function-name ${functionName} --zip-file fileb://${zipPath} --region ${region} --profile ${profile}`,
      { stdio: "ignore", shell: true }
    );

    fs.unlinkSync(zipPath);

    console.log(`✅ Lambda function ${functionName} pushed successfully`);
  }
};
