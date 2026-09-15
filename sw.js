/* Service worker do Treino: abre sem internet (academia costuma nao ter sinal)
 * e pega versao nova quando ha. Os dados ficam no IndexedDB, nao aqui. */
const VERSAO = "treino-1.0.1";
const ARQUIVOS = ["./", "./index.html", "./app.js", "./forca.js", "./gerador.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith("treino-") && k !== VERSAO).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // rede primeiro com revalidacao (o GitHub Pages manda guardar 10 min); cache sem sinal
  e.respondWith(
    fetch(url.href, { cache: "no-cache", credentials: "same-origin" })
      .then((r) => { if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(e.request, copia)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
