import { createInterface } from "node:readline/promises";

export interface InitPrompts {
  input(message: string, initial: string, validate: (value: string) => boolean): Promise<string>;
  select(message: string, choices: string[], initial?: number): Promise<number>;
  confirm(message: string, initial?: boolean): Promise<boolean>;
  close(): void;
}

export class PromptCancelledError extends Error {
  constructor(message = "Initialization cancelled. No configuration saved.") {
    super(message);
  }
}

export function createPrompts(command = "init"): InitPrompts {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`l ${command} requires an interactive terminal. Run it directly without piping input or output.`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const controller = new AbortController();
  rl.on("SIGINT", () => { controller.abort(); rl.close(); });
  rl.on("close", () => controller.abort());

  async function question(message: string) {
    const cancelled = () => new PromptCancelledError(command === "init" ? undefined : `${command} cancelled.`);
    if (controller.signal.aborted) throw cancelled();
    try {
      return (await rl.question(message, { signal: controller.signal })).trim();
    } catch (error) {
      if (controller.signal.aborted) throw cancelled();
      throw error;
    }
  }

  return {
    async input(message, initial, validate) {
      while (true) {
        const answer = await question(`${message}${initial ? ` (${initial})` : ""}: `);
        const value = answer || initial;
        if (validate(value)) return value;
        console.log("Invalid value. Please try again.");
      }
    },
    async select(message, choices, initial = 0) {
      console.log(`\n${message}`);
      choices.forEach((choice, index) => console.log(`  ${index + 1}. ${choice}`));
      while (true) {
        const answer = await question(`Choose [1-${choices.length}] (${initial + 1}): `);
        const index = answer === "" ? initial : /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
        if (index >= 0 && index < choices.length) return index;
        console.log("Choose one of the listed numbers.");
      }
    },
    async confirm(message, initial = false) {
      while (true) {
        const answer = (await question(`${message} ${initial ? "[Y/n]" : "[y/N]"}: `)).toLowerCase();
        if (!answer) return initial;
        if (["yes", "y"].includes(answer)) return true;
        if (["no", "n"].includes(answer)) return false;
        console.log("Please answer yes or no.");
      }
    },
    close() { rl.close(); },
  };
}
