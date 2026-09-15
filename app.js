/* Treino — o guia do dia no celular.
 *
 * Le o treino.json que o computador (treino-ia) publica no repositorio privado
 * ciclo-dados, mostra o dia e deixa ALTERAR qualquer sessao: tempo, modalidade
 * e tipo. O gerador (gerador.js) remonta a sessao na hora, sem internet; a
 * escolha vai para o computador como issue, e de la para o relogio.
 *
 * Nada aqui fala com a Garmin nem guarda senha. O token do GitHub e o mesmo do
 * Ciclo (mesmo endereco abranqs.github.io, mesmo armazenamento): precisa de
 * Contents (leitura) e Issues (leitura e escrita) no ciclo-dados.
 */
"use strict";

const VERSAO = "1.0.0";
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
const idb = {
  _t(store, modo) { return BANCO.transaction(store, modo).objectStore(store); },
  put(store, obj) {
    const chave = store === "kv" ? obj.k : obj.id;
    MEM[store][chave] = obj;
    if (!BANCO) return Promise.resolve();
    return new Promise((ok) => { try { const r = this._t(store, "readwrite").put(obj); r.onsuccess = r.onerror = () => ok(); } catch { ok(); } });
  },
  del(store, chave) {
    delete MEM[store][chave];
    if (!BANCO) return Promise.resolve();
    return new Promise((ok) => { try { const r = this._t(store, "readwrite").delete(chave); r.onsuccess = r.onerror = () => ok(); } catch { ok(); } });
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

const S = { pac: null, recebido: 0, fila: [], trocas: [], forca: [], aba: "hoje", buscando: false, erroSync: null, erroFila: null };

const CFG = {
  ler(k, pad) { try { return localStorage.getItem(k) || pad; } catch { return pad; } },
  get repo() { return this.ler("ciclo_repo", "abranqs/ciclo-dados"); },
  get token() { return this.ler("ciclo_token", ""); },
};

function cabecalhos(extra) {
  return Object.assign({ Authorization: "Bearer " + CFG.token, "X-GitHub-Api-Version": "2022-11-28" }, extra || {});
}

async function buscar(silencioso) {
  if (S.buscando) return;
  if (!DEMO && !CFG.token) { render(); return; }
  if (!navigator.onLine && !DEMO) { if (!silencioso) toast("Sem internet — mostrando o que já está no celular"); return; }
  S.buscando = true;
  renderTopo();
  try {
    let j;
    if (DEMO) {
      j = await (await fetch("_local/treino.json", { cache: "no-store" })).json();
    } else {
      const r = await fetch("https://api.github.com/repos/" + CFG.repo + "/contents/treino.json",
        { headers: cabecalhos({ Accept: "application/vnd.github.raw+json" }), cache: "no-store" });
      if (r.status === 401) throw new Error("token inválido ou expirado");
      if (r.status === 404) throw new Error("treino.json não encontrado — o computador ainda não publicou, ou o token não vê o ciclo-dados");
      if (!r.ok) throw new Error("GitHub respondeu " + r.status);
      j = await r.json();
    }
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
    render();
    enviarFila();
  }
}

/* A troca feita aqui vira oficial quando o computador a aplica e republica.
 * Ate la ela e mostrada por cima do que veio publicado. */
async function limparAplicados() {
  if (!S.pac) return;
  const aplicadas = new Set((S.pac.trocas_aplicadas || []).map((t) => t.id));
  for (const t of S.trocas.slice()) {
    if (aplicadas.has(t.id)) { await idb.del("trocas", t.id); S.trocas = S.trocas.filter((x) => x.id !== t.id); }
  }
  const recebidos = new Set(S.pac.forca_recebidos || []);
  for (const f of S.forca) {
    if (f.status === "concluido" && recebidos.has(f.id) && !f.no_computador) { f.no_computador = true; await idb.put("forca", f); }
  }
}

async function enfileirar(titulo, corpo) {
  const item = { id: corpo.id, titulo, corpo, criado_em: agoraIso(), tentativas: 0 };
  S.fila.push(item);
  await idb.put("fila", item);
  enviarFila();
}

async function enviarFila() {
  if (enviarFila.rodando || !S.fila.length) return;
  if (!DEMO && (!CFG.token || !navigator.onLine)) return;
  enviarFila.rodando = true;
  try {
    for (const item of S.fila.slice().sort((a, b) => a.criado_em.localeCompare(b.criado_em))) {
      let ok = false;
      if (DEMO) {
        await new Promise((r) => setTimeout(r, 400));
        console.log("[demo] issue", item.titulo, item.corpo);
        ok = true;
      } else {
        const r = await fetch("https://api.github.com/repos/" + CFG.repo + "/issues", {
          method: "POST", headers: cabecalhos({ Accept: "application/vnd.github+json", "Content-Type": "application/json" }),
          body: JSON.stringify({ title: item.titulo, body: JSON.stringify(item.corpo) }),
        });
        if (r.status === 201) ok = true;
        else if ([401, 403, 404].includes(r.status)) {
          S.erroFila = "O token não pode criar issues no ciclo-dados. Em Mais → Conexão tem o passo a passo (Issues: leitura e escrita).";
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
      }
    }
  } catch (e) {
    S.erroFila = "Sem conexão com o GitHub — o que está na fila sai quando voltar.";
  } finally {
    enviarFila.rodando = false;
    render();
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
        series: e.feitas.map((s) => [s.kg, s.reps != null ? s.reps : s.s, s.rir]),
      });
    }
  }
  for (const k of Object.keys(h)) h[k].sort((a, b) => b.data.localeCompare(a.data));
  return h;
}

