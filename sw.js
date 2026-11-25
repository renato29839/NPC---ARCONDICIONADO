// Service worker: deixa o formulário abrir sem internet.
// Estratégia "rede primeiro": com internet sempre pega a versão nova; sem internet usa a cópia salva.
// Os envios para o Apps Script (outro domínio) não passam por aqui; a fila offline fica no script.js.
const CACHE = 'npc-manutencao-v4';
const ASSETS = [
    './', './index.html', './style.css', './script.js', './manifest.webmanifest', './logo-marca.png',
    './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE).then((cache) => cache.put(request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request, { ignoreSearch: true })
                .then((cached) => cached || caches.match('./index.html')))
    );
});
