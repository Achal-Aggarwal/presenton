import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const original = { open: fs.open, stat: fs.stat, realpath: fs.realpath };
const safe = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000000" d="M0 0h10v10z"/></svg>';
const outside = '<svg xmlns="http://www.w3.org/2000/svg" onload="outsideAttack()"/>';
let directory, icons, route, previousAppRoot;
const request = (source = "/static/icons/demo.svg", color = "#FF0000") => new Request(`http://localhost:3000/api/update-svg?${new URLSearchParams({ url: source, color })}`);

test.before(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "presenton-svg-route-")));
  icons = path.join(directory, "servers", "fastapi", "static", "icons");
  await fs.mkdir(icons, { recursive: true });
  const output = path.join(directory, "route.cjs");
  await build({ entryPoints: [path.resolve("app/api/update-svg/route.ts")], outfile: output, bundle: true, platform: "node", format: "cjs", tsconfig: path.resolve("tsconfig.json"), logLevel: "silent", plugins: [{
    name: "next-runtime", setup(builder) { builder.onResolve({ filter: /^next\/server$/ }, () => ({ path: require.resolve("next/server"), external: true })); },
  }] });
  previousAppRoot = process.env.PRESENTON_APP_ROOT;
  process.env.PRESENTON_APP_ROOT = directory;
  route = require(output);
  await fs.writeFile(path.join(directory, "outside.svg"), outside);
});

test.beforeEach(async () => {
  Object.assign(fs, original);
  await fs.rm(path.join(icons, "demo.svg"), { force: true });
  await fs.writeFile(path.join(icons, "demo.svg"), safe);
});
test.afterEach(() => Object.assign(fs, original));
test.after(async () => {
  Object.assign(fs, original);
  if (previousAppRoot === undefined) delete process.env.PRESENTON_APP_ROOT;
  else process.env.PRESENTON_APP_ROOT = previousAppRoot;
  await fs.rm(directory, { recursive: true, force: true });
});

test("community icon URLs retain local recoloring and reject markup in paint fields", async () => {
  const response = await route.GET(request("https://community.example/static/icons/demo.svg"));
  assert.equal(response.status, 200); assert.match(await response.text(), /fill="#FF0000"/);
  const rejectedPaint = await route.GET(request(undefined, '\" onload=\"outsideAttack()'));
  assert.equal(rejectedPaint.status, 200); assert.equal(await rejectedPaint.text(), safe);
});

test("outside-root paths, symlinks, non-files, and oversized SVGs are rejected", async () => {
  assert.equal((await route.GET(request("/static/icons/..%2f..%2foutside.svg"))).status, 400);
  await fs.symlink(path.join(directory, "outside.svg"), path.join(icons, "link.svg"));
  assert.equal((await route.GET(request("/static/icons/link.svg"))).status, 400);
  await fs.mkdir(path.join(icons, "folder.svg"));
  assert.equal((await route.GET(request("/static/icons/folder.svg"))).status, 404);
  await fs.writeFile(path.join(icons, "large.svg"), "x".repeat(5 * 1024 * 1024 + 1));
  assert.equal((await route.GET(request("/static/icons/large.svg"))).status, 413);
});

test("replacing the pathname after metadata validation cannot change the open SVG", async () => {
  const filename = path.join(icons, "demo.svg");
  let swapped = false;
  const swap = async () => {
    if (swapped) return;
    swapped = true;
    await fs.rename(filename, path.join(icons, "held.svg"));
    await fs.symlink(path.join(directory, "outside.svg"), filename);
  };
  fs.stat = async (...args) => { const result = await original.stat(...args); if (args[0] === filename) await swap(); return result; };
  fs.open = async (...args) => {
    const handle = await original.open(...args);
    if (args[0] === filename) {
      const stat = handle.stat.bind(handle);
      handle.stat = async (...options) => { const result = await stat(...options); await swap(); return result; };
    }
    return handle;
  };
  const response = await route.GET(request());
  assert.equal(swapped, true); assert.equal(response.status, 200);
  const markup = await response.text(); assert.match(markup, /fill="#FF0000"/); assert.doesNotMatch(markup, /outsideAttack/);
});

test("a symlink inserted between realpath and open is rejected", { skip: process.platform === "win32" }, async () => {
  const filename = path.join(icons, "demo.svg");
  fs.realpath = async (...args) => {
    const result = await original.realpath(...args);
    if (args[0] === filename) {
      await fs.unlink(filename); await fs.symlink(path.join(directory, "outside.svg"), filename);
    }
    return result;
  };
  assert.equal((await route.GET(request())).status, 400);
});

test("the read remains bounded if a validated icon grows, and its handle closes", async () => {
  const filename = path.join(icons, "demo.svg"); let closed = false;
  fs.stat = async (...args) => { const result = await original.stat(...args); if (args[0] === filename) await fs.appendFile(filename, "x".repeat(5 * 1024 * 1024)); return result; };
  fs.open = async (...args) => {
    const handle = await original.open(...args);
    if (args[0] === filename) {
      const stat = handle.stat.bind(handle), close = handle.close.bind(handle);
      handle.stat = async () => { const result = await stat(); await fs.appendFile(filename, "x".repeat(5 * 1024 * 1024)); return result; };
      handle.close = async () => { closed = true; return close(); };
    }
    return handle;
  };
  assert.equal((await route.GET(request())).status, 413); assert.equal(closed, true);
});
