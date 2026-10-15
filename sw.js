/* Service worker: permite instalar o app e usá-lo offline.
   Estratégia: arquivos do app são servidos do cache e atualizados em segundo plano
   (a nova versão entra na próxima abertura). Troque VERSION para forçar a limpeza do cache. */
const VERSION = 'fc-v1';
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/utils.js', 'js/parsers.js', 'js/pdfprofiles.js', 'js/engine.js', 'js/charts.js', 'js/demo.js', 'js/report.js', 'js/notes.js', 'js/app.js', 'js/pwa.js',
  'js/vendor/xlsx.full.min.js', 'js/vendor/chart.umd.min.js', 'js/vendor/jspdf.umd.min.js', 'js/vendor/jspdf.plugin.autotable.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon.svg',
];
const LAZY = [   // OCR e PDF: baixados em segundo plano após a instalação (arquivos grandes)
  'js/vendor/pdf.min.js', 'js/vendor/pdf.worker.min.js',
  'js/vendor/tesseract/tesseract.min.js', 'js/vendor/tesseract/worker.min.js', 'js/vendor/tesseract/por.traineddata',
  'js/vendor/tesseract/tesseract-core-simd-lstm.wasm.js', 'js/vendor/tesseract/tesseract-core-lstm.wasm.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(CORE);
    self.skipWaiting();
    LAZY.forEach(u => c.add(u).catch(() => {}));   // sem bloquear a instalação
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
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  })());
});
