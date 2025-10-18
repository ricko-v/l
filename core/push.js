import { execSync } from "node:child_process";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { getCurrentDir } from "../utils/get-current-dir.js";
import { getConfig } from "../utils/get-config.js";

export const push = async (withConfig = false) => {
  const currentDir = getCurrentDir();
  const config = await getConfig();

  if (withConfig) {
    const configPath = path.join(currentDir, "config.json");
    if (fs.existsSync(configPath)) {
      execSync(
        `aws lambda update-function-configuration --cli-input-json file://${configPath} --region ${config.region} --profile ${config.profile}`,
        { stdio: "ignore" }
      );
      console.log(
        `✅ ${currentDir
          .split("/")
          .slice(-1)} configuration pushed successfully`
      );
    }
  } else {
    console.log(
      "Push lambda functions from",
      currentDir.split("/").slice(-1)[0]
    );
    const listFiles = fs
      .readdirSync(currentDir)
      .filter((file) => file !== "config.json");
    const zip = new AdmZip();
    for (const file of listFiles) {
      if (fs.lstatSync(path.join(currentDir, file)).isDirectory()) {
        zip.addLocalFolder(path.join(currentDir, file), file);
      } else {
        zip.addLocalFile(path.join(currentDir, file));
      }
    }
    const zipPath = path.join(currentDir, "function.zip");
    zip.writeZip(zipPath);
    execSync(
      `aws lambda update-function-code --function-name ${currentDir
        .split("/")
        .slice(-1)} --zip-file fileb://${zipPath} --region ${
        config.region
      } --profile ${config.profile}`,
      { stdio: "ignore" }
    );

    fs.unlinkSync(zipPath);
    console.log(`✅ ${currentDir.split("/").slice(-1)} pushed successfully`);
  }
};
