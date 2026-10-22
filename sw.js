/* くらしの献立帖 Service Worker
 * アプリ本体はネット優先（更新がすぐ届く）、オフライン時はキャッシュから表示。
 * Supabase へのデータ通信はキャッシュしない。 */
const VERSION = 'kk-__BUILD__';
const SHELL = ['./', './index.html', './styles.css?v=__BUILD__', './app.js?v=__BUILD__', './config.js?v=__BUILD__', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png'];
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.97.0';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    try { await c.add(new Request(LIB, {mode: 'cors'})); } catch (err) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isStatic = url.href.startsWith(LIB) || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (sameOrigin) {
    e.respondWith((async () => {
      try {
        // ページ本体はブラウザのキャッシュを使わず毎回確認する（更新がすぐ届くように）
        const res = await fetch(req.mode === 'navigate' ? new Request(req.url, {cache: 'no-cache', credentials: 'same-origin'}) : req);
        if (res.ok) { const c = await caches.open(VERSION); c.put(req, res.clone()); }
        return res;
      } catch (err) {
        const c = await caches.open(VERSION);
        return (await c.match(req, {ignoreSearch: req.mode === 'navigate'})) || (req.mode === 'navigate' ? c.match('./index.html') : Response.error());
      }
    })());
  } else if (isStatic) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
  }
});