function ctxGerador(data) {
  const p = S.pac || {};
  return { catalogo: p.catalogo_forca || {}, historico: historicoForca(), prescricao: data === (p.hoje || "") ? p.prescricao : null };
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
  ({ hoje: renderHoje, semana: renderSemana, forca: renderForcaAba, mais: renderMais })[S.aba]();
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
  if (S.erroFila) h += '<div class="aviso veto">' + esc(S.erroFila) + "</div>";
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
  let html = htmlTopo(nomeDia(h), esc(quandoRecebido()) + (p.prova && p.prova.dias >= 0 ? " · " + esc(p.prova.nome) + " em " + p.prova.dias + " dias" : ""));
  html += avisosGerais();
  if (p.hoje === h) html += htmlProntidao(p);
  html += "<h2>Treino de hoje</h2>";
  if (!dia.sessoes.length) html += '<div class="card vazio">Sem treino planejado hoje.</div>';
  dia.sessoes.forEach((s) => { html += htmlSessao(s, h); });
  html += '<button class="btn ghost" style="width:100%" data-add="' + h + '">+ Adicionar treino hoje</button>';
  if (p.orientacao && p.orientacao.criado_em && p.orientacao.criado_em.slice(0, 10) === h) {
    html += '<h2>Orientação da manhã</h2><div class="card"><details><summary>Ler a orientação das ' +
      esc(p.orientacao.criado_em.slice(11, 16)) + '</summary><div class="md">' + markdown(p.orientacao.texto) + "</div></details></div>";
  }
  if (p.noite && p.hoje === h) html += htmlNoite(p.noite);
  if (p.semana) html += htmlSemanaResumo(p.semana);
  $("#tela").innerHTML = html;
  ligarTela();
}

function corScore(v) { return v == null ? "var(--i0)" : v >= 75 ? "var(--ok)" : v >= 55 ? "var(--warn)" : "var(--bad)"; }

function htmlProntidao(p) {
  const pr = p.prontidao || {}, ps = p.prescricao || {};
  const v = pr.score;
  const c = 2 * Math.PI * 40, frac = v == null ? 0 : Math.max(0, Math.min(1, v / 100));
  const nivel = { alta: ["liberado para forte", "ok"], moderada: ["até moderado (sem Z4-Z5)", "warn"], baixa: ["só leve", "bad"], zero: ["descanso", "bad"] }[ps.intensidade_max] || ["", ""];
  let h = '<div class="card"><div class="pront"><div class="anel"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--card2)" stroke-width="10"/>' +
    '<circle cx="50" cy="50" r="40" fill="none" stroke="' + corScore(v) + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + (c * frac) + " " + c + '"/></svg>' +
    '<b class="num">' + (v == null ? "—" : Math.round(v)) + "</b><small>PRONTIDÃO</small></div><div>" +
    '<span class="badge ' + nivel[1] + '"><span class="dot"></span>' + esc(nivel[0]) + "</span>" +
    (ps.fator_volume && ps.fator_volume !== 1 ? ' <span class="badge warn">volume ×' + ps.fator_volume + "</span>" : "") +
    '<div class="regra" style="margin-top:6px">' + esc(ps.resumo || "") + "</div></div></div>";
  const hrv = ps.hrv || {};
  h += '<div class="mini"><div><span>Sono</span><b class="num">' + (p.sono && p.sono.duracao_min ? fmtMin(p.sono.duracao_min) : "—") + "</b></div>" +
    '<div><span>RMSSD</span><b class="num">' + (hrv.rmssd ? Math.round(hrv.rmssd) : "—") + '</b><small class="sub"> ' + (hrv.baseline ? "base " + Math.round(hrv.baseline) : "") + "</small></div>" +
    '<div><span>ACWR</span><b class="num">' + (ps.acwr != null ? String(ps.acwr).replace(".", ",") : "—") + "</b></div></div></div>";
  return h;
}

