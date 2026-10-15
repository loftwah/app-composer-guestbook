// MIT. App-owned release check: public HTML and image responses, never credentials or private records.
import assert from 'node:assert/strict';
export function sharingMetadata(html){
 const tags=new Map();
 for(const [tag]of html.matchAll(/<meta\s+[^>]*>/gi)){
  const attributes=Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([,key,a,b])=>[key.toLowerCase(),a??b]));
  const key=attributes.name??attributes.property;if(!key)continue;
  assert(!tags.has(key),'Duplicate sharing metadata: '+key);tags.set(key,attributes.content);
 }
 const title=html.match(/<title>([^<]+)<\/title>/i)?.[1];assert(title?.trim(),'Missing page title');
 const description=tags.get('description');assert(description?.trim(),'Missing description');
 for(const key of ['og:title','twitter:title'])assert.equal(tags.get(key),title,'Title differs: '+key);
 for(const key of ['og:description','twitter:description'])assert.equal(tags.get(key),description,'Description differs: '+key);
 assert.equal(tags.get('twitter:card'),'summary_large_image');
 assert.equal(tags.get('twitter:image'),tags.get('og:image'));
 for(const key of ['og:image:alt','twitter:image:alt'])assert(tags.get(key)?.trim(),'Missing image text: '+key);
 assert.equal(tags.get('og:image:type'),'image/jpeg');
 const width=Number(tags.get('og:image:width')),height=Number(tags.get('og:image:height'));assert(width>=1200&&height>=630,'Image dimensions missing or too small');
 return{title,description,image:tags.get('og:image'),width,height};
}
export function jpegDimensions(bytes){
 assert(bytes.length<5*1024**2&&bytes.readUInt16BE(0)===0xffd8,'Invalid/oversize JPEG');
 for(let offset=2;offset+8<bytes.length;){assert.equal(bytes[offset],0xff);const marker=bytes[offset+1],length=bytes.readUInt16BE(offset+2);assert(length>=2);if([0xc0,0xc1,0xc2].includes(marker))return{width:bytes.readUInt16BE(offset+7),height:bytes.readUInt16BE(offset+5)};offset+=length+2;}
 throw Error('JPEG dimensions unavailable');
}
async function readPublic(url,request){
 const response=await request(url,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'User-Agent':'Twitterbot/1.0','X-Composer-Verification':'1'}});
 assert.equal(response.status,200,'Public sharing response unavailable: '+url);assert(!response.headers.get('cf-mitigated'),'Sharing probe challenged');
 const chunks=[];let size=0;const reader=response.body.getReader();try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;assert(size<=5*1024**2,'Sharing response too large');chunks.push(value);}}finally{await reader.cancel();}
 return{response,bytes:Buffer.concat(chunks)};
}
export async function verifySharing(value,request=fetch){
 const origin=new URL(value);assert(origin.protocol==='https:'&&!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash,'Select the verified public HTTPS origin');
 const page=await readPublic(origin,request);assert.match(page.response.headers.get('content-type')??'',/^text\/html/);
 const metadata=sharingMetadata(page.bytes.toString()),image=new URL(metadata.image);assert(image.protocol==='https:'&&image.origin===origin.origin&&!image.username&&!image.password,'Sharing image must stay at the verified public origin');
 const asset=await readPublic(image,request);assert.match(asset.response.headers.get('content-type')??'',/^image\/jpeg/);const dimensions=jpegDimensions(asset.bytes);assert.equal(dimensions.width,metadata.width);assert.equal(dimensions.height,metadata.height);
 const result={origin:origin.origin,title:metadata.title,image:image.href,imageBytes:asset.bytes.length,...dimensions,probe:'Twitterbot/1.0',actualXRenderingVerified:false};console.log(JSON.stringify(result));return result;
}
