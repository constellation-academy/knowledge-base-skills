import { expect, test } from "bun:test";
import { extractLinks, parseFrontmatter } from "./kb";

test("parseFrontmatter reads a flat block", () => {
  const fm = parseFrontmatter("---\ntype: process\ntitle: Getting started\n---\n\n# Body\n");
  expect(fm).toEqual({ type: "process", title: "Getting started" });
});

test("parseFrontmatter returns null without a block", () => {
  expect(parseFrontmatter("# Body only\n")).toBeNull();
});

test("parseFrontmatter returns null when the block is never closed", () => {
  expect(parseFrontmatter("---\ntype: process\n")).toBeNull();
});

test("parseFrontmatter keeps an inline array verbatim", () => {
  const fm = parseFrontmatter("---\ntags: [onboarding, billing]\n---\n");
  expect(fm?.tags).toBe("[onboarding, billing]");
});

test("extractLinks returns relative targets only", () => {
  const text = "[a](process/getting-started.md) [b](https://example.com) [c](#anchor) [d](mailto:x@y.z)";
  expect(extractLinks(text)).toEqual(["process/getting-started.md"]);
});

test("extractLinks strips the anchor from a relative target", () => {
  expect(extractLinks("[a](glossary.md#slot)")).toEqual(["glossary.md"]);
});

test("extractLinks ignores links inside fenced and inline code", () => {
  expect(extractLinks("```\n[x](nope.md)\n```\n`[y](also-nope.md)`\n")).toEqual([]);
});

test("extractLinks decodes percent-escapes pandoc writes for image paths", () => {
  expect(extractLinks("![](assets/media/image%201.png)")).toEqual(["assets/media/image 1.png"]);
});
