/* Treino — a tela do dia no celular.
 *
 * Le o treino.json que o computador (treino-ia) publica no repositorio privado
 * ciclo-dados, mostra o dia (prontidao, treino, orientacao, sono, pressao) e
 * deixa ALTERAR qualquer sessao: tempo, modalidade e tipo. O gerador
 * (gerador.js) remonta a sessao na hora, sem internet; a escolha vai para o
 * computador como issue, e de la para o relogio (Amazfit T-Rex 3 Pro, app
 * Zepp). O registro do dia (saude.js) volta pelo mesmo caminho.
 *
 * Nada aqui fala com o relogio nem guarda senha. O token do GitHub e o mesmo do
 * Ciclo (mesmo endereco abranqs.github.io, mesmo armazenamento): precisa de
 * Contents (leitura) e Issues (leitura e escrita) no ciclo-dados.
 */
"use strict";

const VERSAO = "1.2.1";
const DEMO = new URLSearchParams(location.search).has("demo");
const $ = (s, r) => (r || document).querySelector(s);
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const agoraIso = () => new Date().toISOString();

function hojeLocal() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const DIAS_SEM = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
function nomeDia(iso, curto) {
  const d = new Date(iso + "T12:00:00");
  const h = hojeLocal();
  const am = new Date(Date.now() + 864e5), on = new Date(Date.now() - 864e5);
  const f = (x) => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  const dm = String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
  if (iso === h) return (curto ? "Hoje" : "Hoje, " + DIAS_SEM[d.getDay()].toLowerCase()) + " · " + dm;
  if (iso === f(am)) return "Amanhã · " + dm;
  if (iso === f(on)) return "Ontem · " + dm;
  return (curto ? DIAS_SEM[d.getDay()].slice(0, 3) : DIAS_SEM[d.getDay()]) + " · " + dm;
}
function toast(msg, ms) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove("on"), ms || 2600);
}

/* ------------------------------------------------------------------------- */
/* Armazenamento local (IndexedDB, com memoria de reserva)                    */
/* ------------------------------------------------------------------------- */

const MEM = { kv: {}, fila: {}, trocas: {}, forca: {} };
let BANCO = null;
function abrirBanco() {
  return new Promise((ok) => {
    try {
      const r = indexedDB.open("treino", 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv", { keyPath: "k" });
        for (const n of ["fila", "trocas", "forca"]) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: "id" });
      };
      r.onsuccess = () => { BANCO = r.result; ok(); };
      r.onerror = () => ok();
    } catch { ok(); }
  });
}
/* Gravacao que falha (armazenamento cheio, banco bloqueado) nao passa mais em
 * silencio: o que nao entrou fica em FALHAS, a tela avisa e oferece gravar de
 * novo. So vale a transacao concluida; "put" aceito ainda pode ser desfeito. */
const FALHAS = new Map();
function falhaGravar(store, chave, obj, erro) {
  FALHAS.set(store + ":" + chave, { store, chave, obj });
  S.erroGravar = String((erro && (erro.name || erro.message)) || "erro desconhecido");
  if (Date.now() - (falhaGravar.avisou || 0) > 8000) {
    falhaGravar.avisou = Date.now();
    toast("Não consegui gravar no celular. Mantenha o app aberto e veja o aviso na aba Hoje.", 6000);
  }
  pedirPersistencia();
}
function gravou(store, chave) {
  if (!FALHAS.size) return;
  FALHAS.delete(store + ":" + chave);
  if (!FALHAS.size) S.erroGravar = null;
}
async function regravarFalhas() {
  for (const f of Array.from(FALHAS.values())) await idb._grava(f.store, f.chave, f.obj);
  toast(FALHAS.size ? "Ainda não gravou. Libere espaço no celular e tente de novo." : "Gravado no celular.", 4000);
  render();
}

/* Sem armazenamento persistente o Android pode apagar o banco quando falta
 * espaco. Pede uma vez por abertura (no Chrome nao abre pergunta nenhuma). */
