import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function releaseFixture(action, initialAction = "") {
  const root = mkdtempSync(join(tmpdir(), "guestbook-release-source-"));
  const workspace = join(root, "workspace");
  const bin = join(root, "bin");
  const marker = join(root, "uploaded.json");
  const migrationMarker = join(root, "migrated.json");
  mkdirSync(workspace);
  mkdirSync(bin);
  const git = (args) =>
    execFileSync("git", args, {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    copyFileSync(
      new URL("../scripts/deploy.mjs", import.meta.url),
      join(workspace, "deploy.mjs"),
    );
    writeFileSync(
      join(workspace, "verify-sharing.mjs"),
      'export async function verifySharing() { throw Error("Fictional upload must stop first"); };',
    );
    writeFileSync(
      join(workspace, "app.manifest.json"),
      '{"id":"fictional-guestbook","contract":1}',
    );
    writeFileSync(join(workspace, "package.json"), '{"type":"module"}');
    writeFileSync(join(workspace, ".gitignore"), "dist/\n");
    writeFileSync(
      join(workspace, "wrangler.jsonc"),
      '{"name":"fictional-state","main":"worker.ts","assets":{"directory":"public"}}',
    );
    writeFileSync(
      join(workspace, "worker.ts"),
      "// Fictional release fixture only.\n",
    );
    mkdirSync(join(workspace, "public"));
    writeFileSync(
      join(workspace, "public/example.json"),
      '{"name":"Fictional Mira"}',
    );
    git(["init", "-b", "main"]);
    git(["config", "user.name", "Fictional fixture"]);
    git(["config", "user.email", "fixture@example.test"]);
    git(["remote", "add", "origin", "https://github.com/fictional/state.git"]);
    git(["add", "."]);
    git(["commit", "-m", "Fictional fixture base"]);
    const base = git(["rev-parse", "HEAD"]);
    git(["commit", "--allow-empty", "-m", "Fictional reviewed candidate"]);
    const sha = git(["rev-parse", "HEAD"]);
    git(["update-ref", "refs/remotes/origin/main", sha]);
    // Run the actual deploy script and Git; only check/build/provider IO is replaced.
    writeFileSync(
      join(bin, "pnpm"),
      `#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {appendFileSync,writeFileSync} from 'node:fs';
const git=args=>execFileSync('git',args,{stdio:'ignore'});
const action=process.env.RELEASE_FIXTURE_ACTION;
if(process.argv[2]==='check') { console.log('fixture:check'); process.exit(0); }
if(process.argv[2]==='build') {
  console.log('fixture:build');
  if(action==='source') appendFileSync('worker.ts','// Changed during build.\\n');
  if(action==='hidden-target') { git(['update-index','--assume-unchanged','wrangler.jsonc']); appendFileSync('wrangler.jsonc',' '); }
  if(action==='hidden-asset') { git(['update-index','--assume-unchanged','public/example.json']); appendFileSync('public/example.json',' '); }
  if(action==='skip-asset') { git(['update-index','--skip-worktree','public/example.json']); appendFileSync('public/example.json',' '); }
  if(action==='head') git(['reset','--hard',process.env.RELEASE_FIXTURE_BASE]);
  if(action==='origin') git(['update-ref','refs/remotes/origin/main',process.env.RELEASE_FIXTURE_BASE]);
  if(action==='branch') git(['switch','-c','other']);
  if(action==='advance') { git(['commit','--allow-empty','-m','Unreviewed movement']); const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(); git(['update-ref','refs/remotes/origin/main',sha]); }
  process.exit(0);
}
const args=process.argv.slice(2);
if(args.slice(0,4).join(' ')==='wrangler d1 migrations apply') {
  writeFileSync(process.env.RELEASE_FIXTURE_MIGRATION_MARKER,JSON.stringify(args));
  console.log('fixture:migrate');
  if(action==='migration-fails') { console.error('FICTIONAL_MIGRATION_FAILURE'); process.exit(23); }
  if(action==='migration-source') appendFileSync('worker.ts','// Changed during migration.\\n');
  if(action==='migration-hidden-asset') { git(['update-index','--assume-unchanged','public/example.json']); appendFileSync('public/example.json',' '); }
  if(action==='migration-origin') git(['update-ref','refs/remotes/origin/main',process.env.RELEASE_FIXTURE_BASE]);
  process.exit(0);
}
if(args.slice(0,2).join(' ')==='wrangler deploy') {
  writeFileSync(process.env.RELEASE_FIXTURE_MARKER,JSON.stringify(args));
  console.error('FICTIONAL_UPLOAD_BOUNDARY');
  process.exit(19);
}
throw Error('Unexpected fictional command');
`,
      { mode: 0o755 },
    );
    if (initialAction) {
      git(["update-index", "--assume-unchanged", initialAction]);
      writeFileSync(
        join(workspace, initialAction),
        "// Initially hidden edit.\n",
      );
    }
    const result = spawnSync(process.execPath, ["deploy.mjs"], {
      cwd: workspace,
      env: {
        PATH: bin + ":" + process.env.PATH,
        HOME: root,
        RELEASE_FIXTURE_ACTION: action,
        RELEASE_FIXTURE_BASE: base,
        RELEASE_FIXTURE_MARKER: marker,
        RELEASE_FIXTURE_MIGRATION_MARKER: migrationMarker,
      },
      encoding: "utf8",
      timeout: 20000,
    });
    return {
      ...result,
      sha,
      uploaded: existsSync(marker)
        ? JSON.parse(readFileSync(marker, "utf8"))
        : null,
      migrated: existsSync(migrationMarker)
        ? JSON.parse(readFileSync(migrationMarker, "utf8"))
        : null,
      status: git(["status", "--porcelain"]),
    };
  } finally {
    rmSync(root, { recursive: true });
  }
}

for (const action of [
  "source",
  "hidden-target",
  "hidden-asset",
  "skip-asset",
  "head",
  "origin",
  "branch",
  "advance",
]) {
  test(`release refuses ${action} movement during build before provider upload`, () => {
    const result = releaseFixture(action);
    assert.match(result.stdout, /fixture:check\nfixture:build/);
    assert.equal(result.uploaded, null, result.stderr);
    assert.equal(
      result.migrated,
      null,
      "Build drift must stop before remote migration",
    );
    assert.match(result.stderr, /reviewed workspace changed/i);
    if (action.startsWith("hidden-") || action === "skip-asset")
      assert.equal(result.status, "");
  });
}

test("release refuses initially hidden source before verification or provider upload", () => {
  const result = releaseFixture("", "worker.ts");
  assert.equal(result.status, "");
  assert.equal(result.stdout, "");
  assert.equal(result.uploaded, null, result.stderr);
  assert.match(result.stderr, /reviewed workspace changed/i);
});

const migrationArgs = [
  "wrangler",
  "d1",
  "migrations",
  "apply",
  "DB",
  "--remote",
  "--config",
  "wrangler.jsonc",
  "--env=",
];

test("failed forward migration prevents provider upload", () => {
  const result = releaseFixture("migration-fails");
  assert.match(result.stdout, /fixture:check\nfixture:build\nfixture:migrate/);
  assert.deepEqual(result.migrated, migrationArgs);
  assert.match(result.stderr, /FICTIONAL_MIGRATION_FAILURE/);
  assert.equal(result.uploaded, null, result.stderr);
});

for (const action of [
  "migration-source",
  "migration-hidden-asset",
  "migration-origin",
]) {
  test(`release refuses ${action} movement after migration before provider upload`, () => {
    const result = releaseFixture(action);
    assert.deepEqual(result.migrated, migrationArgs);
    assert.equal(result.uploaded, null, result.stderr);
    assert.match(result.stderr, /reviewed workspace changed/i);
    if (action === "migration-hidden-asset") assert.equal(result.status, "");
  });
}

test("unchanged reviewed source reaches only the fictional upload boundary with its original SHA and config", () => {
  const result = releaseFixture("");
  assert.match(result.stdout, /fixture:check\nfixture:build/);
  assert.match(result.stderr, /FICTIONAL_UPLOAD_BOUNDARY/);
  assert.match(result.stdout, /fixture:check\nfixture:build\nfixture:migrate/);
  assert.deepEqual(result.migrated, migrationArgs);
  assert.deepEqual(result.uploaded, [
    "wrangler",
    "deploy",
    "--config",
    "wrangler.jsonc",
    "--env=",
    "--define",
    "BUILD_SHA:" + JSON.stringify(result.sha),
    "--define",
    'MANIFEST:{"id":"fictional-guestbook","contract":1}',
  ]);
});
