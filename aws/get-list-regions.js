import { execSync } from "node:child_process";

export const getListRegions = async (profile) => {
  const regions = execSync(`aws account list-regions --profile ${profile}`, {
    encoding: "utf-8",
  });

  if (!regions) {
    console.log("No AWS regions found.");
    process.exit(1);
  }

  return JSON.parse(regions)
    .Regions.map((region) => region.RegionName)
    .filter((region) => region.RegionOptStatus != "DISABLED");
};