async function pedirPersistencia() {
  if (pedirPersistencia.feito) return;
  pedirPersistencia.feito = true;
  try {
    if (!navigator.storage || !navigator.storage.persist) return;
    S.persistente = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {}
}

const idb = {
  _t(store, modo) { return BANCO.transaction(store, modo).objectStore(store); },
  /* obj undefined = apagar a chave */
  _grava(store, chave, obj) {
    if (!BANCO) return Promise.resolve();
    return new Promise((ok) => {
      let fechou = false;
      const fim = (erro) => {
        if (fechou) return;
        fechou = true;
        if (erro) falhaGravar(store, chave, obj, erro); else gravou(store, chave);
        ok();
      };
      try {
        const tx = BANCO.transaction(store, "readwrite");
        tx.oncomplete = () => fim(null);
        tx.onerror = tx.onabort = () => fim(tx.error || new Error("gravação desfeita"));
        if (obj === undefined) tx.objectStore(store).delete(chave); else tx.objectStore(store).put(obj);
      } catch (e) { fim(e); }
    });
  },
  put(store, obj) {
    const chave = store === "kv" ? obj.k : obj.id;
    MEM[store][chave] = obj;
    return this._grava(store, chave, obj);
  },
  del(store, chave) {
    delete MEM[store][chave];
    return this._grava(store, chave, undefined);
  },
  all(store) {
    if (!BANCO) return Promise.resolve(Object.values(MEM[store]));
    return new Promise((ok) => {
      try { const r = this._t(store, "readonly").getAll(); r.onsuccess = () => ok(r.result || []); r.onerror = () => ok(Object.values(MEM[store])); } catch { ok(Object.values(MEM[store])); }
    });
  },
  async get(store, chave) { return (await this.all(store)).find((x) => (store === "kv" ? x.k : x.id) === chave); },
};

/* ------------------------------------------------------------------------- */
/* Estado e sincronizacao                                                     */
/* ------------------------------------------------------------------------- */

const S = { pac: null, recebido: 0, fila: [], trocas: [], forca: [], registros: [], aba: "hoje", buscando: false, erroSync: null, erroFila: null,
  erroGravar: null, semBanco: false, persistente: null };

const CFG = {
  ler(k, pad) { try { return localStorage.getItem(k) || pad; } catch { return pad; } },
  get repo() { return this.ler("ciclo_repo", "abranqs/ciclo-dados"); },
  get token() { return this.ler("ciclo_token", ""); },
};

function cabecalhos(extra) {
  return Object.assign({ Authorization: "Bearer " + CFG.token, "X-GitHub-Api-Version": "2022-11-28" }, extra || {});
}

/* Toda ida a rede tem tempo-limite. Com sinal fraco o fetch ficava pendurado
 * para sempre: a abertura travava em "Buscando" e a fila nunca mais saia. O
 * limite vale para a resposta chegar e, de novo, para o corpo terminar de vir. */
const LIMITE_REDE_MS = 10000;
const LIMITE_ENVIO_MS = 15000;
async function pedir(url, opcoes, ms) {
  const limite = ms || LIMITE_REDE_MS;
  const ctl = new AbortController();
  let h = setTimeout(() => ctl.abort(), limite);
  try {
    const r = await fetch(url, Object.assign({}, opcoes, { signal: ctl.signal }));
    clearTimeout(h);
    h = setTimeout(() => ctl.abort(), limite);
    const texto = await r.text();
    return { status: r.status, ok: r.ok, json: () => JSON.parse(texto) };
  } catch (e) {
    if (!ctl.signal.aborted) throw e;
    const lento = new Error("a rede não respondeu em " + Math.round(limite / 1000) + " s (sinal fraco)");
    lento.lento = true;
    throw lento;
  } finally {
    clearTimeout(h);
  }
}

async function buscar(silencioso) {
  if (S.buscando) return;
  if (!DEMO && !CFG.token) { render(); return; }
  if (!navigator.onLine && !DEMO) { if (!silencioso) toast("Sem internet — mostrando o que já está no celular"); return; }
  S.buscando = true;
  renderTopo();
  try {
    let r;
    if (DEMO) {
      r = await pedir("_local/treino.json", { cache: "no-store" });
    } else {
      r = await pedir("https://api.github.com/repos/" + CFG.repo + "/contents/treino.json",
        { headers: cabecalhos({ Accept: "application/vnd.github.raw+json" }), cache: "no-store" });
      if (r.status === 401) throw new Error("token inválido ou expirado");
      if (r.status === 404) throw new Error("treino.json não encontrado — o computador ainda não publicou, ou o token não vê o ciclo-dados");
      if (!r.ok) throw new Error("GitHub respondeu " + r.status);
    }
    let j;
    try { j = r.json(); } catch { throw new Error("o treino.json chegou incompleto"); }
    if (!j || typeof j !== "object") throw new Error("o treino.json veio vazio");
    S.pac = j;
    S.recebido = Date.now();
    S.erroSync = null;
    await idb.put("kv", { k: "pac", v: j, t: S.recebido });
    await limparAplicados();
    if (!silencioso) toast("Atualizado");
  } catch (e) {
    S.erroSync = e.message;
    if (!silencioso) toast("Não atualizou: " + e.message, 5000);
  } finally {
    S.buscando = false;
    renderSeLivre();
    enviarFila();
  }
}

/* Treino de forca e registro do dia que o computador ja confirmou nao precisam
 * mais sair daqui. Acontece quando a issue foi criada mas a resposta se perdeu
 * (tempo-limite): sem isto, a fila mandaria a mesma coisa de novo. Troca nao
 * entra: ela pode ter sido alterada de novo no celular com o mesmo id. */
async function tirarDaFila(id) {
  if (!S.fila.some((f) => f.id === id)) return;
  S.fila = S.fila.filter((f) => f.id !== id);
  await idb.del("fila", id);
}

function salvarRegistros() { return idb.put("kv", { k: "registros", v: S.registros }); }

const FOLGA_RELOGIO_MS = 60000;   // diferenca toleravel entre o relogio do celular e o do computador

/* A troca feita aqui vira oficial quando o computador a aplica e republica.
 * Ate la ela e mostrada por cima do que veio publicado. */
async function limparAplicados() {
  if (!S.pac) return;
  const aplicadas = new Map((S.pac.trocas_aplicadas || []).map((t) => [t.id, t]));
  for (const t of S.trocas.slice()) {
    const a = aplicadas.get(t.id);
    if (!a) continue;
    // so sai do celular a troca que o computador aplicou de fato (resultado ok)
    if (!(a.resultado && a.resultado.atrasada) && (a.aplicado_em || (a.resultado && a.resultado.ok))) { await idb.del("trocas", t.id); S.trocas = S.trocas.filter((x) => x.id !== t.id); continue; }
    // recusada por atraso (chegou depois do dia ou do treino): reenviar nao adianta. So avisa e deixa desfazer.
    if (a.resultado && a.resultado.atrasada) {
      await tirarDaFila(t.id);
      if (!t.atrasada) {
        if (t.data >= hojeLocal()) toast("Uma alteração chegou atrasada ao computador e não foi aplicada.", 5000);
        t.atrasada = true;
        t.falha = String(a.resultado.erro || "chegou atrasada").slice(0, 120);
        t.enviada_em = null;
        await idb.put("trocas", t);
      }
      continue;
    }
    // recusada: fica pendente, com aviso na tela, e volta para a fila na proxima abertura (iniciar)
    if (S.fila.some((f) => f.id === t.id)) continue;
    // reenviada: o resultado publicado pode ser o da tentativa anterior. Com
    // recebido_em o computador diz quando viu a issue; se foi antes do reenvio,
    // ainda nao e a resposta desta tentativa. Sem o campo, folga fixa de 10 min.
    if (t.falha && t.enviada_em) {
      const reenvio = new Date(t.enviada_em).getTime();
      const visto = a.recebido_em ? new Date(a.recebido_em).getTime() : NaN;
      if (!isNaN(visto)) { if (visto < reenvio - FOLGA_RELOGIO_MS) continue; }
      else if (Date.now() - reenvio < 10 * 60000) continue;
    }
    if (!t.falha) toast("Uma alteração não foi aplicada no computador — continua pendente aqui.", 5000);
    t.falha = String((a.resultado && a.resultado.erro) || "sem motivo informado").slice(0, 120);
    t.enviada_em = null;
    await idb.put("trocas", t);
  }
  const recebidos = new Set(S.pac.forca_recebidos || []);
  for (const f of S.forca) {
    if (f.status === "concluido" && recebidos.has(f.id) && !f.no_computador) { f.no_computador = true; await idb.put("forca", f); await tirarDaFila(f.id); }
  }
  // registro do dia: sai do celular quando o computador publica o id em registros_recebidos
  const registrados = new Set(S.pac.registros_recebidos || []);
  if (S.registros.some((r) => registrados.has(r.id))) {
    for (const r of S.registros) if (registrados.has(r.id)) await tirarDaFila(r.id);
    S.registros = S.registros.filter((r) => !registrados.has(r.id));
    await salvarRegistros();
  }
}

async function enfileirar(titulo, corpo) {
  const item = { id: corpo.id, titulo, corpo, criado_em: agoraIso(), tentativas: 0 };
  S.fila.push(item);
  await idb.put("fila", item);
  enviarFila();
}

/* Troca de um dia que ja passou nao serve para mais nada: aplicada agora,
 * reescreveria uma sessao ja feita. Sai da fila sozinha. Treino de forca
 * registrado nunca sai: e historico e precisa chegar ao computador. */
async function limparFilaVencida() {
  const hoje = hojeLocal();
  for (const f of S.fila.slice()) {
    const d = (f.corpo && f.corpo.data) || "";
    if (/^treino-app troca /.test(f.titulo) && d && d < hoje) {
      S.fila = S.fila.filter((x) => x.id !== f.id);
      await idb.del("fila", f.id);
      S.trocas = S.trocas.filter((x) => x.id !== f.id);
      await idb.del("trocas", f.id);
    }
  }
  if (!S.fila.length) S.erroFila = null;
}

async function descartarFila() {
  for (const f of S.fila.slice()) {
    await idb.del("fila", f.id);
    if (/^treino-app troca /.test(f.titulo)) { S.trocas = S.trocas.filter((x) => x.id !== f.id); await idb.del("trocas", f.id); }
  }
  S.fila = S.fila.filter((f) => !/^treino-app troca /.test(f.titulo));
  if (!S.fila.length) S.erroFila = null;
  render();
}

async function enviarFila(manual) {
  await limparFilaVencida();
  if (enviarFila.rodando || !S.fila.length) { if (manual) { toast("Nada para enviar."); render(); } return; }
  if (!DEMO && !CFG.token) { if (manual) toast("Sem token neste celular — cole em Conexão.", 4000); return; }
  if (!DEMO && !navigator.onLine) { if (manual) toast("Sem internet agora.", 3000); return; }
  if (manual) toast("Enviando…");
  enviarFila.rodando = true;
  try {
    // Um item por vez, sempre o mais antigo ainda nao tentado NESTA rodada. A fila e
    // relida a cada volta: o que entrou durante o envio (o registro de hoje logo
    // atras do de ontem) sai na mesma rodada, e o que foi confirmado nesse meio-tempo nao e reenviado.
    const tentados = new Set();
    for (;;) {
      const item = S.fila.filter((x) => !tentados.has(x.id)).sort((a, b) => a.criado_em.localeCompare(b.criado_em))[0];
      if (!item) break;
      tentados.add(item.id);
      let ok = false;
      if (DEMO) {
        await new Promise((r) => setTimeout(r, 400));
        console.log("[demo] issue", item.titulo, item.corpo);
        ok = true;
      } else {
        const r = await pedir("https://api.github.com/repos/" + CFG.repo + "/issues", {
          method: "POST", headers: cabecalhos({ Accept: "application/vnd.github+json", "Content-Type": "application/json" }),
          body: JSON.stringify({ title: item.titulo, body: JSON.stringify(item.corpo) }),
        }, LIMITE_ENVIO_MS);
        if (r.status === 201) ok = true;
        else if ([401, 403, 404].includes(r.status)) {
          let msg = "";
          try { msg = r.json().message || ""; } catch {}
          S.erroFila = "O token não pode criar issues no ciclo-dados (GitHub " + r.status + (msg ? ": " + msg : "") +
            "). Confira no GitHub se a permissão Issues: Read and write foi salva no MESMO token que está neste celular.";
          break;
        } else {
          S.erroFila = "GitHub respondeu " + r.status + " — tento de novo depois.";
          break;
        }
      }
      if (ok) {
        S.erroFila = null;
        S.fila = S.fila.filter((x) => x.id !== item.id);
        await idb.del("fila", item.id);
        const t = S.trocas.find((x) => x.id === item.id);
        if (t) { t.enviada_em = agoraIso(); await idb.put("trocas", t); }
        const f = S.forca.find((x) => x.id === item.id);
        if (f) { f.enviado_em = agoraIso(); await idb.put("forca", f); }
        const g = S.registros.find((x) => x.id === item.id);
        if (g) { g.enviado_em = agoraIso(); await salvarRegistros(); }
      }
    }
  } catch (e) {
    S.erroFila = e && e.lento
      ? "A rede não respondeu a tempo (sinal fraco) — o que está na fila sai quando o sinal melhorar."
      : "Sem conexão com o GitHub — o que está na fila sai quando voltar.";
  } finally {
    enviarFila.rodando = false;
    if (manual) toast(S.erroFila ? S.erroFila : "Enviado.", S.erroFila ? 6000 : 2500);
    renderSeLivre();
  }
}

/* ------------------------------------------------------------------------- */
/* Dados derivados                                                            */
/* ------------------------------------------------------------------------- */

function diasVisiveis() {
  const dias = JSON.parse(JSON.stringify((S.pac && S.pac.dias) || []));
  const porData = (d) => {
    let x = dias.find((y) => y.data === d);
    if (!x) { x = { data: d, sessoes: [] }; dias.push(x); }
    return x;
  };
  for (const t of S.trocas.slice().sort((a, b) => a.criado_em.localeCompare(b.criado_em))) {
    const dia = porData(t.data);
    const alvoId = t.sessao_id != null ? t.sessao_id : "local-" + (t.ref_troca || "");
    const i = dia.sessoes.findIndex((s) => String(s.id) === String(alvoId));
    if (t.acao === "remover") { if (i >= 0) dia.sessoes.splice(i, 1); continue; }
    const nova = Object.assign({}, i >= 0 ? dia.sessoes[i] : {}, t.sessao, {
      id: i >= 0 ? dia.sessoes[i].id : "local-" + t.id, origem: "celular", local: t, no_relogio: null,
      status: "ajustado", modelo: i >= 0 ? dia.sessoes[i].modelo : null,
    });
    if (i >= 0) dia.sessoes[i] = nova; else dia.sessoes.push(nova);
  }
  return dias.sort((a, b) => a.data.localeCompare(b.data));
}

function historicoForca() {
  const h = JSON.parse(JSON.stringify((S.pac && S.pac.forca_historico) || {}));
  const recebidos = new Set((S.pac && S.pac.forca_recebidos) || []);
  for (const f of S.forca) {
    if (f.status !== "concluido" || recebidos.has(f.id)) continue;
    for (const e of f.exercicios) {
      if (!e.feitas || !e.feitas.length) continue;
      (h[e.chave] = h[e.chave] || []).push({
        data: f.data, alvo: { reps_min: e.reps_min, reps_max: e.reps_max, rir: e.rir },
        series: e.feitas.map((s) => [s.kg, s.reps != null ? s.reps : s.s, s.rir, s.auto ? 1 : 0]),
      });
    }
  }
  for (const k of Object.keys(h)) h[k].sort((a, b) => b.data.localeCompare(a.data));
  return h;
}

function ctxGerador(data) {
  const p = S.pac || {};
  return { catalogo: p.catalogo_forca || {}, historico: historicoForca(), prescricao: data === (p.hoje || "") ? p.prescricao : null,
    descansos: typeof descansosPreferidos === "function" ? descansosPreferidos() : {} };
}

function modelosDe(mod, sessao) {
  const p = S.pac || {};
  const ordem = { plano: 0, leve: 1, longo: 2, tecnica: 3, moderado: 4, prova: 5, forte: 6 };
  let lista = mod === "forca"
    ? (p.modelos_forca || []).map((m) => Object.assign({ modalidade: "forca", padrao: 45, min: 15, max: 120, grupo: "forca" }, m))
    : (p.modelos || []).filter((m) => m.modalidade === mod);
  lista = lista.slice().sort((a, b) => (ordem[a.grupo] || 9) - (ordem[b.grupo] || 9));
  const doPlano = sessao && sessao.modelo && sessao.modelo.modalidade === mod ? sessao.modelo : null;
  return doPlano ? [doPlano].concat(lista) : lista;
}

const CORES_MOD = { corrida: "var(--corrida)", bike: "var(--bike)", natacao: "var(--natacao)", forca: "var(--forca)", brick: "var(--brick)", descanso: "var(--descanso)" };
const ICONE_MOD = { corrida: "🏃", bike: "🚴", natacao: "🏊", forca: "🏋", brick: "🔁", descanso: "🌙" };
const CORES_INT = ["var(--i0)", "var(--i1)", "var(--i2)", "var(--i3)", "var(--i4)", "var(--i5)"];

function fmtMin(m) {
  m = Math.round(m || 0);
  return m >= 60 ? Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0") : m + " min";
}

/* ------------------------------------------------------------------------- */
/* Render                                                                     */
/* ------------------------------------------------------------------------- */

function render() {
  document.querySelectorAll("#abas button").forEach((b) => b.classList.toggle("on", b.dataset.aba === S.aba));
  const tela = $("#tela");
  if (!S.pac && !DEMO && !CFG.token) { tela.innerHTML = htmlBoasVindas(); ligarConexao(); return; }
  if (!S.pac) {
    tela.innerHTML = '<div class="vazio">' + (S.buscando ? "Buscando o treino…" : esc(S.erroSync || "Nada recebido ainda.")) +
      '<br><br><button class="btn main" id="tentar">Tentar de novo</button></div>';
    const b = $("#tentar"); if (b) b.onclick = () => buscar(false);
    return;
  }
  ({ hoje: renderHoje, semana: renderSemana, saude: renderSaude, forca: renderForcaAba, mais: renderMais })[S.aba]();
}

/* Redesenho pedido pela sincronizacao (nao por um toque): se ha um campo em
 * uso, espera ele perder o foco. Redesenhar no meio fecha o teclado do Android. */
function digitando() {
  const a = document.activeElement;
  return !!(a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.closest && a.closest("#tela"));
}
function renderSeLivre() {
  if (digitando()) { renderSeLivre.pendente = true; renderTopo(); return; }
  renderSeLivre.pendente = false;
  render();
}

function renderTopo() {
  const b = $("#btnSync");
  if (b) b.textContent = S.buscando ? "…" : "↻";
}

function htmlTopo(titulo, sub) {
  const pend = S.fila.length;
  return '<div class="topo"><div><h1>' + esc(titulo) + '</h1><div class="sub">' + sub + "</div></div><div class=\"sp\"></div>" +
    (pend ? '<span class="badge warn" title="itens esperando envio">' + pend + " na fila</span>" : "") +
    '<button class="icon" id="btnSync" aria-label="Atualizar">' + (S.buscando ? "…" : "↻") + "</button></div>";
}

function quandoRecebido() {
  if (!S.pac || !S.pac.gerado_em) return "";
  const g = new Date(S.pac.gerado_em);
  return "computador: " + g.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function avisosGerais() {
  let h = "";
  if (S.erroGravar) h += '<div class="aviso veto">Não consegui gravar no celular (' + esc(S.erroGravar) + "). O que você fez continua na tela, mas se perde se o app fechar. " +
    'Libere espaço no celular e toque em gravar de novo.<div class="acoes"><button class="btn small" id="regravar">Gravar de novo</button></div></div>';
  else if (S.semBanco) h += '<div class="aviso veto">Este navegador não abriu o armazenamento local (aba anônima ou bloqueio). O que você registrar vale só enquanto o app estiver aberto.</div>';
  if (S.erroFila && S.fila.length) h += '<div class="aviso veto">' + esc(S.erroFila) + '<div class="acoes"><button class="btn small" id="tentarFila">Tentar enviar de novo</button> <button class="btn small ghost" id="descartarFila">Descartar alterações</button></div></div>';
  for (const t of S.trocas) {
    if (!t.falha || t.data < hojeLocal()) continue;
    h += '<div class="aviso veto">A alteração de ' + esc(nomeDia(t.data, true)) + " não foi aplicada no computador (" + esc(t.falha) + "). " +
      (t.atrasada ? 'Chegou atrasada e não será reenviada. <button class="btn small ghost" data-desfazer="' + esc(t.id) + '">Desfazer alteração</button>' :
        t.enviada_em ? "Foi reenviada; aguardando o computador." :
        'Continua pendente e é reenviada na próxima abertura. <button class="btn small ghost" data-desfazer="' + esc(t.id) + '">Desfazer alteração</button>') + "</div>";
  }
  if (S.erroSync) h += '<div class="aviso">Última atualização falhou: ' + esc(S.erroSync) + "</div>";
  if (S.pac && S.pac.hoje !== hojeLocal()) {
    h += '<div class="aviso">Os dados são de ' + esc(nomeDia(S.pac.hoje)) + ": o computador ainda não publicou hoje. Prontidão e noite ficam para quando ele ligar; o plano do dia já está aqui.</div>";
  }
  return h;
}

function renderHoje() {
  const p = S.pac;
  const h = hojeLocal();
  const dia = diasVisiveis().find((d) => d.data === h) || { data: h, sessoes: [] };
  let html = htmlTopo(nomeDia(h), esc(quandoRecebido()) + (p.prova && p.prova.dias != null && p.prova.dias >= 0 ? " · " + esc(p.prova.nome) + " em " + p.prova.dias + " dias" : ""));
  html += avisosGerais();
  html += htmlMetaSemana(p.meta_semana, false);
  if (p.hoje === h) html += htmlProntidao(p);
  html += "<h2>Treino de hoje</h2>";
  if (!dia.sessoes.length) html += '<div class="card vazio">Sem treino planejado hoje.</div>';
  dia.sessoes.forEach((s) => { html += htmlSessao(s, h); });
  html += '<button class="btn ghost" style="width:100%" data-add="' + h + '">+ Adicionar treino hoje</button>';
  html += htmlOrientacao(p, h);
  if (typeof htmlSonoPressaoHoje === "function") html += htmlSonoPressaoHoje(p);
  if (typeof htmlRegistro === "function") html += htmlRegistro();
  $("#tela").innerHTML = html;
  ligarTela();
  if (typeof ligarRegistro === "function") ligarRegistro();
}

/* A orientacao do treinador abre com o que nao pode passar batido (a linha do
 * treino de hoje e os avisos que o computador poe no topo); esse comeco fica
 * sempre a vista e o resto abre no toque. */
function htmlOrientacao(p, h) {
  const o = p.orientacao;
  const deHoje = !!(o && o.texto && o.criado_em && o.criado_em.slice(0, 10) === h);
  // aviso publicado a parte (p.avisos) que nao esteja repetido no texto tambem aparece
  const chapa = (t) => String(t || "").normalize("NFD").toLowerCase().replace(/[^a-z0-9]/g, "");
  const soltos = (p.hoje === h && Array.isArray(p.avisos) ? p.avisos : []).filter((a) => a && !(deHoje && chapa(o.texto).includes(chapa(a))));
  const avisos = soltos.map((a) => '<div class="aviso">' + esc(a) + "</div>").join("");
  if (!deHoje) return "<h2>Orientação do treinador</h2>" + avisos + '<div class="card flat sub">A orientação de hoje ainda não chegou.</div>';
  const partes = String(o.texto).replace(/\r/g, "").split(/\n\s*\n/).filter((x) => x.trim());
  // os avisos vem antes da linha "TREINO DE HOJE": fica a vista tudo ate ela (ou so o primeiro paragrafo, se ela nao existir)
  const iTreino = partes.slice(0, 6).findIndex((t) => /^\s*\*{0,2}\s*treino de hoje/i.test(t));
  const n = iTreino >= 0 ? iTreino + 1 : 1;
  const topo = partes.slice(0, n).join("\n\n"), resto = partes.slice(n).join("\n\n");
  return "<h2>Orientação do treinador</h2>" + avisos + '<div class="card"><div class="md">' + markdown(topo) + "</div>" +
    (resto ? "<details><summary>Ler a orientação completa das " + esc(o.criado_em.slice(11, 16)) + '</summary><div class="md">' + markdown(resto) + "</div></details>" : "") + "</div>";
}

function corScore(v) { return v == null ? "var(--i0)" : v >= 75 ? "var(--ok)" : v >= 55 ? "var(--warn)" : "var(--bad)"; }

/* Prontidao calculada sem VFC da noite, ou com confianca baixa, e um numero
 * provisorio: aparece assim, sem o rotulo de faixa. */
function prontidaoProvisoria(p) {
  const pr = p.prontidao || {}, ps = p.prescricao || {};
  if (pr.provisoria || /baixa/i.test(String(pr.confianca || ""))) return "confiança baixa";
  const temVfc = (ps.hrv && ps.hrv.rmssd) || (p.noite && p.noite.rmssd) || (pr.componentes && pr.componentes.hrv != null);
  return temVfc ? "" : "sem VFC desta noite";
}

function htmlProntidao(p) {
  const pr = p.prontidao || {}, ps = p.prescricao || {};
  const v = pr.score;
  const c = 2 * Math.PI * 40, frac = v == null ? 0 : Math.max(0, Math.min(1, v / 100));
  const prov = prontidaoProvisoria(p);
  const nivel = prov ? ["provisória · " + prov, ""]
    : { alta: ["liberado para forte", "ok"], moderada: ["até moderado (sem Z4-Z5)", "warn"], baixa: ["só leve", "bad"], zero: ["descanso", "bad"] }[ps.intensidade_max] || ["", ""];
  let h = '<div class="card"><div class="pront"><div class="anel"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--card2)" stroke-width="10"/>' +
    '<circle cx="50" cy="50" r="40" fill="none" stroke="' + (prov ? "var(--mute)" : corScore(v)) + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + (c * frac) + " " + c + '"/></svg>' +
    '<b class="num">' + (v == null ? "—" : Math.round(v)) + "</b><small>PRONTIDÃO</small></div><div>" +
    (nivel[0] ? '<span class="badge ' + nivel[1] + '"><span class="dot"></span>' + esc(nivel[0]) + "</span>" : "") +
    (ps.fator_volume && ps.fator_volume !== 1 ? ' <span class="badge warn">volume ×' + ps.fator_volume + "</span>" : "") +
    '<div class="regra" style="margin-top:6px">' + esc(ps.resumo || "") + "</div></div></div>";
  const hrv = ps.hrv || {};
  h += '<div class="mini"><div><span>Sono</span><b class="num">' + (p.sono && p.sono.duracao_min ? fmtMin(p.sono.duracao_min) : "—") + "</b></div>" +
    (hrv.rmssd
      ? '<div><span>RMSSD teste</span><b class="num">' + Math.round(hrv.rmssd) + '</b><small class="sub"> ' + (hrv.baseline ? "base " + Math.round(hrv.baseline) : "") + "</small></div>"
      : '<div><span>VFC do sono</span><b class="num">' + (p.noite && p.noite.rmssd ? Math.round(p.noite.rmssd) : "—") + '</b><small class="sub"> ms</small></div>') +
    '<div><span>ACWR</span><b class="num">' + (ps.acwr != null ? String(ps.acwr).replace(".", ",") : "—") + "</b></div></div></div>";
  return h;
}

/* Sinais da ultima noite (VFC, FC, SpO2): entra no cartao de sono da aba Saude. */
function htmlNoite(n) {
  const sit = { dentro: "ok", acima: "warn", abaixo: "warn" };
  let h = '<div><div class="row"><div><b style="font-size:22px" class="num">' + (n.rmssd ? Math.round(n.rmssd) + " ms" : "—") +
    '</b> <span class="sub">VFC do sono</span></div><div class="sp"></div>' +
    (n.cobertura_pct != null ? '<span class="badge ' + (n.cobertura_pct >= 80 ? "ok" : "warn") + '">' + Math.round(n.cobertura_pct) + "% do sono</span>" : "") + "</div>" +
    '<div class="sub" style="margin:4px 0 8px">' + esc(n.status || "") + "</div><div class=\"chips wrap\">";
  (n.sinais || []).forEach((s) => {
    if (s.valor == null) return;
    h += '<span class="badge ' + (sit[s.situacao] || "") + '">' + esc(s.nome) + " " + esc(Math.round(s.valor * 10) / 10) + "</span>";
  });
  return h + "</div></div>";
}

function htmlSemanaResumo(sem) {
  const nomes = { corrida: "Corrida", bike: "Bike", natacao: "Natação", forca: "Força" };
  let h = '<h2>Por modalidade</h2><div class="card">';
  for (const [k, m] of Object.entries(sem.modalidades || {})) {
    if (!m) continue;
    const alvo = Math.max(m.plano_min || 0, m.feito_min || 0, 1);
    const meta = m.meta_sessoes ? " · " + m.sessoes_feitas + "/" + m.meta_sessoes + " sessões" : "";
    h += '<div class="mod"><span>' + esc(nomes[k] || k) + '</span><div class="trilho"><span style="width:' + Math.min(100, 100 * (m.feito_min || 0) / alvo) +
      "%;background:" + (CORES_MOD[k] || "var(--acc)") + '"></span>' + (m.plano_min ? '<u style="left:calc(' + Math.min(100, 100 * m.plano_min / alvo) + '% - 2px)"></u>' : "") +
      '</div><span class="sub num">' + (m.feito_min || 0) + "/" + (m.plano_min || 0) + " min" + meta + "</span></div>";
  }
  return h + '<div class="sub">Traço: planejado na semana. Barra: feito até agora (atividades do relógio).</div></div>';
}

/* Feito x planejado, dia a dia, em minutos: duas colunas por dia. */
function htmlSemanaDias(sem) {
  const dias = sem && Array.isArray(sem.dias) ? sem.dias.filter((d) => d && d.data) : [];
  let h = "<h2>Feito × planejado</h2>";
  if (!dias.length) return h + '<div class="card flat sub">Ainda sem dados da semana por dia: o computador não publicou esse quadro.</div>';
  const hoje = hojeLocal();
  const soma = (k) => dias.reduce((s, d) => s + (d[k] || 0), 0);
  const plan = sem.total_planejado != null ? sem.total_planejado : soma("planejado_min");
  const feito = sem.total_feito != null ? sem.total_feito : soma("feito_min");
  const teto = Math.max(1, ...dias.map((d) => Math.max(d.planejado_min || 0, d.feito_min || 0)));
  const alt = (v) => (v > 0 ? Math.max(3, Math.round(100 * v / teto)) : 0);
  h += '<div class="card"><div class="row"><b class="num" style="font-size:22px">' + fmtMin(feito) + '</b><span class="sub">feitos de ' + fmtMin(plan) + " planejados</span>" +
    '<span class="sp"></span>' + (plan ? '<span class="badge num">' + Math.round(100 * feito / plan) + "%</span>" : "") + "</div>";
  h += '<div class="cols">' + dias.map((d) => '<div class="col"><span style="height:' + alt(d.planejado_min || 0) + '%"></span><span class="ft" style="height:' + alt(d.feito_min || 0) + '%"></span></div>').join("") + "</div>";
  h += '<div class="eixo">' + dias.map((d) => '<div class="' + (d.data === hoje ? "hoje" : "") + '">' + DIAS_SEM[new Date(d.data + "T12:00:00").getDay()].slice(0, 3) +
    '<b class="num">' + Math.round(d.feito_min || 0) + '</b><span class="num">de ' + Math.round(d.planejado_min || 0) + "</span></div>").join("") + "</div>";
  return h + '<div class="sub" style="margin-top:8px">Coluna cinza: planejado. Coluna verde: feito. Em minutos.</div></div>';
}

/* A meta da semana (aeróbico acima da Z1 e musculação), a primeira meta do
 * sistema. A conta é do computador (treino/meta_semana.py); aqui só desenha. */
function htmlMetaSemana(m, comHistorico) {
  if (!m || !m.aerobico || !m.forca) return "";
  const a = m.aerobico, f = m.forca;
  const cls = { verde: "ok", amarelo: "warn", vermelho: "bad" };
  const barra = (v, alvo, cor) => '<div class="barra" style="margin:6px 0"><span style="width:' +
    Math.min(100, Math.round(100 * v / Math.max(1, alvo))) + '%;background:' + cor + '"></span></div>';
  const rot = { corrida: "corrida", bike: "bike", natacao: "natação", outros: "outros" };
  const mods = Object.keys(a.por_modalidade || {}).filter((k) => a.por_modalidade[k] > 0)
    .map((k) => rot[k] + " " + a.por_modalidade[k]).join(" · ");
  let h = "<h2>Meta da semana</h2><div class=\"card\">";
  h += '<div class="sub" style="margin-bottom:8px">' + esc(m.texto || "") + "</div>";
  h += '<div class="row"><b>Aeróbico acima da Z1</b><span class="sp"></span><span class="badge ' + (cls[a.cor] || "") + ' num">' +
    a.min + " de " + a.alvo + " min</span></div>" + barra(a.min, a.alvo, "var(--acc)");
  h += '<div class="sub">' + (a.min ? a.moderado + " min em Z2–Z3 + " + a.vigoroso + " em Z4–Z5 (valem 2)" + (mods ? " · " + esc(mods) : "") : "Nada acima da Z1 ainda.") + "</div>";
  h += '<div class="row" style="margin-top:12px"><b>Musculação</b><span class="sp"></span><span class="badge ' + (cls[f.cor] || "") + ' num">' +
    f.min + " de " + f.alvo_min + " min · " + f.sessoes + " de " + f.alvo_sessoes + " sessões</span></div>" + barra(f.min, f.alvo_min, "var(--forca)");
  h += '<div class="sub">Só contam sessões de 30 min ou mais; a meta fecha com 2 sessões.</div>';
  if (comHistorico && Array.isArray(m.historico) && m.historico.length) {
    h += '<div class="sub" style="margin-top:12px"><b>Semanas anteriores</b> (aeróbico · musculação)</div>';
    h += m.historico.map((s) => '<div class="row num" style="padding:4px 0;border-bottom:1px solid var(--linha,#8883)"><span>' +
      esc(String(s.de).slice(8, 10) + "/" + String(s.de).slice(5, 7)) + '</span><span class="sp"></span><span>' + s.aerobico + " · " +
      s.forca + " min (" + s.forca_sessoes + ")</span>" + (s.ok ? ' <span class="badge ok">✓</span>' : "") + "</div>").join("");
  }
  return h + "</div>";
}

function statusSessao(s) {
  if (s.local) {
    if (s.local.enviada_em) return '<span class="badge info">enviada · o computador manda ao relógio</span>';
    return '<span class="badge warn">' + (s.local.atrasada ? "não aplicada · chegou atrasada" : s.local.falha ? "não aplicada · pendente" : "na fila do celular") + '</span> <button class="btn small ghost" data-desfazer="' + esc(s.local.id) + '">Desfazer alteração</button>';
  }
  if (s.status === "feito") return '<span class="badge ok">feito ✓</span>';
  if (s.status === "perdido") return '<span class="badge bad">perdido</span>';
  if (s.status === "trocado") return '<span class="badge warn">trocado</span>';
  if (s.modalidade === "descanso") return "";
  if (s.no_relogio) return '<span class="badge ok">no relógio ✓</span>';
  return '<span class="badge">ainda não foi ao relógio</span>';
}

function blocosDe(s) {
  if (s.detalhe && s.detalhe.blocos && s.detalhe.blocos.length) return s.detalhe.blocos;
  return String(s.estrutura || "").split(/;\s*/).filter(Boolean).map((t) => ({ texto: t, intens: /aquec|solto|calma|facil|trot/i.test(t) ? 1 : /z4|z5|tiro|limiar|forte|sprint/i.test(t) ? 4 : /z3|prova|ritmo/i.test(t) ? 3 : 2 }));
}

function htmlBlocos(bl) {
  const totalSeg = bl.reduce((s, b) => s + (b.seg || 0), 0);
  let h = "";
  if (totalSeg > 0) {
    h += '<div class="barra">' + bl.filter((b) => b.seg).map((b) => '<span style="width:' + (100 * b.seg / totalSeg) + "%;background:" + CORES_INT[b.intens || 0] + '"></span>').join("") + "</div>";
  }
  h += '<ul class="blocos">' + bl.map((b) => b.titulo
    ? '<li class="tit">' + esc(b.texto) + "</li>"
    : '<li><i style="background:' + CORES_INT[b.intens || 0] + '"></i><span>' + esc(b.texto) + "</span><em>" + (b.seg ? fmtMin(b.seg / 60) : "") + "</em></li>").join("") + "</ul>";
  return h;
}

function htmlSessao(s, data) {
  const passada = data < hojeLocal();
  const avisos = ((s.detalhe && s.detalhe.avisos) || []).filter((a) => s.local || a.tipo !== "veto");
  let h = '<div class="card ses" style="--cor:' + (CORES_MOD[s.modalidade] || "var(--acc)") + '">' +
    '<div class="row"><h3>' + (ICONE_MOD[s.modalidade] || "") + " " + esc(s.titulo) + '</h3></div>' +
    '<div class="meta">' + (s.modalidade !== "descanso" ? fmtMin(s.duracao_min) + " · " : "") + esc(s.intensidade || "") + "</div>" +
    statusSessao(s);
  if (s.modalidade !== "descanso") h += htmlBlocos(blocosDe(s));
  avisos.forEach((a) => { h += '<div class="aviso ' + (a.tipo === "veto" ? "veto" : "") + '">' + esc(a.texto) + "</div>"; });
  if (s.proposito || s.ajuste) {
    h += "<details><summary>Por que esse treino</summary>" + (s.proposito ? '<p class="prop">' + esc(s.proposito) + "</p>" : "") +
      (s.ajuste ? '<p class="prop sub">Ajuste: ' + esc(s.ajuste) + "</p>" : "") + "</details>";
  }
  if (!passada && !["feito", "trocado"].includes(s.status)) {
    h += '<div class="acoes"><button class="btn" data-alterar="' + esc(s.id) + '" data-dia="' + data + '">Alterar</button>';
    if (s.modalidade === "forca") h += '<button class="btn main" data-comecar="' + esc(s.id) + '" data-dia="' + data + '">Começar</button>';
    if (s.modalidade === "bike" || s.modalidade === "brick") h += '<a class="btn ghost" style="text-decoration:none;display:grid;place-items:center" href="../ciclo/">Abrir no Ciclo</a>';
    h += "</div>";
  }
  return h + "</div>";
}

function renderSemana() {
  const h = hojeLocal();
  const sem = S.pac.semana || null;
  let html = htmlTopo("Semana", esc(quandoRecebido()));
  html += avisosGerais();
  html += htmlMetaSemana(S.pac.meta_semana, true);
  html += htmlSemanaDias(sem);
  if (sem && sem.modalidades) html += htmlSemanaResumo(sem);
  html += "<h2>Sessões</h2>";
  for (const d of diasVisiveis()) {
    if (d.data < h && !d.sessoes.length) continue;
    html += '<div class="dia ' + (d.data === h ? "hoje" : "") + '">' + esc(nomeDia(d.data)) + '<span class="sp" style="flex:1"></span>' +
      (d.data >= h ? '<button class="btn small ghost" data-add="' + d.data + '">+ treino</button>' : "") + "</div>";
    if (!d.sessoes.length) html += '<div class="card flat sub">Sem treino.</div>';
    for (const s of d.sessoes) {
      html += '<div class="card flat ses" style="--cor:' + (CORES_MOD[s.modalidade] || "var(--acc)") + '" data-detalhe="' + esc(s.id) + '" data-dia="' + d.data + '">' +
        '<div class="row"><b>' + (ICONE_MOD[s.modalidade] || "") + " " + esc(s.titulo) + '</b><span class="sp"></span><span class="sub num">' +
        (s.modalidade !== "descanso" ? fmtMin(s.duracao_min) : "") + "</span></div>" +
        '<div class="sub" style="margin-top:4px">' + esc(s.intensidade || "") + "</div>" + '<div style="margin-top:6px">' + statusSessao(s) + "</div></div>";
    }
  }
  $("#tela").innerHTML = html;
  ligarTela();
}

function renderMais() {
  let html = htmlTopo("Mais", "Treino " + VERSAO + (DEMO ? " · demonstração" : ""));
  html += '<h2>Conexão</h2><div class="card">' + htmlConexao() + "</div>";
  html += "<h2>Fila de envio</h2><div class=\"card\">";
  if (!S.fila.length) html += '<div class="sub">Nada esperando. Tudo o que você alterou já saiu do celular.</div>';
  S.fila.forEach((f) => { html += '<div class="row" style="padding:6px 0"><span>' + esc(f.titulo) + '</span><span class="sp"></span><span class="sub">' + esc(new Date(f.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })) + "</span></div>"; });
  if (S.fila.length) html += '<button class="btn main" style="width:100%;margin-top:8px" id="enviarAgora">Enviar agora</button>' +
    (S.erroFila ? '<div class="sub" style="margin-top:8px">' + esc(S.erroFila) + "</div>" : "");
  html += '<div class="sub" style="margin-top:8px">Armazenamento neste celular: ' + (S.semBanco ? "indisponível (só enquanto o app está aberto)" :
    S.persistente === true ? "persistente" : S.persistente === false ? "comum — o Android pode limpar se faltar espaço; instalar o app na tela inicial ajuda" : "sem confirmação do navegador") + ".</div>";
  html += "</div>";
  html += '<h2>Como funciona</h2><div class="card md"><p>O computador publica o plano, a prontidão, a saúde e a biblioteca de treinos. Aqui você altera tempo, modalidade e tipo: o treino se remonta na hora, com seus alvos (FC pelas suas zonas de limiar, paces, CSS da natação) e o histórico de cargas.</p>' +
    "<p>O que você salva vai para o computador, que grava no plano e manda ao relógio em até 5 minutos, desde que ele esteja ligado. O relógio é o Amazfit T-Rex 3 Pro: abra o app Zepp e sincronize para o treino aparecer.</p>" +
    "<p>O registro do dia (nota, vinho, cigarros, pressão, peso) segue o mesmo caminho e aparece como “aguardando o computador” até ele confirmar.</p>" +
    '<p>Bike e brick: o treino também aparece no <a href="../ciclo/" style="color:var(--acc)">Ciclo</a>.</p></div>';
  $("#tela").innerHTML = html;
  ligarTela();
  ligarConexao();
  const b = $("#enviarAgora"); if (b) b.onclick = () => enviarFila(true);
}

function htmlConexao() {
  return '<div class="sub" style="margin-bottom:8px">Repositório <b>' + esc(CFG.repo) + "</b> · token " + (CFG.token ? "configurado neste celular" : "<b>não configurado</b>") + "</div>" +
    '<input type="password" id="tok" autocomplete="off" placeholder="' + (CFG.token ? "••••••••  (colar outro para trocar)" : "github_pat_…") + '">' +
    '<div class="acoes"><button class="btn main" id="tokSalvar">Salvar e buscar</button></div>' +
    '<ol class="hint"><li>Se você já usa o <b>Ciclo</b> neste celular, o token é o mesmo: não precisa colar de novo.</li>' +
    "<li>Para o celular conseguir <b>enviar</b> as alterações, o token precisa de mais uma permissão. Abra <b>github.com/settings/personal-access-tokens</b>, toque no token do Ciclo → <b>Edit</b>.</li>" +
    "<li>Repository permissions → <b>Issues: Read and write</b> (o Contents: Read-only continua). Salve em <b>Update</b>. O token não muda.</li>" +
    "<li>Repository access continua só com o <b>ciclo-dados</b>.</li></ol>";
}

function htmlBoasVindas() {
  return '<h1>Treino</h1><p class="sub">O guia do dia, alterável, ligado ao seu relógio.</p><div class="card">' + htmlConexao() + "</div>";
}

function ligarConexao() {
  const b = $("#tokSalvar");
  if (!b) return;
  b.onclick = () => {
    const v = $("#tok").value.trim();
    if (v) { try { localStorage.setItem("ciclo_token", v); } catch {} }
    $("#tok").value = "";
    buscar(false);
  };
}

function ligarTela() {
  const bs = $("#btnSync"); if (bs) bs.onclick = () => buscar(false);
  const rg = $("#regravar"); if (rg) rg.onclick = () => regravarFalhas();
  const tf = $("#tentarFila"); if (tf) tf.onclick = () => { S.erroFila = null; enviarFila(true); };
  const df = $("#descartarFila"); if (df) df.onclick = () => { if (confirm("Descartar as alterações que ainda não saíram do celular? Treinos de força registrados continuam na fila.")) descartarFila(); };
  document.querySelectorAll("[data-desfazer]").forEach((b) => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm("Desfazer a alteração? O treino volta ao que está no plano.")) return;
      await removerLocal(b.dataset.desfazer);
      toast("Alteração desfeita");
      render();
    };
  });
  document.querySelectorAll("[data-alterar]").forEach((b) => { b.onclick = () => abrirAlterar(b.dataset.dia, b.dataset.alterar); });
  document.querySelectorAll("[data-add]").forEach((b) => { b.onclick = () => abrirAlterar(b.dataset.add, null); });
  document.querySelectorAll("[data-comecar]").forEach((b) => { b.onclick = () => comecarForcaDaSessao(b.dataset.dia, b.dataset.comecar); });
  document.querySelectorAll("[data-detalhe]").forEach((c) => { c.onclick = () => abrirDetalhe(c.dataset.dia, c.dataset.detalhe); });
}

