// 只缓存同源应用文件与内置课文。档案和导入课文保留在页面的本地存储中。
const CACHE_NAME = 'joytypy-offline-v3';
const FILES = [
  './', './index.html', './style.css', './app.js', './practice.js',
  './pinyin-engine.js', './keyboard.js', './report.js', './accounting.js',
  './portable-data.js', './vendor/pinyin-pro.js', './manifest.json',
  './icon.svg', './icon-192.png', './icon-512.png',
  './lessons/catalog.json', './lessons/春晓.txt',
  './lessons/静夜思.md', './lessons/琵琶行.md',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('joytypy-offline-') && k !== CACHE_NAME).map(k => caches.delete(k)))),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || Response.error()));
});
