import test from "node:test";
import assert from "node:assert/strict";
import { html, commonAPI } from "../src/common.ts";
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

// A composed route must share its own art rather than another host's root asset.
test("social image resolves inside the actual app mount",async()=>{
 const body=await html("Fixture","","/guestbook","guestbook","midnight","Description","https://composer.loftwah.com","/").text();
 assert.match(body,/property="og:image" content="https:\/\/composer.loftwah.com\/guestbook\/brand\/herethere-share-v3.jpg"/);
 assert.match(body,/name="twitter:image" content="https:\/\/composer.loftwah.com\/guestbook\/brand\/herethere-share-v3.jpg"/);
 assert.match(body,/og:image:width" content="1200"/);
});

// The switcher must show each app's current cut-paper crop and its own name, never a superseded set.
test("app switcher uses the reviewed v3 crops and current app names",async()=>{
 const body=await html("Fixture","","/guestbook","guestbook","midnight","Description","https://composer.loftwah.com","/").text();
 for(const crop of["herethere","linkarooie","linkcheck","hello","carryforward"])assert.match(body,new RegExp('/guestbook/brand/apps/'+crop+'-small-v3\\.webp'));
 assert.match(body,/Carry \/ forward<small>Portable assistant memory<\/small>/);
 assert.match(body,/Here \/ there<small>Photo guestbook<\/small>/);
 assert.doesNotMatch(body,/Portable AI State|small-v1\.webp|small-v2\.webp|creators\/linkarooie-kangaroo-v1/);
});


test("configured owner entry redirects to existing SSO without creating app authority or reading data", async () => {
 const destination="https://composer.loftwah.com/_emdash/admin/plugins/composer-miniapps/apps?app=guestbook";
 const env={OWNER_STUDIO_URL:destination,get DB(){throw Error("Owner redirect must not read app data");}};
 for(const base of["","/guestbook"])for(const method of["GET","HEAD"]){
  const response=await commonAPI(new Request("https://example.test"+base+"/owner?next=https://evil.test",{method}),env,"/owner",base,"fixture_session");
  assert.equal(response.status,302);assert.equal(response.headers.get("Location"),destination);assert.equal(response.headers.get("Set-Cookie"),null);assert.equal(response.headers.get("Cache-Control"),"no-store");assert.equal(await response.text(),"");
 }
 assert.equal(await commonAPI(new Request("https://example.test/owner"),{},"/owner","","fixture_session"),null);
 assert.equal(await commonAPI(new Request("https://example.test/api/export"),env,"/api/export","","fixture_session"),null);
});

test("invalid owner destinations fail closed and request query data cannot choose a destination",async()=>{
 for(const destination of["javascript:alert(1)","http://insecure.test/","https://user:secret@example.test/","https://example.test/owner","https://composer.loftwah.com/manage#fragment"]){
  const response=await commonAPI(new Request("https://example.test/owner"),{OWNER_STUDIO_URL:destination},"/owner","","fixture_session");assert.equal(response.status,503);assert.equal(response.headers.get("Set-Cookie"),null);assert.equal(response.headers.get("Location"),null);
 }
});