function sessaoPorId(data, id) {
  const d = diasVisiveis().find((x) => x.data === data);
  return d ? d.sessoes.find((s) => String(s.id) === String(id)) : null;
}

/* ------------------------------------------------------------------------- */
/* Folha: detalhe e alterar                                                   */
/* ------------------------------------------------------------------------- */

function abrirFolha(titulo, corpo, rodape) {
  $("#folhaTitulo").textContent = titulo;
  $("#folhaCorpo").innerHTML = corpo;
  $("#folhaRodape").innerHTML = rodape || "";
  $("#folhaRodape").style.display = rodape ? "" : "none";
  $("#folha").classList.add("on");
  $("#folhaCorpo").scrollTop = 0;
  history.pushState({ folha: 1 }, "");
}
function fecharFolha(semVoltar) {
  if (!$("#folha").classList.contains("on")) return;
  $("#folha").classList.remove("on");
  if (!semVoltar && history.state && history.state.folha) history.back();
}

function abrirDetalhe(data, id) {
  const s = sessaoPorId(data, id);
  if (!s) return;
  abrirFolha(nomeDia(data), htmlSessao(s, data));
  document.querySelectorAll("#folhaCorpo [data-alterar]").forEach((b) => { b.onclick = () => { fecharFolha(true); abrirAlterar(b.dataset.dia, b.dataset.alterar); }; });
  document.querySelectorAll("#folhaCorpo [data-comecar]").forEach((b) => { b.onclick = () => { fecharFolha(true); comecarForcaDaSessao(b.dataset.dia, b.dataset.comecar); }; });
}

