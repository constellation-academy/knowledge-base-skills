import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { ROOT_FILES, SECTIONS, readFrontmatter, sectionFiles } from "./kb";

export const TITLE = "{{team}} Knowledge Base";
const EMPTY_NOTE = "_No articles yet._";

function displayTitle(file: string, title: string): string {
  const m = file.match(/^(ADR|PDR)-(\d+)-/);
  return m ? `${m[1]}-${m[2]}: ${title}` : title;
}

function entry(title: string, href: string, description: string, suffix = ""): string {
  return `* [${title}](${href}) - ${description}${suffix}`;
}

export function renderIndexes(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const rootLines: string[] = [`# ${TITLE}`, ""];

  for (const f of ROOT_FILES) {
    if (!existsSync(join(root, f))) continue;
    const fm = readFrontmatter(root, f);
    rootLines.push(entry(fm.title ?? f, f, fm.description ?? ""));
  }

  for (const section of SECTIONS) {
    const files = sectionFiles(root, section.dir);
    const sectionLines: string[] = [`# ${section.heading}`, ""];

    if (files.length === 0) sectionLines.push(EMPTY_NOTE);
    else rootLines.push("", `## ${section.heading}`, "");

    for (const file of files) {
      const rel = `${section.dir}/${file}`;
      const fm = readFrontmatter(root, rel);
      const title = displayTitle(file, fm.title ?? file);
      const suffix = fm.status ? ` (${fm.status})` : "";
      sectionLines.push(entry(title, file, fm.description ?? "", suffix));
      rootLines.push(entry(title, rel, fm.description ?? "", suffix));
    }

    sectionLines.push("");
    out.set(`${section.dir}/index.md`, sectionLines.join("\n"));
  }

  rootLines.push("");
  out.set("index.md", rootLines.join("\n"));
  return out;
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  for (const [rel, content] of renderIndexes(root)) {
    writeFileSync(join(root, rel), content);
    console.log(`wrote ${rel}`);
  }
}
