// MIT. Use the same app-owned identity defines in development and build.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const mode = process.argv[2];
if (!["dev", "build"].includes(mode)) throw Error("Use dev or build.");
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const manifest = JSON.parse(readFileSync("app.manifest.json", "utf8"));
const args = [
  "wrangler",
  mode === "dev" ? "dev" : "deploy",
  "--config",
  "wrangler.jsonc",
  "--env=",
  "--define",
  "BUILD_SHA:" + JSON.stringify(sha),
  "--define",
  "MANIFEST:" + JSON.stringify(manifest),
];
if (mode === "build") args.push("--dry-run", "--outdir", "dist");
execFileSync("pnpm", args, { stdio: "inherit" });