const MODS = ["corrida", "bike", "natacao", "forca", "brick", "descanso"];
const NOME_GRUPO = { plano: "Do plano", leve: "Leve", longo: "Longo", tecnica: "Técnica", moderado: "Moderado", prova: "Ritmo de prova", forte: "Forte", forca: "" };

const A = { data: null, sessao: null, mod: null, modelo: null, minutos: 45 };

/* Dia que ja passou e sessao ja feita nao recebem troca: aplicada, ela
 * reescreveria o que ja aconteceu. Vale ao abrir e de novo ao salvar (a folha
 * pode ter ficado aberta na virada do dia ou enquanto o treino era feito). */
function motivoSemTroca(data, s) {
  if (!data || data < hojeLocal()) return "Esse dia já passou: não dá mais para alterar.";
  if (s && s.status === "feito") return "Esse treino já foi feito: não dá para alterar.";
  if (s && s.status === "trocado") return "Esse treino já foi trocado no computador.";
  return "";
}

function abrirAlterar(data, id) {
  const s = id != null ? sessaoPorId(data, id) : null;
  const motivo = motivoSemTroca(data, s);
  if (motivo) { toast(motivo, 3500); return; }
  A.data = data;
  A.sessao = s;
  A.livre = false;
  A.mod = s ? s.modalidade : "corrida";
  const lista = modelosDe(A.mod, s);
  const escolhido = s && s.detalhe && s.detalhe.modelo_id ? lista.find((m) => m.id === s.detalhe.modelo_id) : null;
  A.modelo = escolhido || lista[0] || null;
  A.minutos = Math.round((s && s.detalhe && s.detalhe.minutos_pedidos) || (s && s.duracao_min) || (A.modelo && A.modelo.padrao) || 45);
  abrirFolha((s ? "Alterar · " : "Novo treino · ") + nomeDia(data, true), "",
    '<button class="btn" id="aCancelar">Cancelar</button><button class="btn main" id="aSalvar">Salvar e mandar ao relógio</button>');
  $("#aCancelar").onclick = () => fecharFolha();
  $("#aSalvar").onclick = salvarAlteracao;
  renderAlterar();
}

