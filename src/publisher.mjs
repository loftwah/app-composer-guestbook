// MIT. Copied with attribution by independent mini-apps; no customer runtime dependency.
export function health(request,path,app,revision){
 if(new URL(request.url).pathname!==path)return null;
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 return new Response(request.method==='HEAD'?null:JSON.stringify({status:'up',check:'liveness',app,revision}),{headers});
}
const cappedEndpoints=new Map();
export function publish(env,context,request,event,send=fetch){
 // The header suppresses synthetic release probes; it grants no access.
 if(request.headers.get('X-Composer-Verification')==='1'||!env.USAGE_ENDPOINT||!env.USAGE_TOKEN||!context)return;
 let target;try{target=new URL(env.USAGE_ENDPOINT);if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash)return;}catch{return;}
 const day=new Date().toISOString().slice(0,10);for(const [key,date]of cappedEndpoints)if(date!==day)cappedEndpoints.delete(key);
 const key=target.href+':'+event;if(cappedEndpoints.has(key))return;
 context.waitUntil((async()=>{try{
  const response=await send(target.href,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.USAGE_TOKEN},body:JSON.stringify({contract:1,event}),redirect:'manual',signal:AbortSignal.timeout(1500)});
  if(response.headers.get('X-Usage-Limit')==='reached')cappedEndpoints.set(key,day);
  await response.body?.cancel();
 }catch{/* Optional counts never interrupt the app. No retries or request-body logging. */}})());
}
export function pageEvent(request,response,base=''){
 if(request.method!=='GET'||response.status!==200||!response.headers.get('Content-Type')?.startsWith('text/html'))return null;
 const path=new URL(request.url).pathname;
 if(path===base+'/'||path===base)return 'app_open';
 if(base.includes('guestbook')||!base){if(/^\/item\/[a-f0-9-]{36}$/.test(path.slice(base.length)))return 'item_open';}
 return null;
}
