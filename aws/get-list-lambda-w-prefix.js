import { execSync } from "node:child_process";

export const getListLambdaWPrefix = async (prefix, profile) => {
  const command = `aws lambda list-functions --profile ${profile} --query "Functions[?starts_with(FunctionName, '${prefix}')].FunctionName"`;
  const functions = execSync(command, { encoding: "utf-8" });

  if (!functions) {
    console.log(`No Lambda functions found with prefix "${prefix}".`);
    process.exit(1);
  }

  return JSON.parse(functions);
};