function renderAlterar() {
  const p = S.pac || {};
  const presc = A.data === p.hoje ? p.prescricao : null;
  const ORD = GERADOR.ORDEM;
  let h = '<div class="lbl">Modalidade</div><div class="chips">' +
    (A.livre ? ["forca"] : MODS).map((m) => '<button class="chip ' + (A.mod === m ? "on" : "") + '" data-mod="' + m + '">' + ICONE_MOD[m] + " " + GERADOR.NOME_MOD[m] + "</button>").join("") + "</div>";
  if (A.mod === "descanso") {
    h += '<div class="card" style="margin-top:14px"><b>Descanso</b><p class="prop">' + (A.sessao ? "Remove este treino do dia e apaga do relógio." : "Nada a salvar: o dia fica sem este treino.") + "</p></div>";
    $("#folhaCorpo").innerHTML = h;
    ligarAlterar();
    $("#aSalvar").textContent = A.sessao ? "Remover treino" : "Fechar";
    return;
  }
  $("#aSalvar").textContent = A.livre ? "Começar agora" : "Salvar e mandar ao relógio";
  const lista = modelosDe(A.mod, A.sessao);
  if (!A.modelo || A.modelo.modalidade !== A.mod) A.modelo = lista[0];
  h += '<div class="lbl">Como você quer</div><div class="chips wrap">' + lista.map((m) => {
    const veta = presc && ORD[m.nivel || "baixa"] > ORD[presc.intensidade_max || "alta"];
    const rot = m.grupo === "plano" ? (A.sessao && A.sessao.origem === "celular" ? "Atual" : "Do plano") : m.nome;
    return '<button class="chip ' + (A.modelo && A.modelo.id === m.id ? "on " : "") + (veta ? "aviso" : "") + '" data-modelo="' + esc(m.id) + '">' + esc(rot) + "</button>";
  }).join("") + "</div>";
  if (presc) h += '<div class="sub">Hoje: ' + esc(presc.resumo || "") + "</div>";

  h += '<div class="lbl">Tempo</div><div class="dur"><button class="icon" data-dmin="-5">−</button><div class="v num">' + fmtMin(A.minutos) +
    "<small>" + (A.modelo ? "esse treino: " + A.modelo.min + "–" + A.modelo.max + " min" : "") + '</small></div><button class="icon" data-dmin="5">+</button></div>' +
    '<input type="range" id="aRange" min="15" max="240" step="5" value="' + A.minutos + '">' +
    '<div class="chips">' + [30, 45, 60, 75, 90, 120, 150, 180].map((v) => '<button class="chip ' + (A.minutos === v ? "on" : "") + '" data-min="' + v + '">' + fmtMin(v) + "</button>").join("") + "</div>";

  if (A.modelo) {
    const g = GERADOR.gerar(A.modelo, A.minutos, ctxGerador(A.data));
    A.gerado = g;
    h += '<div class="lbl">Como fica</div>' + htmlPrevia(g);
  }
  if (A.sessao && A.sessao.modelo && A.modelo && A.modelo.grupo !== "plano") {
    h += '<p class="sub">Antes: ' + esc(A.sessao.titulo) + " · " + fmtMin(A.sessao.duracao_min) + "</p>";
  }
  $("#folhaCorpo").innerHTML = h;
  ligarAlterar();
}

