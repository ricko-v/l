import { execSync } from "node:child_process";
import { getConfig } from "../utils/get-config.js";
import { getCurrentDir } from "../utils/get-current-dir.js";
import AdmZip from "adm-zip";
import fs from "fs";
import normalizeConfig from "../utils/normalize-config.js";

export const pull = async (withConfig = false) => {
  const currentDir = getCurrentDir();
  const config = await getConfig();
  const functionName = currentDir.split("/")[currentDir.split("/").length - 1];
  const dir = currentDir.split("/").slice(0, -1).join("/");

  if (withConfig) {
    console.log(`Pulling lambda configuration ${functionName}...`);
    execSync(
      `aws lambda get-function-configuration --function-name ${functionName} --region ${config.region} --profile ${config.profile} > ${dir}/${functionName}/config.json`,
      { stdio: "ignore" }
    );

    const configRaw = fs.readFileSync(`${dir}/${functionName}/config.json`);
    const configFile = JSON.parse(configRaw);
    const normalize = normalizeConfig(configFile);
    fs.writeFileSync(
      `${dir}/${functionName}/config.json`,
      JSON.stringify(normalize, null, 2)
    );
    console.log(
      `✅ Lambda configuration ${currentDir
        .split("/")
        .slice(-1)} pulled successfully`
    );
  } else {
    console.log(`Pulling lambda functions ${functionName}...`);

    execSync(
      `aws lambda get-function --function-name ${functionName} --query 'Code.Location' --region ${config.region} --profile ${config.profile} --output text | xargs curl -o ${dir}/${functionName}.zip`,
      { stdio: "ignore" }
    );
    const zip = new AdmZip(`${dir}/${functionName}.zip`);
    zip.extractAllTo(`${dir}/${functionName}`, true);
    fs.unlinkSync(`${dir}/${functionName}.zip`);
    console.log(
      `✅ Lambda functions ${currentDir
        .split("/")
        .slice(-1)} pulled successfully`
    );
  }
};
