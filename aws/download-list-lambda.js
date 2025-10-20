import fs from "fs";
import path from "path";
import { execSync } from "node:child_process";
import AdmZip from "adm-zip";
import normalizeConfig from "../utils/normalize-config.js";

export const downloadLambda = async (list, region, profile, dir) => {
  let i = 0;

  async function start() {
    if (i < list.length) {
      const functionName = list[i];
      console.log(
        `[${i + 1}/${list.length}] ⬇️ Downloading ${functionName}...`
      );

      const url = execSync(
        `aws lambda get-function --function-name ${functionName} --query "Code.Location" --region ${region} --profile ${profile} --output text`,
        { encoding: "utf8" }
      ).trim();

      const zipPath = path.join(dir, `${functionName}.zip`);
      const functionDir = path.join(dir, functionName);

      fs.mkdirSync(functionDir, { recursive: true });

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Failed to download ZIP for ${functionName}: ${response.statusText}`
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(zipPath, buffer);

      const zip = new AdmZip(zipPath);
      zip.extractAllTo(functionDir, true);

      // Hapus ZIP setelah ekstraksi
      fs.unlinkSync(zipPath);

      const output = execSync(
        `aws lambda get-function-configuration --function-name ${functionName} --region ${region} --profile ${profile}`,
        { encoding: "utf8" }
      );

      fs.writeFileSync(`${functionDir}/config.json`, output);

      const configRaw = fs.readFileSync(`${functionDir}/config.json`, "utf8");
      const config = JSON.parse(configRaw);
      const normalize = normalizeConfig(config);

      fs.writeFileSync(
        `${functionDir}/config.json`,
        JSON.stringify(normalize, null, 2)
      );
      console.log(
        `[${i + 1}/${
          list.length
        }] ✅ ${functionName} downloaded successfully.\n`
      );
      i++;
      await start();
    } else {
      console.log("🎉 All functions downloaded successfully.");
    }
  }

  await start();
};
