import { verifySharing } from "./verify-sharing.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (git(["status", "--porcelain"]))
  throw new Error("Commit reviewed source before release");
if (
  git(["branch", "--show-current"]) !== "main" ||
  git(["rev-parse", "HEAD"]) !== git(["rev-parse", "origin/main"])
)
  throw new Error("Production requires exact reviewed pushed main");
// Bind verification and upload to this candidate, never a newly read post-build SHA.
const sha = git(["rev-parse", "HEAD"]);
const root = realpathSync(".");
const remote = git(["remote", "get-url", "origin"]);
const targetConfig = readFileSync("wrangler.jsonc");
const objectFormat = git(["rev-parse", "--show-object-format"]);
const files = git(["ls-tree", "-r", "-z", sha])
  .split("\0")
  .filter(Boolean)
  .map((entry) => {
    const match = /^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match)
      throw new Error("Release source must contain regular tracked files");
    return { mode: match[1], hash: match[2], path: resolve(root, match[3]) };
  });
// Compare actual bytes with the captured Git tree, including assume-unchanged and
// skip-worktree files that status alone can miss. Config is also pinned explicitly.
const unchanged = () => {
  try {
    if (
      git(["status", "--porcelain"]) ||
      git(["branch", "--show-current"]) !== "main" ||
      git(["rev-parse", "HEAD"]) !== sha ||
      git(["rev-parse", "refs/remotes/origin/main"]) !== sha ||
      git(["remote", "get-url", "origin"]) !== remote ||
      !readFileSync("wrangler.jsonc").equals(targetConfig)
    )
      throw new Error("Source or target identity changed");
    for (const file of files) {
      const stat = lstatSync(file.path);
      if (
        !stat.isFile() ||
        realpathSync(file.path) !== file.path ||
        Boolean(stat.mode & 0o111) !== (file.mode === "100755")
      )
        throw new Error("Tracked file type changed");
      const bytes = readFileSync(file.path);
      const hash = createHash(objectFormat)
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
      if (hash !== file.hash) throw new Error("Tracked source bytes changed");
    }
  } catch (cause) {
    throw new Error(
      "The reviewed workspace changed during release verification.",
      { cause },
    );
  }
};
unchanged();
execFileSync("pnpm", ["check"], { stdio: "inherit" });
execFileSync("pnpm", ["build"], { stdio: "inherit" });
unchanged();
// Apply only this reviewed app's forward migrations to the explicit root DB.
// A failed migration aborts here; source changes during it must stop upload too.
execFileSync(
  "pnpm",
  [
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "--config",
    "wrangler.jsonc",
    "--env=",
  ],
  { stdio: "inherit" },
);
unchanged();
execFileSync(
  "pnpm",
  [
    "wrangler",
    "deploy",
    "--config",
    "wrangler.jsonc",
    "--env=",
    "--define",
    "BUILD_SHA:" + JSON.stringify(sha),
    "--define",
    "MANIFEST:" +
      JSON.stringify(JSON.parse(readFileSync("app.manifest.json", "utf8"))),
  ],
  { stdio: "inherit" },
);

let verified = false;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const response = await fetch("https://guestbook.loftwah.com/build.json", {
      headers: { "User-Agent": "Mozilla/5.0 (AppComposer verification)" },
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok && (await response.json()).revision === sha) {
      verified = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
if (!verified) throw new Error("Live source identity did not converge");
// Assets can briefly 404 while a new deployment propagates to the edge. Retry the
// sharing probe so a slow asset upload cannot look like a broken social card.
let sharingVerified = false;
for (let attempt = 0; attempt < 8; attempt++) {
  try {
    await verifySharing("https://guestbook.loftwah.com");
    sharingVerified = true;
    break;
  } catch (error) {
    if (attempt === 7) throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
}
if (!sharingVerified) throw new Error("Live sharing card did not converge");
console.log("Verified live guestbook " + sha);