function htmlPrevia(g) {
  let h = '<div class="card ses" style="--cor:' + (CORES_MOD[g.modalidade] || "var(--acc)") + '"><h3>' + (ICONE_MOD[g.modalidade] || "") + " " + esc(g.titulo) +
    '</h3><div class="meta">' + fmtMin(g.duracao_min) + " · " + esc(g.intensidade) + "</div>";
  g.detalhe.avisos.forEach((a) => { h += '<div class="aviso ' + (a.tipo === "veto" ? "veto" : "") + '">' + esc(a.texto) + "</div>"; });
  if (g.detalhe.forca) {
    h += '<div style="margin-top:8px">' + g.detalhe.forca.exercicios.map((e) =>
      '<div class="ex"><b>' + esc(e.nome) + '</b><span class="kg num">' + (e.kg ? String(e.kg).replace(".", ",") + " kg" : e.medida === "s" ? "" : "carga livre") + "</span>" +
      "<small>" + e.series + " × " + (e.medida === "s" ? e.alvo_s + " s" : e.reps_min + (e.reps_max !== e.reps_min ? "–" + e.reps_max : "") + " reps") +
      " · descanso " + Math.round(e.descanso_s) + " s — " + esc(e.motivo || "") + "</small></div>").join("") + "</div>";
  } else {
    h += htmlBlocos(g.detalhe.blocos);
  }
  if (g.proposito) h += '<details><summary>Por que esse treino</summary><p class="prop">' + esc(g.proposito) + "</p></details>";
  return h + "</div>";
}

