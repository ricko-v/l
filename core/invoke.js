import { execSync } from "node:child_process";
import { getConfig } from "../utils/get-config.js";
import { getCurrentDir } from "../utils/get-current-dir.js";
import fs from "fs";
import path from "path";

export const invoke = async () => {
  const currentDir = getCurrentDir();
  const config = await getConfig();
  const functionName = path.basename(currentDir);
  const dir = path.dirname(currentDir);
  const functionDir = path.join(dir, functionName);
  const eventPath = path.join(functionDir, "event.json");

  if (!fs.existsSync(eventPath)) {
    fs.writeFileSync(eventPath, JSON.stringify({}, null, 2));
  }

  const eventRaw = fs.readFileSync(eventPath, "utf8");
  const event = JSON.parse(eventRaw);

  console.log(`Invoking lambda function ${functionName}...`);

  const safePayload = JSON.stringify(event).replace(/"/g, '\\"');

  const command = `aws lambda invoke --function-name ${functionName} --cli-binary-format raw-in-base64-out --payload "${safePayload}" --region ${config.region} --profile ${config.profile} output.json`;

  execSync(command, { encoding: "utf8", stdio: "ignore" });

  console.log(`✅ Lambda function ${functionName} invoked successfully`);

  const responseRaw = fs.readFileSync("output.json", "utf8");
  const response = JSON.parse(responseRaw);

  console.log("\nResponse:");
  console.log(response);
  console.log("\n");

  fs.unlinkSync("output.json");
};
