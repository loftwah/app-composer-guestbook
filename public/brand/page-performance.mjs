// MIT. Measurements stay in this page; Google's standard library is Apache-2.0.
console.info('App Composer / Source, app activity and health checks\nhttps://github.com/loftwah/app-composer\nhttps://composer.loftwah.com/activity\nHealth: /healthz (mounted pair: /guestbook/healthz or /showcase/healthz)\nAdd ?vitals=1 to this page for local performance measurements. No measurements are uploaded.');
if(new URLSearchParams(location.search).get('vitals')==='1'){
 const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./page-performance.css',import.meta.url).href;document.head.append(css);
 const button=document.createElement('button');button.className='performance-open secondary';button.textContent='Page performance';button.type='button';button.setAttribute('aria-haspopup','dialog');document.body.append(button);
 const dialog=document.createElement('dialog');dialog.className='performance-view';dialog.setAttribute('aria-labelledby','performance-title');
 dialog.innerHTML='<div class="performance-heading"><h2 id="performance-title">This page load.</h2><button type="button" class="secondary">Close</button></div><p>Local measurements. Nothing in this view is uploaded.</p><dl><div><dt>Loading · LCP</dt><dd data-metric="LCP">Waiting for a measurement</dd></div><div><dt>Interaction · INP</dt><dd data-metric="INP">Interact with the page first</dd></div><div><dt>Layout shift · CLS</dt><dd data-metric="CLS">Waiting for a measurement</dd></div></dl><p class="performance-note">Values may change as you use the page. These describe one load, not every visitor. Good targets: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. Unsupported browser measurements stay unavailable.</p><p><a data-health>Read this app’s health check</a> · <a href="https://web.dev/articles/vitals">How to read Web Vitals</a></p>';
 const health=dialog.querySelector('[data-health]');health.href=/^\/guestbook(?:\/|$)/.test(location.pathname)?'/guestbook/healthz':/^\/showcase(?:\/|$)/.test(location.pathname)?'/showcase/healthz':'/healthz';
 document.body.append(dialog);button.addEventListener('click',()=>dialog.showModal());dialog.querySelector('button').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>button.focus());
 const supported=typeof PerformanceObserver==='undefined'?[]:PerformanceObserver.supportedEntryTypes;
 for(const [name,type]of [['LCP','largest-contentful-paint'],['INP','event'],['CLS','layout-shift']])if(!supported.includes(type)||(name==='INP'&&(typeof PerformanceEventTiming==='undefined'||!('interactionId' in PerformanceEventTiming.prototype))))dialog.querySelector(`[data-metric="${name}"]`).textContent='Unavailable in this browser';
 try{
  const {onCLS,onINP,onLCP}=await import('./web-vitals-v6.2.3.mjs');
  const show=metric=>{const display=dialog.querySelector(`[data-metric="${metric.name}"]`);if(!display)return;const value=metric.name==='CLS'?metric.value.toFixed(3):metric.name==='LCP'?(metric.value/1000).toFixed(2)+' s':Math.round(metric.value)+' ms';display.textContent=value+' · '+metric.rating.replaceAll('-',' ');console.info('Page performance',metric.name,value,metric.rating);};
  onCLS(show,{reportAllChanges:true});onINP(show,{reportAllChanges:true});onLCP(show,{reportAllChanges:true});
 }catch{for(const output of dialog.querySelectorAll('[data-metric]'))output.textContent='Measurement unavailable';}
}