function ligarAlterar() {
  document.querySelectorAll("#folhaCorpo [data-mod]").forEach((b) => {
    b.onclick = () => {
      A.mod = b.dataset.mod;
      const lista = A.mod === "descanso" ? [] : modelosDe(A.mod, A.sessao);
      A.modelo = lista[0] || null;
      if (A.modelo && !(A.sessao && A.sessao.modalidade === A.mod)) A.minutos = Math.max(A.modelo.min || 15, Math.min(A.modelo.max || 240, A.minutos));
      renderAlterar();
    };
  });
  document.querySelectorAll("#folhaCorpo [data-modelo]").forEach((b) => {
    b.onclick = () => {
      A.modelo = modelosDe(A.mod, A.sessao).find((m) => m.id === b.dataset.modelo);
      // O tempo tem de caber no modelo NOVO. Sem isso, 190 min escolhidos para
      // um longo seguiam valendo ao trocar para um treino de tiros (28/09/2026).
      if (A.modelo) A.minutos = Math.max(A.modelo.min || 15, Math.min(A.modelo.max || 240, A.minutos));
      renderAlterar();
    };
  });
  document.querySelectorAll("#folhaCorpo [data-dmin]").forEach((b) => {
    b.onclick = () => { A.minutos = Math.max(15, Math.min(300, A.minutos + Number(b.dataset.dmin))); renderAlterar(); };
  });
  document.querySelectorAll("#folhaCorpo [data-min]").forEach((b) => { b.onclick = () => { A.minutos = Number(b.dataset.min); renderAlterar(); }; });
  const r = $("#aRange");
  if (r) {
    r.oninput = () => { $(".dur .v").firstChild.textContent = fmtMin(Number(r.value)); };
    r.onchange = () => { A.minutos = Number(r.value); renderAlterar(); };
  }
}

