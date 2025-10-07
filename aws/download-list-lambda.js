import { execSync } from "node:child_process";
import fs from "fs";
import AdmZip from "adm-zip";
import normalizeConfig from "../utils/normalize-config.js";

export const downloadLambda = async (list, profile, dir) => {
  let i = 0;
  async function start() {
    if (i < list.length) {
      const functionName = list[i];
      console.log(`[${i + 1}/${list.length}] Downloading ${functionName}...`);
      execSync(
        `aws lambda get-function --function-name ${functionName} --query 'Code.Location' --profile ${profile} --output text | xargs curl -o ${dir}/${functionName}.zip`,
        { stdio: "ignore" }
      );
      const zip = new AdmZip(`${dir}/${functionName}.zip`);
      zip.extractAllTo(`${dir}/${functionName}`, true);
      fs.unlinkSync(`${dir}/${functionName}.zip`);
      execSync(
        `aws lambda get-function-configuration --function-name ${functionName} --profile ${profile} > ${dir}/${functionName}/config.json`,
        { stdio: "ignore" }
      );

      const configRaw = fs.readFileSync(`${dir}/${functionName}/config.json`);
      const config = JSON.parse(configRaw);
      const normalize = normalizeConfig(config);
      fs.writeFileSync(
        `${dir}/${functionName}/config.json`,
        JSON.stringify(normalize, null, 2)
      );
      i++;
      start();
    } else {
      console.log("All functions downloaded.");
    }
  }
  start();
};
