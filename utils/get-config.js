import { getCurrentDir } from "./get-current-dir.js";

export const getConfig = async () => {
  const currentDir = getCurrentDir();
  try {
    const { l } = await import(
      `${currentDir
        .split("/")
        .slice(0, currentDir.split("/").length - 1)
        .join("/")}/l.js`
    );
    if (!l.prefix || !l.profile || !l.region) {
      console.log("Invalid config in l.js");
      process.exit(1);
    }
    return l;
  } catch (error) {
    console.log("No l.js file found in current directory");
    process.exit(1);
  }
};
