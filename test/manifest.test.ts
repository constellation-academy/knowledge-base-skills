import { describe, expect, test } from "bun:test";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import schema from "../plugins/knowledge-base/contracts/kb-manifest.schema.json";
import github from "./fixtures/example-github.kb-manifest.json";
import azure from "./fixtures/example-azure.kb-manifest.json";

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

const errorsOf = (manifest: unknown): ErrorObject[] => {
  validate(manifest);
  return validate.errors ?? [];
};

const failsAt = (manifest: unknown, instancePath: string, keyword: string) => {
  const errors = errorsOf(manifest);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.some((e) => e.instancePath === instancePath && e.keyword === keyword)).toBe(true);
};

const copy = (manifest: object): any => structuredClone(manifest);

describe("kb-manifest schema", () => {
  test.each([
    ["example-github", github],
    ["example-azure", azure],
  ])("%s fixture validates", (_, manifest) => {
    expect(errorsOf(manifest)).toEqual([]);
  });

  test("a manifest without kb fails", () => {
    const manifest = copy(github);
    delete manifest.kb;
    const errors = errorsOf(manifest);
    expect(errors.some((e) => e.keyword === "required" && e.params.missingProperty === "kb")).toBe(true);
  });

  test("a manifest with contract 2 fails", () => {
    failsAt({ ...copy(github), contract: "2" }, "/contract", "const");
  });

  test("a manifest with an unknown pr.host fails", () => {
    const manifest = copy(azure);
    manifest.pr.host = "gitlab";
    failsAt(manifest, "/pr/host", "enum");
  });

  test("an export command without the {out} placeholder fails", () => {
    const manifest = copy(github);
    manifest.export.cmd = "node tools/export.mjs --ref {ref}";
    failsAt(manifest, "/export/cmd", "pattern");
  });

  test("an unqualified skill name fails", () => {
    const manifest = copy(azure);
    manifest.skills.read = "kb-provider";
    failsAt(manifest, "/skills/read", "pattern");
  });

  test("a resource with two kinds fails", () => {
    const manifest = copy(github);
    manifest.resources.glossary = { file: "terms.md", folder: "handbook/" };
    failsAt(manifest, "/resources/glossary", "oneOf");
  });

  test("an unknown top-level field fails", () => {
    const errors = errorsOf({ ...copy(github), team_provider: "example-team:kb-provider" });
    expect(errors.some((e) => e.keyword === "additionalProperties" && e.params.additionalProperty === "team_provider")).toBe(true);
  });

  test("a path with a .. segment fails", () => {
    const manifest = copy(github);
    manifest.article_types.guide.template = "blueprints/../../outside.md";
    failsAt(manifest, "/article_types/guide/template", "not");
  });

  test("a file_name with an unknown placeholder fails", () => {
    const manifest = copy(azure);
    manifest.article_types.decision.file_name = "{date}-{slug}.md";
    failsAt(manifest, "/article_types/decision/file_name", "pattern");
  });

  test.each(["url_or_email", "unicode_whitespace", "standard-no-stop-words"])("analyzer %s validates", (analyzer) => {
    expect(errorsOf({ ...copy(azure), fulltext_analyzer: analyzer })).toEqual([]);
  });
});
