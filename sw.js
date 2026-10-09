// Service worker: guarda los archivos de la app en el móvil para que funcione sin conexión.
const CACHE = 'visitas-campo-v7';
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

  // Páginas y código: se abre al instante lo guardado y, en segundo plano, se descarga la versión nueva para la próxima vez.
  const esPagina = peticion.mode === 'navigate';
  const esCodigo = /\.(js|css|webmanifest)$/.test(url.pathname);
  if (esPagina || esCodigo) {
    const clave = esPagina ? 'index.html' : peticion;
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(clave).then((guardado) => {
          const red = fetch(peticion)
            .then((r) => { if (r.ok) cache.put(clave, r.clone()); return r; })
            .catch(() => guardado);
          return guardado || red;
        })
      )
    );
    return;
  }

  // El resto (letras, iconos): primero la copia guardada, que es instantánea.
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
