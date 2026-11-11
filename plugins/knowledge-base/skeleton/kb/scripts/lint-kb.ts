import { existsSync, readFileSync } from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import {
  DECISION_REQUIRED,
  DECISION_STATUSES,
  DECISION_TYPES,
  REQUIRED,
  TYPES,
  extractLinks,
  parseFrontmatter,
  walkMarkdown,
} from "./kb";
import { renderIndexes } from "./generate-indexes";

const REGENERATE = "bun scripts/generate-indexes.ts";

export function lintBundle(root: string): string[] {
  const errors: string[] = [];

  for (const file of walkMarkdown(root)) {
    const rel = relative(root, file);
    const text = readFileSync(file, "utf8");

    for (const link of extractLinks(text)) {
      if (!existsSync(resolve(dirname(file), link))) errors.push(`${rel}: dead link ${link}`);
    }

    if (basename(file) === "index.md") {
      if (text.startsWith("---\n")) errors.push(`${rel}: index.md must not have frontmatter — it is generated`);
      continue;
    }

    const fm = parseFrontmatter(text);
    if (!fm) {
      errors.push(`${rel}: missing or unclosed frontmatter block`);
      continue;
    }
    const decision = DECISION_TYPES.has(fm.type);
    for (const field of decision ? [...REQUIRED, ...DECISION_REQUIRED] : REQUIRED) {
      if (!fm[field]) errors.push(`${rel}: missing required field '${field}'`);
    }
    if (fm.type && !TYPES.has(fm.type)) {
      errors.push(`${rel}: unknown type '${fm.type}' — allowed: ${[...TYPES].join(", ")}`);
    }
    if (decision && fm.status && !DECISION_STATUSES.includes(fm.status)) {
      errors.push(`${rel}: status must be one of ${DECISION_STATUSES.join(", ")}`);
    }
    if (fm.tags && !/^\[.*\]$/.test(fm.tags)) errors.push(`${rel}: tags must be an inline array, e.g. [onboarding, billing]`);
  }

  for (const [rel, expected] of renderIndexes(root)) {
    const path = join(root, rel);
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current !== expected) errors.push(`${rel}: stale — run \`${REGENERATE}\` (generated, never hand-edit it)`);
  }

  return errors;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const errors = lintBundle(root);
  for (const e of errors) console.log(e);
  process.exit(errors.length ? 1 : 0);
}