function htmlNoite(n) {
  const sit = { dentro: "ok", acima: "warn", abaixo: "warn" };
  let h = '<h2>A noite</h2><div class="card"><div class="row"><div><b style="font-size:22px" class="num">' + (n.rmssd ? Math.round(n.rmssd) + " ms" : "—") +
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
  let h = '<h2>Semana</h2><div class="card">';
  for (const [k, m] of Object.entries(sem.modalidades || {})) {
    const alvo = Math.max(m.plano_min || 0, m.feito_min || 0, 1);
    const meta = m.meta_sessoes ? " · " + m.sessoes_feitas + "/" + m.meta_sessoes + " sessões" : "";
    h += '<div class="mod"><span>' + nomes[k] + '</span><div class="trilho"><span style="width:' + Math.min(100, 100 * m.feito_min / alvo) +
      "%;background:" + CORES_MOD[k] + '"></span>' + (m.plano_min ? '<u style="left:calc(' + Math.min(100, 100 * m.plano_min / alvo) + '% - 2px)"></u>' : "") +
      '</div><span class="sub num">' + m.feito_min + "/" + m.plano_min + " min" + meta + "</span></div>";
  }
  return h + '<div class="sub">Traço: planejado na semana. Barra: feito até agora (atividades do Garmin).</div></div>';
}

function statusSessao(s) {
  if (s.local) {
    if (s.local.enviada_em) return '<span class="badge info">enviada · o computador manda ao relógio</span>';
    return '<span class="badge warn">na fila do celular</span>';
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
  let html = htmlTopo("Próximos dias", esc(quandoRecebido()));
  html += avisosGerais();
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
  if (S.fila.length) html += '<button class="btn main" style="width:100%;margin-top:8px" id="enviarAgora">Enviar agora</button>';
  html += "</div>";
  html += '<h2>Como funciona</h2><div class="card md"><p>O computador publica o plano, a prontidão e a biblioteca de treinos. Aqui você altera tempo, modalidade e tipo: o treino se remonta na hora, com seus alvos (FC de Karvonen, paces, CSS da natação) e o histórico de cargas.</p>' +
    "<p>O que você salva vai para o computador, que grava no plano e manda ao relógio em até 5 minutos, desde que ele esteja ligado. No relógio, sincronize com o Garmin Connect para o treino aparecer.</p>" +
    '<p>Bike e brick: o treino também aparece no <a href="../ciclo/" style="color:var(--acc)">Ciclo</a>.</p></div>';
  $("#tela").innerHTML = html;
  ligarTela();
  ligarConexao();
  const b = $("#enviarAgora"); if (b) b.onclick = () => enviarFila();
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

function abrirAlterar(data, id) {
  const s = id != null ? sessaoPorId(data, id) : null;
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
    b.onclick = () => { A.modelo = modelosDe(A.mod, A.sessao).find((m) => m.id === b.dataset.modelo); renderAlterar(); };
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
    // alterar de novo um treino que ainda nao saiu do celular: substitui na fila
    if (s && s.local && !s.local.enviada_em) {
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
  document.querySelectorAll("#abas button").forEach((b) => { b.onclick = () => { S.aba = b.dataset.aba; render(); window.scrollTo(0, 0); }; });
  $("#folhaFechar").onclick = () => fecharFolha();
  window.addEventListener("popstate", () => { fecharFolha(true); if (typeof fecharPlayerPeloVoltar === "function") fecharPlayerPeloVoltar(); });
  window.addEventListener("online", () => { enviarFila(); buscar(true); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - S.recebido > 5 * 60000) buscar(true);
  });
  render();
  buscar(true);
  vigiarVersao();
  if (typeof retomarForca === "function") retomarForca();
}

document.addEventListener("DOMContentLoaded", iniciar);
