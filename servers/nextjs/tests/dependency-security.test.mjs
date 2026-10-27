import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { mergeAttributes } from "@tiptap/core";
import katex from "katex";

const require = createRequire(import.meta.url);
let schema;
let directory;

test.before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "presenton-schema-security-"));
  const outfile = path.join(directory, "schema.cjs");
  await build({
    entryPoints: [path.resolve("app/(presentation-generator)/(dashboard)/Components/MarketOpportunitySlide.tsx")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    tsconfig: path.resolve("tsconfig.json"),
    logLevel: "silent",
  });
  schema = require(outfile).Schema;
});

test.after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("market schema preserves defaults and four-item collections", () => {
  const defaults = schema.parse({});
  assert.equal(defaults.title, "Market Opportunity");
  assert.equal(defaults.bullets.length, 4);
  assert.equal(defaults.values.length, 4);
  assert.equal(schema.safeParse({ values: ["$1", "$2", "$3", "$4"] }).success, true);
});

test("oversized constrained collections reject without per-element error amplification", () => {
  const result = schema.safeParse({ values: Array(50_000).fill("invalid oversized value") });
  assert.equal(result.success, false);
  assert.ok(result.error.issues.length <= 4, `Produced ${result.error.issues.length} errors`);
  assert.ok(result.error.issues.some((issue) => issue.code === "too_big"));
});

test("imported attribute objects cannot introduce inherited executable attributes", () => {
  const input = JSON.parse('{"class":"slide-run","data-slide-run-style":"true","__proto__":{"src":"x-invalid://canary","onerror":"alert(1)"}}');
  const attributes = mergeAttributes(input);
  const serialized = Object.create(null);
  // ProseMirror's DOM serializer enumerates inherited attributes as well.
  for (const key in attributes) serialized[key] = attributes[key];
  assert.equal(serialized.src, undefined);
  assert.equal(serialized.onerror, undefined);
  assert.equal(serialized.class, "slide-run");
  assert.equal(serialized["data-slide-run-style"], "true");
});

test("math rendering ignores inherited trust permissions", () => {
  const options = Object.create({ trust: true });
  options.throwOnError = false;
  const html = katex.renderToString("\\href{javascript:alert(1)}{unsafe}", options);
  assert.doesNotMatch(html, /href=["']javascript:/i);
  assert.match(katex.renderToString("\\frac{x^2}{2}", { trust: false }), /<math/);
});

test("lint project-file patterns retain brace expansion", () => {
  const fromParser = createRequire(require.resolve("@typescript-eslint/typescript-estree"));
  const matcher = fromParser("minimatch");
  assert.deepEqual(matcher.braceExpand("slide{a,b}.ts"), ["slidea.ts", "slideb.ts"]);
  assert.equal(matcher.minimatch("slidea.ts", "slide{a,b}.ts"), true);
});

test("Markdown attribute tokenizers bound repeated invalid keys and preserve valid attributes", () => {
  for (const mode of ["atom", "block", "inline"]) {
    const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import {createAtomBlockMarkdownSpec,createBlockMarkdownSpec,createInlineMarkdownSpec} from '@tiptap/core';
      const mode=${JSON.stringify(mode)};
      const spec=(mode==='atom'?createAtomBlockMarkdownSpec:mode==='block'?createBlockMarkdownSpec:createInlineMarkdownSpec)({nodeName:'control',selfClosing:true});
      const wrap=a=>mode==='atom'?':::control {'+a+'} :::':mode==='block'?':::control {'+a+'}\\ncontent\\n:::':'[control '+a+']';
      const lexer={blockTokens:()=>[],inlineTokens:()=>[]};
      const token=spec.markdownTokenizer.tokenize(wrap(mode==='inline'?'x'.repeat(100000):'__QUOTED_0'.repeat(12000)+'__QUOTED_0__'),[],lexer);
      assert.ok(token);
      const valid=spec.markdownTokenizer.tokenize(wrap('title="valid control"'),[],lexer);
      assert.equal(valid.attributes.title,'valid control');
    `], { encoding: "utf8", timeout: 3000 });
    assert.equal(probe.status, 0, `${mode}: ${probe.error || probe.stderr}`);
  }
});

test("typography selector parser handles flat selectors with many classes", () => {
  const probe = spawnSync(process.execPath, ["-e", `
    const assert=require('node:assert/strict');
    const {createRequire}=require('node:module');
    const parser=createRequire(require.resolve('@tailwindcss/typography'))('postcss-selector-parser');
    assert.equal(parser().astSync('.a'.repeat(300000)).first.nodes.length,300000);
    assert.equal(parser().processSync('h1 > a:hover'),'h1 > a:hover');
  `], { encoding: "utf8", timeout: 3000 });
  assert.equal(probe.status, 0, String(probe.error || probe.stderr));
});

test("Cypress query parser enforces bracket comma limits and handles untrusted constructors", () => {
  const fromRequest = createRequire(require.resolve("@cypress/request"));
  const qs = fromRequest("qs");
  const options = { comma: true, arrayLimit: 3, throwOnLimitExceeded: true };
  for (const value of ["a=1,2,3,4", "a[]=1,2,3,4"]) {
    assert.throws(() => qs.parse(value, options), RangeError);
  }
  assert.deepEqual(qs.parse("a[]=1,2,3", options).a, [["1", "2", "3"]]);
  const malicious = qs.parse("a[constructor][isBuffer]=true", { plainObjects: true });
  assert.doesNotThrow(() => qs.stringify(malicious));
  const normal = { name: "slide control", items: ["first", "second"] };
  assert.deepEqual(qs.parse(qs.stringify(normal)), normal);
});
