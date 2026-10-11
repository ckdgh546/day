/* DayWith 6.4 — PWA + Web Push; never calls a paid AI service. */
'use strict';
const CACHE_NAME = 'daywith-shell-6.4';
const SHELL = ['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('daywith-shell-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch',event=>{
  if(event.request.mode!=='navigate'||event.request.method!=='GET')return;
  const target = new URL(event.request.url);
  if(target.origin!==self.location.origin || !target.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  event.respondWith(fetch(event.request).catch(()=>caches.match('./index.html')));
});
self.addEventListener('push',event=>{
  let data={};
  try {data=event.data?.json()||{};} catch {data={body:event.data?.text()||'알림이 도착했어.'};}
  const target=new URL('.',self.registration.scope);
  try {const requested=new URL(String(data.url||''),self.registration.scope);if(requested.origin===self.location.origin&&requested.pathname.startsWith(new URL(self.registration.scope).pathname))target.href=requested.href;}catch{}
  const title=String(data.title||'DayWith 알림').slice(0,100);
  const body=String(data.body||'확인할 시간이야.').slice(0,240);
  event.waitUntil(self.registration.showNotification(title,{
    body,
    icon:'./icon-192.png',
    badge:'./icon-192.png',
    tag:String(data.tag||'daywith').slice(0,100),
    vibrate:[180,90,180],
    // Do not use silent:true together with vibrate: the Web Notifications spec forbids it.
    data:{url:target.href},
    timestamp:Date.now()
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=event.notification.data?.url || new URL('.',self.registration.scope).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const item=windows.find(c=>new URL(c.url).origin===self.location.origin && new URL(c.url).pathname.startsWith(new URL(self.registration.scope).pathname));
    if(item){await item.focus();if('navigate' in item)try{await item.navigate(url)}catch{};return;}
    await self.clients.openWindow(url);
  })());
});
