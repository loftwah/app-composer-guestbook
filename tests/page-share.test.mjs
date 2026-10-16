import test from'node:test';import assert from'node:assert/strict';import{currentShareURL}from'../public/brand/page-share-url.mjs';
test('published share links are stable and change when title, description or artwork changes',async()=>{
 const values=['https://example.test/profile/','Published title','Published bio','https://example.test/card-v1.jpg'];const first=await currentShareURL(...values);assert.equal(await currentShareURL(...values),first);assert.match(first,/^https:\/\/example.test\/profile\/\?share=[a-f0-9]{16}$/);
 for(const index of [1,2,3]){const changed=[...values];changed[index]+=' changed';assert.notEqual(await currentShareURL(...changed),first);}
});
test('share links omit unrelated query/hash data and keep the selected canonical path',async()=>{
 const first=await currentShareURL('https://example.test/profile/?private=draft#secret','Title','Bio','image');const url=new URL(first);assert.equal(url.origin,'https://example.test');assert.equal(url.pathname,'/profile/');assert.equal(url.hash,'');assert.deepEqual([...url.searchParams.keys()],['share']);assert.equal(first,await currentShareURL('https://example.test/profile/','Title','Bio','image'));
});
test('non-web URLs and embedded credentials cannot become share targets',async()=>{
 for(const target of ['javascript:alert(1)','file:///private/draft','https://user:secret@example.test/'])await assert.rejects(()=>currentShareURL(target,'Title','Bio','image'));
});
