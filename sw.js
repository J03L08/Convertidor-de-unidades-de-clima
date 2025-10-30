const VERSION = 'v2.0.0';
const STATIC_CACHE  = `temp-converter-static-${VERSION}`;
const RUNTIME_CACHE = `temp-converter-runtime-${VERSION}`;
const MAX_RUNTIME_ENTRIES = 40;

const ASSETS = [
  './',
  './index.html',
  './converter.css',
  './converter.js',
  './manifest.json',
  './icon512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k =>
            (k.startsWith('temp-converter-static-') && k !== STATIC_CACHE) ||
            (k.startsWith('temp-converter-runtime-') && k !== RUNTIME_CACHE)
          )
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstHtml(req));
    return;
  }

  const url = new URL(req.url);

  if (url.origin === self.location.origin && isPrecached(url)) {
    event.respondWith(cacheFirstStatic(req));
    return;
  }

  event.respondWith(networkThenCacheRuntime(req));
});

function isPrecached(url) {

  const pathname = url.pathname.endsWith('/') ? './' : `.${url.pathname}`;
  return ASSETS.includes(pathname);
}

async function cacheFirstStatic(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh && fresh.ok) cache.put(req, fresh.clone());
  return fresh;
}

async function networkFirstHtml(req) {
  const staticCache = await caches.open(STATIC_CACHE);
  try {
    const fresh = await fetch(req, { cache: 'no-store' });
    
    if (fresh && fresh.ok) staticCache.put('./', fresh.clone());
    return fresh;
  } catch {
    const fallback = await staticCache.match('./');
    return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkThenCacheRuntime(req) {
  const runtime = await caches.open(RUNTIME_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok && shouldCacheRuntime(req)) {
      runtime.put(req, fresh.clone());
      trimCache(runtime, MAX_RUNTIME_ENTRIES).catch(() => {});
    }
    return fresh;
  } catch {
    const cached = await runtime.match(req);
    if (cached) return cached;
    
    const staticCache = await caches.open(STATIC_CACHE);
    return (await staticCache.match(req)) ||
           new Response('Offline', { status: 503 });
  }
}

function shouldCacheRuntime(req) {
  
  if (req.method !== 'GET') return false;
  
  const dest = req.destination;
  return ['script','style','image','font','document'].includes(dest) || dest === '';
}

async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  const deletions = keys.slice(0, keys.length - max).map(k => cache.delete(k));
  await Promise.all(deletions);
}