// MIT. Deliberate formatting scope: checked browser/publisher source and local gates.
import { check, format, resolveConfig } from "prettier";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const files = [
  "src/publisher.mts",
  "src/photo-view.ts",
  "src/member-service.ts",
  "src/worker.ts",
  "tests/member-service.test.mjs",
  "tests/photo-view.test.mjs",
  "src/resource-enquiries.ts",
  "public/brand/enquiry-form.css",
  ...readdirSync(resolve(root, "src"))
    .filter((file) => /^enquiry-.*\.ts$/.test(file))
    .map((file) => "src/" + file),
  ...readdirSync(resolve(root, "tests"))
    .filter((file) => /^enquiry-.*\.test\.mjs$/.test(file))
    .map((file) => "tests/" + file),
  ...readdirSync(resolve(root, "src/browser"), { recursive: true })
    .filter((file) => /\.(ts|mts)$/.test(file))
    .map((file) => "src/browser/" + file),
  "scripts/deploy.mjs",
  "tests/deploy-source.test.mjs",
  "tests/deployment-config.test.mjs",
  "scripts/run-worker.mjs",
  "scripts/verify-member-entrypoint.mjs",
  "scripts/build-source.mjs",
  "scripts/format-source.mjs",
  "scripts/source-map.json",
  "tsconfig.json",
  "tsconfig.publisher.json",
  "tsconfig.browser.json",
  "package.json",
];
let failed = false;
for (const file of files) {
  const path = resolve(root, file),
    source = readFileSync(path, "utf8"),
    options = { ...(await resolveConfig(path)), filepath: path };
  if (process.argv[2] === "--write")
    writeFileSync(path, await format(source, options));
  else if (!(await check(source, options))) {
    console.error("Format: " + file);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
