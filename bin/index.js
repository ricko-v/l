#!/usr/bin/env node

import { create } from "../core/create.js";
import { pull } from "../core/pull.js";
import { push } from "../core/push.js";

const main = async () => {
  try {
    const command = process.argv[2];
    if (process.argv.length < 3) {
      console.log(`usage: l <command> <subcommand> [<args>]
        
Global Commands:
  create              Create a new project

In lambda directory:
  push                Push local function to AWS Lambda
  push config         Push local configuration to AWS Lambda
  pull                Pull function from AWS Lambda
  pull config         Pull configuration from AWS Lambda
`);
      process.exit(1);
    }

    if (command === "create") {
      await create();
      process.exit(0);
    } else if (command === "push") {
      const withConfig = process.argv[3] === "config";
      await push(withConfig);
      process.exit(0);
    } else if (command === "pull") {
      const withConfig = process.argv[3] === "config";
      await pull(withConfig);
      process.exit(0);
    } else {
      console.log(`l: Unknown command '${command}'`);
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
};

main();
