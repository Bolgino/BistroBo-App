const CACHE_NAME = 'bistrobo-cache-v3';
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
  // Aggiungi qui anche le immagini delle monete/banconote se vuoi che carichino all'istante
  './img/banconota50.png',
  './img/banconota20.png',
  './img/banconota10.png',
  './img/banconota5.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Ignora le richieste al database di Firebase per non bloccare i dati in tempo reale
  if (event.request.url.includes('firebasedatabase.app')) {
    return;
  }

  // Cache-First strategy per i file statici
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
