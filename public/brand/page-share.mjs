import {currentShareURL} from './page-share-url.mjs';
// Read only the published head. Forms, vaults, imported files and URL query data
// never enter a share link or the native share sheet.
const canonical=document.querySelector('link[rel=canonical]')?.href;
if(canonical){
 const title=document.title,description=document.querySelector('meta[name=description]')?.content??'',image=document.querySelector('meta[property="og:image"]')?.content??'';
 let published;
 try{published=await currentShareURL(canonical,title,description,image);}catch{published=null;}
 if(published)for(const container of document.querySelectorAll('[data-page-share],.profile-share')){
  const copy=container.querySelector('[data-page-copy],[data-copy-profile]'),share=container.querySelector('[data-page-native],[data-share-profile]'),output=container.querySelector('[data-share-status]'),fallback=container.querySelector('[data-share-fallback]');
  if(!copy||!share||!output||!fallback)continue;
  fallback.querySelector('input').value=published;container.hidden=false;copy.hidden=false;
  copy.addEventListener('click',async()=>{copy.disabled=true;try{await navigator.clipboard.writeText(published);output.textContent='Link copied.';fallback.hidden=true;}catch{fallback.hidden=false;const input=fallback.querySelector('input');input.focus();input.select();output.textContent='Copy the selected page URL using your browser.';}finally{copy.disabled=false;}});
  if(typeof navigator.share==='function'){
   share.hidden=false;share.addEventListener('click',async()=>{share.disabled=true;try{await navigator.share({title,text:description,url:published});output.textContent='';}catch(error){if(error?.name!=='AbortError'){fallback.hidden=false;output.textContent='Sharing is unavailable here. Copy the page link below.';}}finally{share.disabled=false;}});
  }
 }
}
