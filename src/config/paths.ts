import os from "node:os";
import path from "node:path";

export const L_HOME = path.join(os.homedir(), ".l");

export const SESSION_PATH = path.join(L_HOME, "session.json");
