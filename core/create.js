import { input, select } from "@inquirer/prompts";
import * as fs from "fs";
import * as path from "path";
import { getCurrentDir } from "../utils/get-current-dir.js";
import { getListProfiles } from "../aws/get-list-profiles.js";
import { getListRegions } from "../aws/get-list-regions.js";
import { getListLambdaWPrefix } from "../aws/get-list-lambda-w-prefix.js";
import { downloadLambda } from "../aws/download-list-lambda.js";

export const create = async () => {
  console.log("Let's create a new project\n");
  const currentDir = getCurrentDir();
  const project = await input({
    message: "Name project:",
  });
  const projectPath = path.join(currentDir, project);
  if (fs.existsSync(projectPath)) {
    console.log("Project already exists");
    return;
  }

  const prefix = await input({
    message: "Prefix project:",
  });

  if (!prefix) {
    console.log("Prefix is required");
    return;
  }

  const listProfiles = await getListProfiles();

  const profile = await select({
    message: "Select AWS profile:",
    choices: listProfiles,
  });

  const listRegions = await getListRegions(profile);

  const region = await select({
    message: "Select AWS region:",
    choices: listRegions,
  });

  const listLambda = await getListLambdaWPrefix(prefix, profile);

  fs.mkdirSync(projectPath);
  fs.writeFileSync(
    path.join(projectPath, "l.js"),
    `
// Auto-generated file from l
export const l = {
  prefix: "${prefix}",
  profile: "${profile}",
  region: "${region}"
}`
  );

  if (listLambda.length > 0) {
    console.log(
      `Found ${listLambda.length} Lambda functions with prefix "${prefix}".`
    );
    await downloadLambda(listLambda, profile, projectPath);
  }
  console.log(`Project ${project} created at ${projectPath}`);
};
