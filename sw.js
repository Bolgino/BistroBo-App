const CACHE_NAME = 'bistrobo-cache-v1'; 
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './cliente.html',
  './preordini.html',
  './main/style.css',
  './main/script.js',
  './preordini.js',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
  './img/banconota50.png',
  './img/banconota20.png',
  './img/banconota10.png',
  './img/banconota5.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // Forza l'installazione immediata del nuovo Service Worker
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// NUOVO: Elimina le versioni vecchie della cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Eliminazione vecchia cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Ignora le richieste al database di Firebase
  if (event.request.url.includes('firebasedatabase.app')) {
    return;
  }

  // NUOVO: Strategia "Network-First" (Rete prima, Cache come fallback)
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
