// MIT. Cache identity for published page metadata, never authority or private state.
export async function currentShareURL(canonical,title,description,image){
 const url=new URL(canonical);
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Use a public page URL.');
 url.search='';url.hash='';
 const metadata=JSON.stringify([url.href,String(title),String(description),String(image)]);
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(metadata));
 const revision=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,16);
 url.searchParams.set('share',revision);return url.href;
}
