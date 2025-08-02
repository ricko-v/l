import { input } from "@inquirer/prompts";
import { aws } from "../utils/aws.js";
import * as fs from "node:fs";
import { execSync } from "node:child_process";
import * as unzipper from "unzipper";

export const syncLambda = async () => {
  const currentDir = process.cwd();

  const prefix = await input({
    message: "Enter prefix lambda:",
  });

  console.log(`Getting Lambda functions with prefix: ${prefix}`);
  const listLambda = await aws(
    `aws lambda list-functions --query "Functions[?starts_with(FunctionName, '${prefix}')].FunctionName" --output json`
  );
  let i = 0;
  const lambdas = JSON.parse(listLambda).sort((a, b) => a.localeCompare(b));

  if (lambdas.length === 0) {
    console.log("No Lambda functions found with the specified prefix.");
    return;
  }

  async function sync() {
    if (i < lambdas.length) {
        const lambdaName = lambdas[i];
      if(!fs.existsSync(`${currentDir}/lambda/code/${lambdaName}`)) {
        fs.mkdirSync(`${currentDir}/lambda/code/${lambdaName}`, { recursive: true });
      }
      console.log(`\n[${i + 1}/${lambdas.length}] Syncing ${lambdaName}...`);
      console.log(`Getting configuration for ${lambdaName}...`);
      const getConfig = await aws(
        `aws lambda get-function-configuration --function-name ${lambdaName} --output json`
      );
      fs.writeFileSync(
        `${currentDir}/lambda/config/${lambdaName}.json`,
        getConfig,
        "utf8"
      );
      console.log(`Downloading code for ${lambdaName}...`);
      const getCode = await aws(
        `aws lambda get-function --function-name ${lambdaName} --query 'Code.Location' --output json`
      );
      execSync(
        `curl -o '${currentDir}/lambda/code/${lambdaName}/${lambdaName}.zip' "${JSON.parse(
          getCode
        )}"`,
        { stdio: "ignore" }
      );

      console.log(
        `Extracting code for ${lambdaName}...`
      );
      const directory = await unzipper.Open.file(
        `${currentDir}/lambda/code/${lambdaName}/${lambdaName}.zip`
      );
      await directory.extract({
        path: `${currentDir}/lambda/code/${lambdaName}`,
      });

      fs.rmSync(`${currentDir}/lambda/code/${lambdaName}/${lambdaName}.zip`);

      i++;
      sync();
    }
  }

  sync();
};
