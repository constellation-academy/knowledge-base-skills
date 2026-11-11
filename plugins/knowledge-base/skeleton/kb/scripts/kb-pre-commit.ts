import { spawnSync } from "child_process";
import { resolve } from "path";

export const STEPS = ["generate-indexes.ts", "lint-kb.ts"];

export type Runner = (script: string) => number;

export function runSteps(run: Runner): number {
  for (const step of STEPS) {
    const status = run(step);
    if (status !== 0) return status;
  }
  return 0;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const run: Runner = (step) =>
    spawnSync(process.execPath, [`scripts/${step}`], { cwd: root, stdio: "inherit" }).status ?? 1;
  process.exit(runSteps(run));
}
