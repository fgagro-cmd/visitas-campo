// Service worker: guarda los archivos de la app en el móvil para que funcione sin conexión.
const CACHE = 'visitas-campo-v1';
const ARCHIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'visitas.js',
  'visitas.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'vendor/fonts/fraunces-latin-600-normal.woff2',
  'vendor/fonts/fraunces-latin-700-normal.woff2',
  'vendor/fonts/inter-latin-400-normal.woff2',
  'vendor/fonts/inter-latin-500-normal.woff2',
  'vendor/fonts/inter-latin-600-normal.woff2',
  'vendor/fonts/inter-latin-700-normal.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((c) => c.startsWith('visitas-campo-') && c !== CACHE).map((c) => caches.delete(c))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const peticion = event.request;
  if (peticion.method !== 'GET') return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  // Al abrir la app: primero intenta internet (así recibes las actualizaciones) y, si no hay conexión, usa la copia guardada.
  if (peticion.mode === 'navigate') {
    event.respondWith(
      fetch(peticion)
        .then((respuesta) => {
          if (respuesta.ok) {
            const copia = respuesta.clone();
            caches.open(CACHE).then((cache) => cache.put('index.html', copia));
          }
          return respuesta;
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  // El resto (letras, librerías, iconos): primero la copia guardada, que es instantánea.
  event.respondWith(
    caches.match(peticion).then((guardado) => {
      if (guardado) return guardado;
      return fetch(peticion).then((respuesta) => {
        if (respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE).then((cache) => cache.put(peticion, copia));
        }
        return respuesta;
      });
    })
  );
});
