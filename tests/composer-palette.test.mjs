import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL("../" + name, import.meta.url), "utf8");

test("local Composer palette contract keeps semantic roles independently of app identity", () => {
  const css = read("public/brand/launcher.css");
  assert.match(css, /composer\.palette\/1/);
  for (const [role, color] of Object.entries({
    brand: "fc5b05", action: "fc5b05", "action-hover": "ff7a33",
    "action-pressed": "e85404", "on-action": "17181b", focus: "fc5b05",
  })) assert.match(css, new RegExp("--composer-" + role + ":\\s*#" + color));
  assert.match(css, /--composer-accent:\s*#c74400/);
  assert.match(css, /--composer-focus:\s*#c74400/);
  assert.match(css, /--composer-accent-hover:\s*#a63a00/);
  assert.match(css, /header \.composer-return:focus-visible/);
  assert.doesNotMatch(css, /#(?:ff9b55|a63d08|ffa471)\b/i);
});

test("Composer default text and primary fills use distinct semantic roles", () => {
  const css = read("src/common.ts");
  assert.match(css, /--accent:\s*var\(--composer-accent\)/);
  for (const role of ["action", "action-hover", "action-pressed", "on-action", "focus"])
    assert.ok(css.includes("var(--composer-" + role + ")"), role);
  assert.doesNotMatch(css, /#(?:ff9b55|a63d08)\b/i);
});

const luminance = (hex) => {
  const value = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1);
  const channels = value.match(/../g).map((c) => parseInt(c, 16) / 255)
    .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
test("light focus clears 3:1 on the actual app background and elevated surface", () => {
  const palette = read("public/brand/launcher.css");
  const focus = [...palette.matchAll(/--composer-focus:\s*(#[a-f0-9]{6})/gi)].at(-1)[1];
  const source = read("src/common.ts");
  const surfaces = [...source.matchAll(/--(?:bg|background|surface):\s*(#[a-f0-9]{3,6})\b/gi)].slice(-2);
  assert.equal(surfaces.length, 2);
  for (const [, background] of surfaces) {
    const values = [luminance(focus), luminance(background)].sort((a, b) => b - a);
    assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 3, focus + " on " + background);
  }
});
