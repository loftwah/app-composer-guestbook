import test from "node:test";
import assert from "node:assert/strict";
import { html } from "../src/common.ts";
test("public page keeps escaped content, exact canonical and explicit social images", async () => {
  const response = html(
    "Fixture <img onerror=evil()>",
    "<h1>Fixture</h1>",
    "",
    "guestbook",
    "midnight",
    "Description",
    "https://guestbook.loftwah.com",
    "/",
  );
  const body = await response.text();
  assert.match(body, /Fixture &lt;img onerror=evil\(\)&gt;/);
  assert.match(body, /property="og:type" content="website"/);
  assert.match(body, /name="twitter:image"/);
  assert.match(body, /rel="apple-touch-icon"/);
  assert.match(body, /id="app-navigation"/);
  assert.doesNotMatch(body, /<img onerror=evil\(\)>/);
});
test("mounted page serves navigation inside its mount and owner page stays noindex", async () => {
  const response = html(
    "Fixture",
    "<h1>Fixture</h1><script>/* trusted app code */</script>",
    "/guestbook",
    "guestbook",
    "midnight",
    "Description",
    "https://composer.loftwah.com",
    "/owner",
  );
  const body = await response.text();
  assert.match(body, /src="\/guestbook\/brand\/navigation.js"/);
  assert.match(body, /noindex,nofollow/);
  assert.match(body, /<script nonce="[^"]+">/);
  const csp = response.headers.get("content-security-policy");
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.match(csp, /nonce-/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("mounted navigation and saved theme stay in the composition before painting", async () => {
 const response=html("Fixture", "<h1>Fixture</h1>", "/showcase", "showcase", "midnight", "Description", "https://composer.loftwah.com", "/owner");
 const body=await response.text(),head=body.slice(0,body.indexOf("</head>"));
 assert.match(head,/localStorage.getItem\("composer-theme"\)/);
 assert.match(head,/canonical" href="https:\/\/composer.loftwah.com\/showcase\/owner"/);
 assert.match(body, /href="\/guestbook\/"/);
 assert.match(body, /href="\/showcase\/" aria-current="page"/);
 assert.doesNotMatch(body, /href="https:\/\/(guestbook|showcase).loftwah.com"/);
 const standalone=await html("Fixture","","","guestbook","midnight","Description","https://guestbook.loftwah.com").text();
 assert.match(standalone,/localStorage.getItem\("guestbook:reader-theme"\)/);
 assert.match(standalone,/href="https:\/\/showcase.loftwah.com"/);
});