async function salvarAlteracao() {
  const motivo = motivoSemTroca(A.data, (A.sessao && sessaoPorId(A.data, A.sessao.id)) || A.sessao);
  if (motivo) { fecharFolha(); toast(motivo, 3500); render(); return; }
  const s = A.sessao;
  const idNum = s && /^\d+$/.test(String(s.id)) ? Number(s.id) : null;
  const refTroca = s && s.local && idNum == null ? (s.local.ref_troca || s.local.id) : null;
  let troca;
  if (A.mod === "descanso") {
    if (!s) { fecharFolha(); return; }
    if (idNum == null && s.local && !s.local.enviada_em) {
      // treino criado aqui e ainda nao enviado: some da fila e pronto
      await removerLocal(s.local.id);
      fecharFolha();
      render();
      return;
    }
    troca = { tipo: "troca", id: uid(), criado_em: agoraIso(), data: A.data, acao: "remover", sessao_id: idNum, ref_troca: refTroca };
  } else {
    const g = GERADOR.gerar(A.modelo, A.minutos, ctxGerador(A.data));
    troca = {
      tipo: "troca", id: uid(), criado_em: agoraIso(), data: A.data,
      acao: s ? "trocar" : "adicionar", sessao_id: idNum, ref_troca: refTroca, sessao: g,
    };
    if (s && s.local && s.local.atrasada) {
      // a tentativa anterior chegou atrasada e nao e reenviada: esta entra no lugar dela, com id novo
      await removerLocal(s.local.id);
      troca.acao = s.local.acao;
      troca.sessao_id = s.local.sessao_id;
      troca.ref_troca = s.local.ref_troca;
    } else if (s && s.local && !s.local.enviada_em) {
      // alterar de novo um treino que ainda nao saiu do celular: substitui na fila
      troca.id = s.local.id;
      troca.acao = s.local.acao;
      troca.sessao_id = s.local.sessao_id;
      troca.ref_troca = s.local.ref_troca;
    }
  }
  S.trocas = S.trocas.filter((t) => t.id !== troca.id).concat([troca]);
  await idb.put("trocas", troca);
  S.fila = S.fila.filter((f) => f.id !== troca.id);
  await idb.del("fila", troca.id);
  await enfileirar("treino-app troca " + A.data, troca);
  fecharFolha();
  toast(A.mod === "descanso" ? "Treino removido. O computador tira do relógio." : "Salvo. O computador grava e manda ao relógio em até 5 min.", 3500);
  render();
}

async function removerLocal(id) {
  S.trocas = S.trocas.filter((t) => t.id !== id && t.ref_troca !== id);
  S.fila = S.fila.filter((f) => f.id !== id);
  await idb.del("trocas", id);
  await idb.del("fila", id);
}

/* ------------------------------------------------------------------------- */
/* Markdown minimo (orientacao da manha)                                      */
/* ------------------------------------------------------------------------- */

function markdown(txt) {
  const linhas = String(txt || "").split(/\r?\n/);
  let h = "", lista = false;
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>");
  for (const l of linhas) {
    const item = l.match(/^\s*[-*•]\s+(.*)/) || l.match(/^\s*\d+[.)]\s+(.*)/);
    if (item) { if (!lista) { h += "<ul>"; lista = true; } h += "<li>" + inline(item[1]) + "</li>"; continue; }
    if (lista) { h += "</ul>"; lista = false; }
    const tit = l.match(/^\s*#{1,4}\s+(.*)/);
    if (tit) h += "<h4>" + inline(tit[1]) + "</h4>";
    else if (l.trim()) h += "<p>" + inline(l) + "</p>";
  }
  return h + (lista ? "</ul>" : "");
}

/* ------------------------------------------------------------------------- */
/* Inicio                                                                     */
/* ------------------------------------------------------------------------- */

function vigiarVersao() {
  if (!("serviceWorker" in navigator) || DEMO) return;
  const tinha = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").then((reg) => {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!tinha) return;
    if (typeof PL !== "undefined" && PL.aberto) { toast("Versão nova pronta — atualiza quando o treino terminar."); return; }
    location.reload();
  });
}

async function iniciar() {
  await abrirBanco();
  const c = await idb.get("kv", "pac");
  if (c) { S.pac = c.v; S.recebido = c.t; }
  S.fila = await idb.all("fila");
  S.trocas = await idb.all("trocas");
  S.forca = await idb.all("forca");
  const rg = await idb.get("kv", "registros");
  // registro enviado ha mais de 30 dias sem confirmacao nao volta a aparecer como pendente
  S.registros = ((rg && rg.v) || []).filter((r) => !r.enviado_em || Date.now() - new Date(r.enviado_em).getTime() < 30 * 864e5);
  S.semBanco = !BANCO;
  pedirPersistencia();
  if (typeof carregarRascunho === "function") await carregarRascunho();
  // troca recusada por atraso nao e reenviada; a de um dia que ja passou sai do celular
  for (const t of S.trocas.filter((x) => x.atrasada && x.data < hojeLocal())) {
    S.trocas = S.trocas.filter((x) => x.id !== t.id);
    await idb.del("trocas", t.id);
  }
  // troca que o computador recusou (limparAplicados): volta para a fila uma vez a cada abertura
  for (const t of S.trocas) {
    if (!t.falha || t.atrasada || S.fila.some((f) => f.id === t.id)) continue;
    const corpo = Object.assign({}, t);
    delete corpo.falha; delete corpo.enviada_em;
    const item = { id: t.id, titulo: "treino-app troca " + t.data, corpo, criado_em: agoraIso(), tentativas: 0 };
    S.fila.push(item);
    await idb.put("fila", item);
  }
  document.querySelectorAll("#abas button").forEach((b) => { b.onclick = () => { S.aba = b.dataset.aba; render(); window.scrollTo(0, 0); }; });
  $("#folhaFechar").onclick = () => fecharFolha();
  window.addEventListener("popstate", () => { fecharFolha(true); if (typeof fecharPlayerPeloVoltar === "function") fecharPlayerPeloVoltar(); });
  window.addEventListener("online", () => { enviarFila(); buscar(true); });
  // redesenho que ficou esperando o campo perder o foco (renderSeLivre)
  $("#tela").addEventListener("focusout", () => { setTimeout(() => { if (renderSeLivre.pendente && !digitando()) renderSeLivre(); }, 200); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - S.recebido > 5 * 60000) buscar(true); else enviarFila();
  });
  render();
  buscar(true);
  vigiarVersao();
  if (typeof retomarForca === "function") retomarForca();
}

document.addEventListener("DOMContentLoaded", iniciar);
