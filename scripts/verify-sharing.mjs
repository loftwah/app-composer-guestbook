// MIT. App-owned release check: public HTML and image responses, never credentials or private records.
import assert from 'node:assert/strict';

// The page may declare the card format, width and height, or configure its own
// HTTPS share image of unknown format. Both are acceptable; a claim that does
// not match the bytes is not. Declaring all three is verified exactly, omitting
// them still requires a real raster image of at least 1200x630.
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
 const type=tags.get('og:image:type'),declaredWidth=tags.get('og:image:width'),declaredHeight=tags.get('og:image:height');
 const declaredCount=[type,declaredWidth,declaredHeight].filter(value=>value!==undefined).length;
 assert(declaredCount===0||declaredCount===3,'Declare og:image type, width and height together or not at all');
 if(declaredCount===3){
  assert.equal(type,'image/jpeg');
  assert(Number(declaredWidth)>=1200&&Number(declaredHeight)>=630,'Declared image dimensions missing or too small');
 }
 return{title,description,image:tags.get('og:image'),declared:declaredCount===3,width:Number(declaredWidth),height:Number(declaredHeight)};
}
export function jpegDimensions(bytes){
 assert(bytes.length<5*1024**2&&bytes.readUInt16BE(0)===0xffd8,'Invalid/oversize JPEG');
 for(let offset=2;offset+8<bytes.length;){assert.equal(bytes[offset],0xff);const marker=bytes[offset+1],length=bytes.readUInt16BE(offset+2);assert(length>=2);if([0xc0,0xc1,0xc2].includes(marker))return{width:bytes.readUInt16BE(offset+7),height:bytes.readUInt16BE(offset+5),format:'image/jpeg'};offset+=length+2;}
 throw Error('JPEG dimensions unavailable');
}
export function imageDimensions(bytes){
 assert(bytes.length<5*1024**2,'Sharing image is too large');
 if(bytes.readUInt16BE(0)===0xffd8)return jpegDimensions(bytes);
 if(bytes.length>24&&bytes.readUInt32BE(0)===0x89504e47&&bytes.readUInt32BE(4)===0x0d0a1a0a)return{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),format:'image/png'};
 if(bytes.length>30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
  const chunk=bytes.toString('ascii',12,16);
  if(chunk==='VP8X')return{width:(bytes.readUIntLE(24,3)&0xffffff)+1,height:(bytes.readUIntLE(27,3)&0xffffff)+1,format:'image/webp'};
  if(chunk==='VP8L'){const bits=bytes.readUInt32LE(21);return{width:(bits&0x3fff)+1,height:((bits>>14)&0x3fff)+1,format:'image/webp'};}
  if(chunk==='VP8 ')return{width:bytes.readUInt16LE(26)&0x3fff,height:bytes.readUInt16LE(28)&0x3fff,format:'image/webp'};
 }
 throw Error('Sharing image format is not a supported raster');
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
 const asset=await readPublic(image,request);
 const served=(asset.response.headers.get('content-type')??'').split(';')[0].trim();
 assert(['image/jpeg','image/png','image/webp'].includes(served),'Sharing image must be a JPEG, PNG or WebP');
 const dimensions=imageDimensions(asset.bytes);
 assert(dimensions.format===served,'Sharing image bytes disagree with the served content type');
 assert(dimensions.width>=1200&&dimensions.height>=630,'Sharing image is smaller than the 1200x630 card');
 if(metadata.declared){assert.equal(dimensions.width,metadata.width);assert.equal(dimensions.height,metadata.height);}
 const result={origin:origin.origin,title:metadata.title,image:image.href,imageBytes:asset.bytes.length,declared:metadata.declared,format:dimensions.format,width:dimensions.width,height:dimensions.height,probe:'Twitterbot/1.0',actualXRenderingVerified:false};console.log(JSON.stringify(result));return result;
}
