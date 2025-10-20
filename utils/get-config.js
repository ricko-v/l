import path from "node:path";
import { pathToFileURL } from "node:url";
import { getCurrentDir } from "./get-current-dir.js";

export const getConfig = async () => {
  const currentDir = getCurrentDir();

  const parentDir = path.dirname(currentDir);

  try {
    const lPath = path.join(parentDir, "l.js");

    const { l } = await import(pathToFileURL(lPath).href);

    if (!l.prefix || !l.profile || !l.region) {
      console.error("❌ Invalid config in l.js");
      process.exit(1);
    }

    return l;
  } catch (error) {
    console.error("⚠️ No l.js file found in parent directory");
    process.exit(1);
  }
};
