const CACHE='prairie-herbarium-v3-1-1';
const FILES=['./','index.html','style.css','app.js','manifest.webmanifest'];
self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
    }).catch(()=>caches.match(event.request).then(response=>response||caches.match('./'))));
    return;
  }
  event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{
    if(response&&response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
    return response;
  }).catch(()=>caches.match(event.request)));
});