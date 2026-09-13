import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the production plugin bundles Vapi's browser events dependency", () => {
  execFileSync(process.execPath, ["esbuild.config.mjs", "production"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
  const bundle = readFileSync(path.join(repoRoot, "main.js"), "utf8");

  assert.doesNotMatch(
    bundle,
    /require\(["']events["']\)/,
    "Obsidian Mobile cannot resolve Node's events builtin"
  );
});
