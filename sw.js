// sw.js - Service Worker minimale per rendere l'app installabile
self.addEventListener('install', (e) => {
  console.log('[Service Worker] Installato');
});

self.addEventListener('fetch', (e) => {
  // Lascia passare tutte le richieste di rete normalmente
  // (Necessario per far funzionare Firebase in tempo reale)
  e.respondWith(fetch(e.request));
});