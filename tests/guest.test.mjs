import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import worker from '../src/worker.ts';

function png() {
  const crc = data => { let c=0xffffffff; for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0; };
  const chunk=(type,data)=>{const size=Buffer.alloc(4),check=Buffer.alloc(4),body=Buffer.concat([Buffer.from(type),data]);size.writeUInt32BE(data.length);check.writeUInt32BE(crc(body));return Buffer.concat([size,body,check]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,255,255,255]))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
const postcard=()=>({code:'hunter2',caption:'A fictional postcard <script>never()</script>',author:'Fictional visitor',consent:true,png:png()});
function fixture(base='') {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8'));
  const statement=(sql,values=[])=>({bind(...next){return statement(sql,next);},async first(){return sqlite.prepare(sql).get(...values)??null;},async all(){return{results:sqlite.prepare(sql).all(...values)};},async run(){sqlite.prepare(sql).run(...values);return{success:true};}});
  const objects=new Map();const origin='https://guestbook.example.test';
  const env={DB:{prepare:statement},OWNER_API_TOKEN:'fictional-private-owner-key',PUBLIC_ORIGIN:origin,MEDIA:{async put(key,bytes){objects.set(key,bytes);},async delete(key){objects.delete(key);},async get(key){return objects.has(key)?{body:new Blob([objects.get(key)]).stream()}:null;}}};
  globalThis.BUILD_SHA='f'.repeat(40);globalThis.MANIFEST={contract:1,id:'guestbook'};
  const pending=[];
  const request=(path,body,{token,ip='192.0.2.1',from=origin,verification=false,method=body?'POST':'GET'}={})=>worker.fetch(new Request(origin+base+path,{method,headers:{'Content-Type':'application/json',...(from?{Origin:from}:{}),'CF-Connecting-IP':ip,...(verification?{'X-Composer-Verification':'1'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(promise){pending.push(promise);}});
  const configure=(patch={})=>request('/api/config',{title:'Fictional guestbook',intro:'Fictional only',theme:'daylight',layout:'grid',guestAccess:'postcards',...patch},{token:env.OWNER_API_TOKEN});
  return {sqlite,env,request,configure,objects,pending};
}
for(const base of ['', '/guestbook']) test('guest pending → owner approve → public → hide/revoke, '+(base||'standalone'),async()=>{
  const f=fixture(base);try {
    assert.equal((await f.request('/api/guest-postcard',postcard())).status,403);
    assert.equal((await f.configure()).status,200);
    const response=await f.request('/api/guest-postcard',postcard());assert.equal(response.status,201);assert.equal(response.headers.get('set-cookie'),null);
    const saved=await response.json();assert.equal(saved.status,'pending');
    assert.equal(f.sqlite.prepare('SELECT status FROM photos WHERE id=?').get(saved.id).status,'pending');
    for(const path of ['/api/items/'+saved.id,'/media/'+saved.id,'/item/'+saved.id])assert.equal((await f.request(path)).status,404);
    assert.equal((await(await f.request('/api/items')).json()).items.length,0);
    assert.doesNotMatch(await(await f.request('/')).text(),/fictional postcard|Fictional visitor/);
    assert.equal((await f.request('/api/moderate',{id:saved.id,status:'approved'},{token:f.env.OWNER_API_TOKEN})).status,200);
    assert.equal((await f.request('/media/'+saved.id)).status,200);
    const detail=await(await f.request('/item/'+saved.id)).text();assert.match(detail,/<h1>A fictional postcard &lt;script&gt;never\(\)&lt;\/script&gt;<\/h1>/);if(!base)assert.match(detail,/<strong>Fictional guestbook<\/strong>/);
    const publicItem=await(await f.request('/api/items/'+saved.id)).json();assert.equal(publicItem.url,'https://guestbook.example.test'+base+'/item/'+saved.id);
    const page=await(await f.request('/')).text();assert.match(page,/&lt;script&gt;never\(\)&lt;\/script&gt;/);assert.doesNotMatch(page,/<script>never\(\)/);
    assert.equal((await f.request('/api/moderate',{id:saved.id,status:'hidden'},{token:f.env.OWNER_API_TOKEN})).status,200);
    for(const path of ['/api/items/'+saved.id,'/media/'+saved.id,'/item/'+saved.id])assert.equal((await f.request(path,null,{token:'hunter2'})).status,404);
  } finally {f.sqlite.close();}
});
test('the public code cannot log in, write owner settings/moderation/uploads/pause, export or read private media',async()=>{
  const f=fixture();try {
    await f.configure();const id=(await(await f.request('/api/guest-postcard',postcard())).json()).id;
    const rows=()=>JSON.stringify(f.sqlite.prepare('SELECT * FROM photos').all());const before=rows();
    for(const [path,body] of [['/api/login',{token:'hunter2'}],['/api/config',{title:'Damage'}],['/api/moderate',{id,status:'deleted'}],['/api/pause',{paused:true}],['/api/upload',postcard()]]) {
      const res=await f.request(path,body,{token:'hunter2'});assert.equal(res.status,401,path);assert.equal(res.headers.get('set-cookie'),null);
    }
    assert.equal((await f.request('/api/export',null,{token:'hunter2'})).status,401);
    assert.equal((await f.request('/media/'+id,null,{token:'hunter2'})).status,404);assert.equal(rows(),before);
    assert.equal((await f.request('/api/export',null,{token:f.env.OWNER_API_TOKEN})).status,200);
    assert.equal((await f.request('/api/login',{token:f.env.OWNER_API_TOKEN})).status,200);
  }finally{f.sqlite.close();}
});
test('origin, shape, consent, code and PNG refusals create no contributions or objects',async()=>{
  for(const [body,options,status] of [
    [postcard(),{from:'https://other.example.test'},403],
    [postcard(),{from:null,token:'hunter2'},403],
    [{...postcard(),id:'existing',status:'approved'},{},400],
    [{...postcard(),code:'wrong'},{},403],
    [{...postcard(),consent:false},{},400],
    [{...postcard(),caption:''},{},400],
    [{...postcard(),caption:'x'.repeat(161)},{},400],
    [{...postcard(),author:[]},{},400],
    [{...postcard(),png:'not-a-png'},{},400],
    [{...postcard(),png:'A'.repeat(151000)},{},400],
  ]) {const f=fixture();try{await f.configure();assert.equal((await f.request('/api/guest-postcard',body,options)).status,status);assert.equal(f.objects.size,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM photos').get().n,0);}finally{f.sqlite.close();}}
});
test('guest IP and global daily admission are atomic and bounded under concurrent requests',async()=>{
  const f=fixture();try{
    await f.configure();const replies=await Promise.all(Array.from({length:5},()=>f.request('/api/guest-postcard',postcard())));assert.equal(replies.filter(r=>r.status===201).length,2);assert.equal(replies.filter(r=>r.status===429).length,3);
    const more=await Promise.all(Array.from({length:16},(_,n)=>f.request('/api/guest-postcard',postcard(),{ip:'198.51.100.'+(n+1)})));
    assert.equal(more.filter(r=>r.status===201).length,6);assert.equal(more.filter(r=>r.status===429).length,10);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM photos').get().n,8);assert.equal(f.objects.size,8);
  }finally{f.sqlite.close();}
});
test('final insertion preserves queue/collection caps and observes owner closure during storage',async()=>{
  for(const mode of ['queue','collection','pause','close']){const f=fixture();try{
    await f.configure();
    if(mode==='queue'||mode==='collection'){const count=mode==='queue'?16:200;for(let n=0;n<count;n++)f.sqlite.prepare('INSERT INTO photos(id,caption,status) VALUES(?,?,?)').run('old-'+n,'Preserved fictional entry',mode==='queue'?'pending':'approved');}
    const before=f.sqlite.prepare('SELECT * FROM photos').all();
    if(mode==='pause'||mode==='close'){const put=f.env.MEDIA.put;f.env.MEDIA.put=async(...args)=>{await put(...args);if(mode==='close')await f.configure({guestAccess:'closed'});else await f.request('/api/pause',{paused:true},{token:f.env.OWNER_API_TOKEN});};}
    const response=await f.request('/api/guest-postcard',postcard());assert.equal(response.status,409,mode);assert.equal(f.objects.size,0);assert.deepEqual(f.sqlite.prepare('SELECT * FROM photos').all(),before);
  }finally{f.sqlite.close();}}
});
test('storage failures are redacted, private and retryable with retained input; old settings clients preserve guest mode',async()=>{
  const f=fixture();try{
    await f.configure();await f.request('/api/config',{title:'New fictional name',intro:'',theme:'midnight',layout:'grid'},{token:f.env.OWNER_API_TOKEN});
    assert.equal(JSON.parse(f.sqlite.prepare("SELECT value FROM settings WHERE id='config'").get().value).guestAccess,'postcards');
    assert.equal((await f.configure({guestAccess:'public'})).status,400);
    f.env.MEDIA.put=async()=>{throw Error('private provider diagnostic');};
    const res=await f.request('/api/guest-postcard',postcard());assert.equal(res.status,503);assert.doesNotMatch(await res.text(),/private provider/);assert.equal(f.objects.size,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM photos').get().n,0);
  }finally{f.sqlite.close();}
});
test('public discovery and contribution form respect owner activation and pause, never contain owner credentials',async()=>{
  const f=fixture('/guestbook');try{
    assert.doesNotMatch(await(await f.request('/contribute')).text(),/id="guest-postcard"/);
    await f.configure();const page=await(await f.request('/contribute')).text();assert.match(page,/action="\/guestbook\/api\/guest-postcard"/);assert.match(page,/brand\/guest-postcard.js/);assert.doesNotMatch(page,/fictional-private-owner-key/);
    const home=await(await f.request('/')).text();assert.match(home,/hunter2/);assert.match(home,/href="\/guestbook\/contribute"/);
    await f.request('/api/pause',{paused:true},{token:f.env.OWNER_API_TOKEN});assert.doesNotMatch(await(await f.request('/contribute')).text(),/id="guest-postcard"/);assert.equal((await f.request('/api/guest-postcard',postcard())).status,403);
  }finally{f.sqlite.close();}
});

test('an empty collection states the truth, hides search and offers only the action a visitor can take',async()=>{
  const f=fixture('/guestbook');try{
    await f.configure();
    const empty=await(await f.request('/')).text();
    assert.match(empty,/<h3>No published moments yet<\/h3>/);
    assert.match(empty,/Nothing is published yet\. A postcard appears here once the owner approves it\./);
    assert.match(empty,/href="\/guestbook\/contribute">Leave the first postcard<\/a>/);
    assert.match(empty,/<p><a class="button" href="\/guestbook\/contribute">Leave a postcard<\/a><\/p><\/div>/);
    assert.match(empty,/herethere-art-v3-960\.webp/);
    assert.doesNotMatch(empty,/Explore the moments|id="gallery-search"|id="gallery-count"|id="gallery-empty"|data-gallery-item|guestbook-character-v2|guestbook-share-v2/);
    for(const ip of ['192.0.2.21','192.0.2.22']){
      const accepted=await f.request('/api/guest-postcard',postcard(),{ip});assert.equal(accepted.status,201);
      const id=(await accepted.json()).id;assert.equal((await f.request('/api/moderate',{id,status:'approved'},{token:f.env.OWNER_API_TOKEN})).status,200);
    }
    const published=await(await f.request('/')).text();
    assert.match(published,/href="#collection">Explore the moments<\/a>/);
    assert.match(published,/href="\/guestbook\/contribute">Know the guest code\? Leave a postcard<\/a>/);
    assert.match(published,/id="gallery-search"/);
    assert.match(published,/Contributions are reviewed before they become public\./);
    assert.doesNotMatch(published,/No published moments yet|Leave the first postcard/);
    await f.request('/api/pause',{paused:true},{token:f.env.OWNER_API_TOKEN});
    const closed=await(await f.request('/')).text();
    assert.match(closed,/href="#collection">Explore the moments<\/a>/);
    assert.match(closed,/href="\/guestbook\/owner">Owner studio<\/a>/);
    assert.doesNotMatch(closed,/Leave a postcard|Know the guest code|Leave the first postcard/);
  }finally{f.sqlite.close();}
});

test('stale older settings and pause writes cannot reopen an owner-closed or paused guestbook',async()=>{
  for(const mode of ['old-settings-close','old-settings-pause','pause-close']) {
    const f=fixture();let resume;
    try {
      await f.configure();
      let started;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>resume=resolve);
      const prepare=f.env.DB.prepare;let caught=false;
      f.env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('INSERT INTO settings')){
        const bind=statement.bind;statement.bind=(...args)=>{const bound=bind(...args),run=bound.run;
          bound.run=async()=>{if(!caught){caught=true;started();await gate;}return run();};return bound;};
      }return statement;};
      const stale=mode==='pause-close'?f.request('/api/pause',{paused:false},{token:f.env.OWNER_API_TOKEN}):f.request('/api/config',{title:'Older client',intro:'',theme:'daylight',layout:'grid'},{token:f.env.OWNER_API_TOKEN});
      await ready;
      const latest=mode==='old-settings-pause'?await f.request('/api/pause',{paused:true},{token:f.env.OWNER_API_TOKEN}):await f.configure({guestAccess:'closed'});
      assert.equal(latest.status,200);resume();assert.equal((await stale).status,200);
      const config=JSON.parse(f.sqlite.prepare("SELECT value FROM settings WHERE id='config'").get().value);
      if(mode==='old-settings-pause')assert.equal(config.submissionsPaused,true);else assert.equal(config.guestAccess,'closed');
      assert.equal((await f.request('/api/guest-postcard',postcard())).status,403);
    }finally{resume?.();f.sqlite.close();}
  }
});

test('receipt publisher observes committed pending acceptance only, never private content or owner publication',async()=>{
 const f=fixture();const original=globalThis.fetch;const sent=[];try{
  await f.configure();f.env.USAGE_ENDPOINT='https://counts.example.test/api/usage/guestbook';f.env.USAGE_TOKEN='a'.repeat(48);
  globalThis.fetch=async(url,options)=>{sent.push({url,options,pendingRows:f.sqlite.prepare("SELECT COUNT(*) n FROM photos WHERE status='pending'").get().n});return new Response(null,{status:204});};
  assert.equal((await f.request('/api/guest-postcard',{...postcard(),code:'wrong'},{ip:'192.0.2.10'})).status,403);
  const put=f.env.MEDIA.put;f.env.MEDIA.put=async()=>{throw Error('private storage diagnostic');};assert.equal((await f.request('/api/guest-postcard',postcard(),{ip:'192.0.2.11'})).status,503);f.env.MEDIA.put=put;assert.equal(sent.length,0);
  const accepted=await f.request('/api/guest-postcard',postcard(),{ip:'192.0.2.12'});assert.equal(accepted.status,201);const id=(await accepted.json()).id;await Promise.all(f.pending);assert.equal(sent.length,1);assert.equal(sent[0].pendingRows,1);assert.deepEqual(JSON.parse(sent[0].options.body),{contract:1,event:'postcard_received'});assert.equal(sent[0].options.headers.Cookie,undefined);assert.equal(sent[0].options.headers.Referer,undefined);
  for(let n=0;n<2;n++)assert.equal((await f.request('/api/moderate',{id,status:'approved'},{token:f.env.OWNER_API_TOKEN})).status,200);await Promise.all(f.pending);assert.equal(sent.length,1);
  assert.equal((await f.request('/api/guest-postcard',postcard(),{ip:'192.0.2.13',verification:true})).status,201);await Promise.all(f.pending);assert.equal(sent.length,1);
 }finally{globalThis.fetch=original;f.sqlite.close();}
});
test('receipt recording outage cannot change successful submission or expose diagnostics',async()=>{
 const f=fixture('/guestbook');const original=globalThis.fetch;try{await f.configure();f.env.USAGE_ENDPOINT='https://counts.example.test/api/usage/guestbook';f.env.USAGE_TOKEN='b'.repeat(48);globalThis.fetch=async()=>{throw Error('private analytics diagnostic');};const response=await f.request('/api/guest-postcard',postcard());assert.equal(response.status,201);await Promise.all(f.pending);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM photos WHERE status='pending'").get().n,1);assert.doesNotMatch(await response.text(),/private analytics/);
 }finally{globalThis.fetch=original;f.sqlite.close();}
});
