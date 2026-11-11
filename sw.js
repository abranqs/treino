/* Service worker do Treino: abre sem internet (academia costuma nao ter sinal)
 * e pega versao nova quando ha. Os dados ficam no IndexedDB, nao aqui. */
const VERSAO = "treino-1.2.2";
const ARQUIVOS = ["./", "./index.html", "./app.js", "./forca.js", "./forca_auto.js", "./saude.js", "./gerador.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];
// Com sinal fraco a rede nao falha: fica pendurada. Havendo copia guardada,
// espera pouco e abre com ela; sem copia, espera o limite inteiro.
const ESPERA_COM_COPIA_MS = 3000;
const ESPERA_SEM_COPIA_MS = 10000;

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
  // rede primeiro com revalidacao (o GitHub Pages manda guardar 10 min); cache sem sinal ou com sinal lento
  e.respondWith((async () => {
    const guardado = await caches.match(e.request, { ignoreSearch: true });
    const ctl = new AbortController();
    const limite = setTimeout(() => ctl.abort(), guardado ? ESPERA_COM_COPIA_MS : ESPERA_SEM_COPIA_MS);
    try {
      const r = await fetch(url.href, { cache: "no-cache", credentials: "same-origin", signal: ctl.signal });
      if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(e.request, copia)); }
      return r;
    } catch (erro) {
      if (guardado) return guardado;
      throw erro;
    } finally {
      clearTimeout(limite);
    }
  })());
});
