// PNG only. Verify chunks, dimensions, deflate length and row filters, then remove all ancillary metadata.
function crc32(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
export async function sanitisePNG(input:Uint8Array){
 if(input.length>1048576||input.length<45||[137,80,78,71,13,10,26,10].some((v,i)=>input[i]!==v))throw new Error('Upload a PNG image no larger than 1 MB');
 const view=new DataView(input.buffer,input.byteOffset,input.byteLength);let pos=8,width=0,height=0,bpp=0,ended=false;const keep:Uint8Array[]=[input.slice(0,8)],data:Uint8Array[]=[];
 while(pos+12<=input.length){const size=view.getUint32(pos);if(size>input.length-pos-12)throw new Error('Corrupt PNG');const type=new TextDecoder().decode(input.subarray(pos+4,pos+8)),body=input.subarray(pos+8,pos+8+size);if(crc32(input.subarray(pos+4,pos+8+size))!==view.getUint32(pos+8+size))throw new Error('PNG checksum failed');
 if(type==='IHDR'){if(pos!==8||size!==13)throw new Error('Invalid image header');width=view.getUint32(pos+8);height=view.getUint32(pos+12);bpp=body[9]===6?4:body[9]===2?3:0;if(!width||!height||width>1600||height>1600||body[8]!==8||!bpp||body[10]!==0||body[11]!==0||body[12]!==0)throw new Error('Use a non-interlaced RGB/RGBA PNG up to 1600 × 1600 pixels');keep.push(input.slice(pos,pos+size+12));}
 else if(type==='IDAT'){data.push(body.slice());keep.push(input.slice(pos,pos+size+12));}
 else if(type==='IEND'){if(size!==0)throw new Error('Invalid PNG ending');keep.push(input.slice(pos,pos+12));ended=true;pos+=12;break;}
 else if(type[0]===type[0].toUpperCase())throw new Error('Unsupported PNG chunk');
 pos+=size+12;
 }
 if(!ended||pos!==input.length||!data.length)throw new Error('Incomplete PNG');
 const joined=new Uint8Array(data.reduce((n,c)=>n+c.length,0));let off=0;for(const c of data){joined.set(c,off);off+=c.length;}const reader=new Blob([joined]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();const expected=(width*bpp+1)*height;let length=0,rowOffset=0;
 while(true){const {value,done}=await reader.read();if(done)break;for(const v of value){if(rowOffset===0&&v>4){await reader.cancel();throw new Error('Invalid PNG row filter');}rowOffset=(rowOffset+1)%(width*bpp+1);}length+=value.length;if(length>expected){await reader.cancel();throw new Error('Image decoded size exceeds its header');}}
 if(length!==expected)throw new Error('Image pixel data is incomplete');const output=new Uint8Array(keep.reduce((n,c)=>n+c.length,0));off=0;for(const c of keep){output.set(c,off);off+=c.length;}return {bytes:output,width,height};
}
