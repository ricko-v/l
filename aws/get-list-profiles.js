import { execSync } from "node:child_process";

export const getListProfiles = async () => {
  const profiles = execSync("aws configure list-profiles", {
    encoding: "utf-8",
  });

  if (!profiles) {
    console.log("No AWS profiles found.");
    process.exit(1);
  }

  return profiles.split("\n").filter((profile) => profile);
};
