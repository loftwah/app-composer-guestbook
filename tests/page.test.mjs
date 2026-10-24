import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
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
 assert.match(body,/property="og:image" content="https:\/\/composer.loftwah.com\/guestbook\/brand\/herethere-share-20261018.jpg"/);
 assert.match(body,/name="twitter:image" content="https:\/\/composer.loftwah.com\/guestbook\/brand\/herethere-share-20261018.jpg"/);
 assert.match(body,/og:image:width" content="1200"/);
});

// The switcher must show each app's current crop and its own name, never a superseded set.
test("app switcher uses the reviewed app crops and current app names",async()=>{
 const body=await html("Fixture","","/guestbook","guestbook","midnight","Description","https://composer.loftwah.com","/").text();
 for(const crop of["herethere-small-20261018","linkarooie-small-20261018","linkcheck-small-20261018","hello-small-20261018","carryforward-small-20261018"])assert.match(body,new RegExp('/guestbook/brand/apps/'+crop+'\\.webp'));
 assert.match(body,/Carry \/ forward<small>Portable assistant memory<\/small>/);
 assert.match(body,/Here \/ there<small>Photo guestbook<\/small>/);
 assert.doesNotMatch(body,/Portable AI State|small-v1\.webp|small-v2\.webp|small-v3\.webp|creators\/linkarooie-kangaroo-v1/);
});

// LDraw is the reviewed Composer destination: one authored row, the app's own
// mounted tile path, and no invented mark of its own.
test("the LDraw row keeps its exact link, local tile and authored label",async()=>{
 const mounted=await html("Fixture","","/guestbook","guestbook","midnight","Description","https://composer.loftwah.com","/").text();
 const row='<li data-destination><a href="https://ldraw.loftwah.com/"><img src="/guestbook/brand/apps/ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96.webp" width="40" height="40" alt=""><span>LDraw<small>Editable diagrams</small></span></a></li>';
 assert.ok(mounted.includes(row),"the mounted row keeps its local tile and empty alt");
 assert.ok(mounted.indexOf(row)>mounted.indexOf("Carry / forward"),"LDraw follows Carry / forward");
 assert.ok(mounted.indexOf(row)<mounted.indexOf('href="https://composer.loftwah.com/ready"'),"LDraw precedes the Composer task links");
 assert.equal(mounted.split('href="https://ldraw.loftwah.com/"').length-1,1,"exactly one LDraw destination");
 assert.doesNotMatch(mounted,/ldraw[^"<]*(logo|mark)\.(svg|png)/i);
 const standalone=await html("Fixture","","","guestbook","midnight","Description","https://guestbook.loftwah.com").text();
 assert.match(standalone,/<img src="\/brand\/apps\/ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96\.webp" width="40" height="40" alt="">/);
 assert.equal(existsSync(new URL("../public/brand/apps/ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96.webp",import.meta.url)),true,"the reviewed tile is committed locally");
 assert.ok(statSync(new URL("../public/brand/apps/ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96.webp",import.meta.url)).size>0);
});

// The shipped controller owns search, arrow/Home/End navigation, Enter and Escape.
// It indexes a destination by the first span's leading text, so the authored LDraw
// row must match the controller's own LDraw definition rather than another name.
test("the local launcher indexes LDraw for search and keeps its keyboard contract",()=>{
 const launcher=readFileSync(new URL("../public/brand/launcher.js",import.meta.url),"utf8");
 assert.match(launcher,/name: "LDraw", href: "https:\/\/ldraw\.loftwah\.com\/", image: "apps\/ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96\.webp", standaloneOnly: true, explainer: "\/ldraw", description: "Editable diagrams, PNG and SVG", keywords: "draw drawing diagram excalidraw scene png svg local offline"/);
 assert.match(launcher,/querySelector\("span:not\(\.task-icon\)"\)\?\.firstChild\?\.textContent/);
 assert.match(launcher,/value\.normalize\("NFD"\)\.replace\(\/\\p\{Diacritic\}\/gu, ""\)\.toLocaleLowerCase\("en"\)/);
 assert.match(launcher,/event\.key === "Escape"/);
 assert.match(launcher,/event\.key === "ArrowDown" \|\| event\.key === "ArrowUp" \|\| event\.key === "Home" \|\| event\.key === "End"/);
 assert.match(launcher,/\(event\.ctrlKey \|\| event\.metaKey\) && !event\.altKey && event\.key\.toLowerCase\(\) === "k"/);
});

// The footer names the product, not a personal workspace; owner attribution stays.
test("footer names App Composer and keeps the owner attribution",async()=>{
 const body=await html("Fixture","","/guestbook","guestbook","midnight","Description","https://composer.loftwah.com","/").text();
 assert.match(body,/<a href="https:\/\/composer\.loftwah\.com\/">App Composer<\/a>/);
 assert.doesNotMatch(body,/workspace/i);
 assert.match(body,/Here \/ there by Loftwah/);
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
