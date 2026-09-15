/* Musculacao: a aba Forca e o player da sessao.
 *
 * Cada serie feita guarda carga, repeticoes e repeticoes de reserva (RIR). E
 * isso que alimenta a sugestao de carga da proxima vez (progressao dupla:
 * todas as series no topo da faixa sobrando o RIR alvo -> sobe; abaixo da
 * faixa duas vezes -> desce 10%). O treino em andamento fica salvo a cada
 * serie: fechar o app no meio nao perde nada.
 */
"use strict";

const PL = { log: null, aberto: false, entrada: null, fimDescanso: 0, tick: null, wake: null, cronometro: 0, tela: "serie" };

/* Descanso escolhido por exercicio: vale para as proximas sessoes neste celular. */
function descansosPreferidos() { try { return JSON.parse(localStorage.getItem("treino_descanso") || "{}"); } catch { return {}; } }
function guardarDescanso(chave, s) {
  const d = descansosPreferidos();
  d[chave] = s;
  try { localStorage.setItem("treino_descanso", JSON.stringify(d)); } catch {}
}
function fmtSeg(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

/* Teclado proprio para carga e repeticoes. O teclado do Android com campo
 * numerico juntava o digito ao valor que ja estava ("0" virava "060"), nao
 * aceitava virgula e fechava quando o modo automatico redesenhava a tela. */
function teclado(titulo, valor, opcoes, aoConfirmar) {
  const decimal = !!opcoes.decimal;
  let txt = String(valor == null ? "" : valor).replace(".", ",");
  let novo = true;                       // o primeiro digito substitui o valor
  const mostrar = () => { $("#tqValor").textContent = txt === "" ? "0" : txt; };
  const numero = () => Math.max(0, Number(txt.replace(",", ".")) || 0);
  $("#tqTitulo").textContent = titulo;
  $("#tqUnid").textContent = opcoes.unidade || "";
  $("#tqAtalhos").innerHTML = (opcoes.atalhos || []).map((d) => '<button class="chip" data-tqd="' + d + '">' + (d > 0 ? "+" : "−") + String(Math.abs(d)).replace(".", ",") + "</button>").join("");
  $("#tqGrade").innerHTML = ["1", "2", "3", "4", "5", "6", "7", "8", "9", decimal ? "," : "", "0", "⌫"]
    .map((k) => k ? '<button data-tq="' + k + '">' + k + "</button>" : "<span></span>").join("");
  $("#tqGrade").querySelectorAll("[data-tq]").forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.tq;
      if (k === "⌫") { txt = novo ? "" : txt.slice(0, -1); novo = false; }
      else if (k === ",") { if (novo) { txt = "0,"; novo = false; } else if (!txt.includes(",")) txt = (txt || "0") + ","; }
      else { if (novo) { txt = ""; novo = false; } if (txt.replace(",", "").length < 5) txt = (txt === "0" ? "" : txt) + k; }
      mostrar();
    };
  });
  $("#tqAtalhos").querySelectorAll("[data-tqd]").forEach((b) => {
    b.onclick = () => {
      const v = Math.round((numero() + Number(b.dataset.tqd)) * 100) / 100;
      txt = String(Math.max(0, v)).replace(".", ",");
      novo = true;
      mostrar();
    };
  });
  const fechar = () => $("#teclado").classList.remove("on");
  $("#tqFechar").onclick = fechar;
  $("#teclado").onclick = (ev) => { if (ev.target.id === "teclado") fechar(); };
  $("#tqOk").onclick = () => { fechar(); aoConfirmar(decimal ? numero() : Math.round(numero())); };
  mostrar();
  $("#teclado").classList.add("on");
}

function ligarTeclados(corpo, e, en) {
  const c = catEx(e.chave);
  const inc = c.inc || 2.5;
  const bk = $("#inKg", corpo);
  if (bk) bk.onclick = () => teclado("Carga · " + e.nome, en.kg, { decimal: true, unidade: "kg", atalhos: [-2 * inc, -inc, inc, 2 * inc] },
    (v) => { en.kg = v; renderPlayer(); });
  const br = $("#inReps", corpo);
  if (br) br.onclick = () => teclado("Repetições · " + e.nome, en.reps, { unidade: "reps", atalhos: [-2, -1, 1, 2] },
    (v) => { en.reps = v; renderPlayer(); });
}

function catEx(chave) { return ((S.pac && S.pac.catalogo_forca) || {})[chave] || { nome: chave, inc: 2, descanso_s: 90, medida: "reps", tipo: "acessorio" }; }

/* ------------------------------------------------------------------------- */
/* Aba Forca                                                                  */
/* ------------------------------------------------------------------------- */

function renderForcaAba() {
  const h = hojeLocal();
  let html = htmlTopo("Força", "cargas, séries e evolução");
  const andamento = S.forca.find((f) => f.status === "andamento");
  if (andamento) {
    const feitas = andamento.exercicios.reduce((s, e) => s + e.feitas.length, 0);
    html += '<div class="card ses" style="--cor:var(--forca)"><h3>Treino em andamento</h3><div class="meta">' + esc(andamento.titulo) + " · " + feitas +
      ' séries feitas</div><div class="acoes"><button class="btn main" id="fContinuar">Continuar</button><button class="btn ghost" id="fDescartar">Descartar</button></div></div>';
  }
  const dia = diasVisiveis().find((d) => d.data === h);
  const deHoje = dia ? dia.sessoes.filter((s) => s.modalidade === "forca" && !["feito", "trocado"].includes(s.status)) : [];
  if (!andamento) {
    deHoje.forEach((s) => {
      html += '<div class="card ses" style="--cor:var(--forca)"><h3>' + esc(s.titulo) + '</h3><div class="meta">Hoje · ' + fmtMin(s.duracao_min) + " · " + esc(s.intensidade || "") +
        '</div><div class="acoes"><button class="btn" data-alterar="' + esc(s.id) + '" data-dia="' + h + '">Alterar</button><button class="btn main" data-comecar="' + esc(s.id) + '" data-dia="' + h + '">Começar</button></div></div>';
    });
    html += '<button class="btn ghost" style="width:100%" id="fLivre">Treino de força fora do plano</button>';
  }

  const hist = historicoForca();
  const chaves = Object.keys(hist).filter((k) => hist[k].length).sort((a, b) => hist[b][0].data.localeCompare(hist[a][0].data));
  html += "<h2>Evolução por exercício</h2>";
  if (!chaves.length) html += '<div class="card vazio">Nenhuma série registrada ainda. A primeira sessão feita aqui vira a base das próximas cargas.</div>';
  else {
    html += '<div class="card">';
    for (const k of chaves) {
      const c = catEx(k);
      const serie = hist[k].slice().reverse().map((x) => Math.max(...x.series.map((s) => GERADOR.e1rm(s[0] || 0, s[1], s[2]))));
      const ult = hist[k][0];
      const topo = ult.series.reduce((m, s) => ((s[0] || 0) > (m[0] || 0) ? s : m), ult.series[0]);
      html += '<div class="ex"><b>' + esc(c.nome) + '</b><span class="kg num">' + (c.medida === "s" ? topo[1] + " s" : (topo[0] || 0) + " kg × " + topo[1]) + "</span>" +
        "<small>" + esc(ult.data.slice(8, 10) + "/" + ult.data.slice(5, 7)) + " · " + ult.series.length + " séries" +
        (c.medida !== "s" && serie.length > 1 ? " · 1RM estimado " + Math.round(serie[serie.length - 1]) + " kg " + sparkline(serie) : "") + "</small></div>";
    }
    html += "</div>";
  }
  const feitos = S.forca.filter((f) => f.status === "concluido").sort((a, b) => b.inicio.localeCompare(a.inicio)).slice(0, 8);
  if (feitos.length) {
    html += '<h2>Últimos treinos neste celular</h2><div class="card">' + feitos.map((f) => {
      const n = f.exercicios.reduce((s, e) => s + e.feitas.length, 0);
      const est = f.no_computador ? '<span class="badge ok">no computador</span>' : f.enviado_em ? '<span class="badge info">enviado</span>' : '<span class="badge warn">na fila</span>';
      return '<div class="ex"><b>' + esc(f.titulo) + "</b>" + est + "<small>" + esc(nomeDia(f.data)) + " · " + n + " séries · " + fmtMin(f.duracao_min || 0) + "</small></div>";
    }).join("") + "</div>";
  }
  $("#tela").innerHTML = html;
  ligarTela();
  const bc = $("#fContinuar"); if (bc) bc.onclick = () => abrirPlayer(andamento);
  const bd = $("#fDescartar"); if (bd) bd.onclick = async () => {
    if (!confirm("Descartar o treino em andamento? As séries feitas somem.")) return;
    S.forca = S.forca.filter((f) => f.id !== andamento.id);
    await idb.del("forca", andamento.id);
    render();
  };
  const bl = $("#fLivre"); if (bl) bl.onclick = () => abrirAlterarForcaLivre();
}

function sparkline(v) {
  if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v), w = 60, hgt = 14;
  const pts = v.map((x, i) => (i * w / (v.length - 1)).toFixed(1) + "," + (hgt - (hi === lo ? hgt / 2 : (x - lo) * hgt / (hi - lo))).toFixed(1)).join(" ");
  const cor = v[v.length - 1] >= v[0] ? "var(--ok)" : "var(--bad)";
  return '<svg width="' + w + '" height="' + hgt + '" style="vertical-align:middle"><polyline points="' + pts + '" fill="none" stroke="' + cor + '" stroke-width="2"/></svg>';
}

function abrirAlterarForcaLivre() {
  abrirAlterar(hojeLocal(), null);
  A.livre = true;
  A.mod = "forca";
  A.modelo = modelosDe("forca", null)[0];
  A.minutos = 45;
  $("#aSalvar").onclick = async () => {
    const g = GERADOR.gerar(A.modelo, A.minutos, ctxGerador(A.data));
    fecharFolha(true);
    await iniciarForca({ id: null, titulo: g.titulo, detalhe: g.detalhe, duracao_min: g.duracao_min }, A.data);
  };
  renderAlterar();
}

/* ------------------------------------------------------------------------- */
/* Comecar                                                                    */
/* ------------------------------------------------------------------------- */

async function comecarForcaDaSessao(data, id) {
  const andamento = S.forca.find((f) => f.status === "andamento");
  if (andamento) {
    if (String(andamento.sessao_id) === String(id) || confirm("Há um treino em andamento (" + andamento.titulo + "). Continuar ele?")) { abrirPlayer(andamento); return; }
    return;
  }
  const s = sessaoPorId(data, id);
  if (!s) return;
  let det = s.detalhe && s.detalhe.forca ? s.detalhe : null;
  if (!det) {
    const modelo = s.modelo || modelosDe("forca", null)[0];
    det = GERADOR.gerar(modelo, s.duracao_min || 45, ctxGerador(data)).detalhe;
  } else {
    // cargas sugeridas de novo: pode ter treino registrado depois que a sessao foi montada
    const hist = historicoForca();
    det = JSON.parse(JSON.stringify(det));
    det.forca.exercicios.forEach((e) => { const sg = GERADOR.sugerirCarga(e, hist[e.chave], catEx(e.chave)); e.kg = sg.kg; e.motivo = sg.motivo; });
  }
  await iniciarForca({ id: /^\d+$/.test(String(s.id)) ? Number(s.id) : null, titulo: s.titulo, detalhe: det, duracao_min: s.duracao_min }, data);
}

/* Troca feita no player vale para as proximas sessoes neste celular. */
function substitutosLocais() { try { return JSON.parse(localStorage.getItem("treino_substitutos") || "{}"); } catch { return {}; } }
function guardarSubstituto(de, para) {
  const d = substitutosLocais();
  d[de] = para;
  delete d[para];
  try { localStorage.setItem("treino_substitutos", JSON.stringify(d)); } catch {}
}

async function iniciarForca(sessao, data) {
  const f = JSON.parse(JSON.stringify(sessao.detalhe.forca));
  const subs = substitutosLocais(), cat = (S.pac && S.pac.catalogo_forca) || {}, hist = historicoForca();
  const usados = new Set();
  f.exercicios = f.exercicios.filter((e) => {
    const k = subs[e.chave] && cat[subs[e.chave]] ? subs[e.chave] : e.chave;
    if (!cat[k] || usados.has(k)) return false;
    usados.add(k);
    if (k !== e.chave) {
      const c = cat[k];
      Object.assign(e, { chave: k, nome: c.nome, medida: c.medida, descanso_s: c.descanso_s });
      const sg = GERADOR.sugerirCarga(e, hist[k], c);
      e.kg = sg.kg; e.motivo = sg.motivo;
    }
    return true;
  });
  const log = {
    id: uid(), status: "andamento", data, sessao_id: sessao.id, titulo: sessao.titulo, inicio: agoraIso(), atual: 0,
    rir: f.rir, planejado_min: sessao.duracao_min,
    exercicios: f.exercicios.map((e) => ({
      chave: e.chave, nome: e.nome, medida: e.medida, series: e.series, reps_min: e.reps_min, reps_max: e.reps_max,
      alvo_s: e.alvo_s, rir: e.rir, descanso_s: descansosPreferidos()[e.chave] || e.descanso_s, kg: e.kg, motivo: e.motivo, feitas: [],
    })),
  };
  S.forca.push(log);
  await idb.put("forca", log);
  abrirPlayer(log);
}

function retomarForca() {
  // so avisa; abrir sozinho no meio do dia assustaria
  const a = S.forca.find((f) => f.status === "andamento");
  if (a && Date.now() - new Date(a.inicio).getTime() < 4 * 3600e3) toast("Treino de força em andamento — aba Força para continuar", 4000);
}

/* ------------------------------------------------------------------------- */
/* Player                                                                     */
/* ------------------------------------------------------------------------- */

async function travarTela() {
  try { if ("wakeLock" in navigator) PL.wake = await navigator.wakeLock.request("screen"); } catch {}
}

function abrirPlayer(log) {
  PL.log = log;
  PL.aberto = true;
  PL.tela = "serie";
  PL.entrada = null;
  $("#player").classList.add("on");
  history.pushState({ player: 1 }, "");
  travarTela();
  clearInterval(PL.tick);
  PL.tick = setInterval(tickPlayer, 500);
  $("#pSair").onclick = () => fecharPlayer();
  $("#pLista").onclick = () => { PL.tela = PL.tela === "lista" ? "serie" : "lista"; renderPlayer(); };
  $("#pAnt").onclick = () => (modoAuto() ? autoIrPara(PL.log.atual - 1) : irPara(PL.log.atual - 1));
  $("#pProx").onclick = () => (modoAuto() ? autoIrPara(PL.log.atual + 1) : irPara(PL.log.atual + 1));
  $("#pFeita").onclick = serieFeita;
  $("#dPular").onclick = () => fimDescanso(true);
  $("#dMais").onclick = () => { PL.fimDescanso += 30000; tickPlayer(); };
  $("#dMenos").onclick = () => { PL.fimDescanso -= 15000; tickPlayer(); };
  renderPlayer();
}

function fecharPlayer() {
  PL.aberto = false;
  $("#player").classList.remove("on");
  $("#descanso").classList.remove("on");
  clearInterval(PL.tick);
  try { if (PL.wake) PL.wake.release(); } catch {}
  PL.wake = null;
  if (history.state && history.state.player) history.back();
  render();
}
function fecharPlayerPeloVoltar() {
  if (!PL.aberto) return;
  if ($("#descanso").classList.contains("on")) { fimDescanso(true); history.pushState({ player: 1 }, ""); return; }
  PL.aberto = false;
  $("#player").classList.remove("on");
  clearInterval(PL.tick);
  try { if (PL.wake) PL.wake.release(); } catch {}
  render();
}

document.addEventListener("visibilitychange", () => { if (PL.aberto && document.visibilityState === "visible") travarTela(); });

function exAtual() { return PL.log.exercicios[PL.log.atual]; }

function entradaPadrao(e) {
  const ult = e.feitas[e.feitas.length - 1];
  if (e.medida === "s") return { kg: ult ? ult.kg : e.kg || 0, reps: null, s: e.alvo_s || 40, rir: e.rir };
  return { kg: ult ? ult.kg : (e.kg != null ? e.kg : 0), reps: ult ? ult.reps : e.reps_max, rir: e.rir };
}

function irPara(i) {
  if (i < 0 || i >= PL.log.exercicios.length) return;
  PL.log.atual = i;
  PL.entrada = null;
  PL.tela = "serie";
  idb.put("forca", PL.log);
  renderPlayer();
}

function tickPlayer() {
  if (!PL.log) return;
  const seg = Math.floor((Date.now() - new Date(PL.log.inicio).getTime()) / 1000);
  $("#pTempo").textContent = Math.floor(seg / 60) + ":" + String(seg % 60).padStart(2, "0") + " de treino";
  if (typeof modoAuto === "function" && modoAuto()) { tickAuto(); return; }
  if ($("#descanso").classList.contains("on")) {
    const r = Math.ceil((PL.fimDescanso - Date.now()) / 1000);
    $("#dTempo").textContent = r <= 0 ? "Bora!" : Math.floor(r / 60) + ":" + String(r % 60).padStart(2, "0");
    if (r === 10 && !PL.avisou10) { PL.avisou10 = true; bip(1); }
    if (r <= 0 && !PL.acabou) { PL.acabou = true; bip(3); try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 500]); } catch {} setTimeout(() => fimDescanso(false), 1200); }
  }
  if (PL.cronometro) {
    const el = $("#pCrono");
    if (el) {
      const s = Math.floor((Date.now() - PL.cronometro) / 1000);
      el.textContent = s + " s";
      const e = exAtual();
      if (e && s === (e.alvo_s || 40) && !PL.cronoAvisou) { PL.cronoAvisou = true; bip(2); try { navigator.vibrate && navigator.vibrate([400, 100, 400]); } catch {} }
    }
  }
}

let AUDIO = null;
function bip(n) {
  try {
    AUDIO = AUDIO || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < n; i++) {
      const o = AUDIO.createOscillator(), g = AUDIO.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(AUDIO.destination);
      const t = AUDIO.currentTime + i * 0.28;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.start(t); o.stop(t + 0.22);
    }
  } catch {}
}

function renderPlayer() {
  const log = PL.log;
  $("#pTitulo").textContent = log.titulo;
  const corpo = $("#pCorpo");
  if (PL.tela === "lista") { renderLista(corpo); return; }
  if (PL.tela === "fim") { renderFim(corpo); return; }
  if (typeof modoAuto === "function" && modoAuto()) { renderAuto(corpo); return; }
  const e = exAtual();
  const c = catEx(e.chave);
  if (!PL.entrada) PL.entrada = entradaPadrao(e);
  const en = PL.entrada;
  const n = e.feitas.length;
  const total = Math.max(e.series, n + (n >= e.series ? 0 : 1));
  const alvo = e.medida === "s" ? e.series + " × " + (e.alvo_s || 40) + " s" : e.series + " × " + e.reps_min + (e.reps_max !== e.reps_min ? "–" + e.reps_max : "") + " reps · sobrar " + e.rir;
  let h = '<div class="sub">Exercício ' + (log.atual + 1) + " de " + log.exercicios.length + '</div><div class="exnome">' + esc(e.nome) + '</div><div class="alvo">' + esc(alvo) + "</div>" +
    (e.motivo ? '<div class="motivo">' + esc(e.motivo) + "</div>" : "");
  h += '<table class="tabela num"><tr><th>Série</th><th>kg</th><th>' + (e.medida === "s" ? "seg" : "reps") + "</th><th>sobrou</th></tr>";
  for (let i = 0; i < total; i++) {
    const f = e.feitas[i];
    if (f) h += '<tr class="feita"><td>' + (i + 1) + " ✓</td><td>" + (f.kg || 0) + "</td><td>" + (f.reps != null ? f.reps : f.s) + "</td><td>" + (f.rir != null ? f.rir : "—") + "</td></tr>";
    else if (i === n) h += '<tr class="atual"><td>' + (i + 1) + "</td><td>" + en.kg + "</td><td>" + (e.medida === "s" ? en.s : en.reps) + "</td><td>" + en.rir + "</td></tr>";
    else h += '<tr><td>' + (i + 1) + "</td><td>—</td><td>—</td><td>—</td></tr>";
  }
  h += "</table>";
  if (!c.corporal || en.kg) {
    h += '<div class="stepper"><button class="icon" data-kg="-1">−</button><div class="val"><button class="valbtn" id="inKg">' + String(en.kg).replace(".", ",") +
      '</button><span>kg · passo ' + String(c.inc || 1).replace(".", ",") + '</span></div><button class="icon" data-kg="1">+</button></div>';
  } else {
    h += '<div class="sub" style="text-align:center">Peso do corpo · <button class="btn small ghost" data-kg="1">+ carga</button></div>';
  }
  if (e.medida === "s") {
    h += '<div class="stepper"><button class="icon" data-s="-5">−</button><div class="val"><b class="num">' + en.s + '</b><span>segundos</span></div><button class="icon" data-s="5">+</button></div>' +
      '<div style="text-align:center;margin:6px 0"><button class="btn" id="pCronoBtn">' + (PL.cronometro ? 'Parar <span id="pCrono" class="num"></span>' : "▶ Cronometrar") + "</button></div>";
  } else {
    h += '<div class="stepper"><button class="icon" data-reps="-1">−</button><div class="val"><button class="valbtn" id="inReps">' + en.reps + '</button><span>repetições</span></div><button class="icon" data-reps="1">+</button></div>';
  }
  h += '<div class="sub" style="text-align:center">Quantas repetições ainda sobravam?</div><div class="rir">' +
    [0, 1, 2, 3, 4].map((v) => '<button class="' + (en.rir === v ? "on" : "") + '" data-rir="' + v + '">' + (v === 4 ? "4+" : v) + "</button>").join("") + "</div>";
  const desc = Math.round(e.descanso_s || c.descanso_s || 90);
  h += '<div class="row" style="margin:4px 0 2px"><span>Descanso entre séries</span><span class="sp"></span>' +
    '<button class="icon" data-desc="-15" aria-label="Menos 15 segundos">−</button><b class="num" style="min-width:52px;text-align:center;font-size:20px">' + fmtSeg(desc) +
    '</b><button class="icon" data-desc="15" aria-label="Mais 15 segundos">+</button></div>';
  h += '<div class="acoes"><button class="btn small ghost" id="pAuto">Modo automático (tempo fixo)</button><button class="btn small ghost" id="pMaisSerie">+ série</button><button class="btn small ghost" id="pTrocar">Trocar exercício</button>' +
    (n > 0 ? '<button class="btn small ghost" id="pDesfazer">Desfazer última</button>' : "") + "</div>";
  corpo.innerHTML = h;
  $("#pFeita").onclick = serieFeita;
  $("#pFeita").textContent = n >= e.series ? "Série extra feita ✓" : "Série " + (n + 1) + " de " + e.series + " feita ✓";
  $("#pAnt").disabled = log.atual === 0;
  $("#pProx").disabled = log.atual >= log.exercicios.length - 1;

  const inc = c.inc || 1;
  corpo.querySelectorAll("[data-kg]").forEach((b) => { b.onclick = () => { en.kg = Math.max(0, Math.round((en.kg + Number(b.dataset.kg) * inc) * 100) / 100); renderPlayer(); }; });
  corpo.querySelectorAll("[data-reps]").forEach((b) => { b.onclick = () => { en.reps = Math.max(0, en.reps + Number(b.dataset.reps)); renderPlayer(); }; });
  corpo.querySelectorAll("[data-s]").forEach((b) => { b.onclick = () => { en.s = Math.max(5, en.s + Number(b.dataset.s)); renderPlayer(); }; });
  corpo.querySelectorAll("[data-rir]").forEach((b) => { b.onclick = () => { en.rir = Number(b.dataset.rir); renderPlayer(); }; });
  ligarTeclados(corpo, e, en);
  const cb = $("#pCronoBtn");
  if (cb) cb.onclick = () => {
    if (PL.cronometro) { en.s = Math.floor((Date.now() - PL.cronometro) / 1000); PL.cronometro = 0; }
    else { PL.cronometro = Date.now(); PL.cronoAvisou = false; }
    renderPlayer();
  };
  corpo.querySelectorAll("[data-desc]").forEach((b) => {
    b.onclick = () => {
      e.descanso_s = Math.max(15, Math.min(600, desc + Number(b.dataset.desc)));
      guardarDescanso(e.chave, e.descanso_s);
      idb.put("forca", log);
      renderPlayer();
    };
  });
  $("#pMaisSerie").onclick = () => { e.series += 1; idb.put("forca", log); renderPlayer(); };
  $("#pAuto").onclick = () => definirModo(true);
  $("#pTrocar").onclick = () => trocarExercicio();
  const bd = $("#pDesfazer"); if (bd) bd.onclick = () => { e.feitas.pop(); PL.entrada = null; idb.put("forca", log); renderPlayer(); };
}

async function serieFeita() {
  if (PL.tela !== "serie") { PL.tela = "serie"; renderPlayer(); return; }
  const log = PL.log, e = exAtual(), en = PL.entrada || entradaPadrao(e), c = catEx(e.chave);
  if (PL.cronometro) { en.s = Math.floor((Date.now() - PL.cronometro) / 1000); PL.cronometro = 0; }
  e.feitas.push({ kg: en.kg, reps: e.medida === "s" ? null : en.reps, s: e.medida === "s" ? en.s : null, rir: en.rir, t: agoraIso() });
  await idb.put("forca", log);

  // ajuste dentro da sessao: a primeira serie diz se a carga sugerida acertou
  let dica = "";
  const prox = { kg: en.kg, reps: en.reps, s: en.s, rir: e.rir };
  if (e.medida !== "s" && c.inc) {
    if (en.reps >= e.reps_max + 2 && en.rir >= e.rir + 1) { prox.kg = en.kg + c.inc; prox.reps = e.reps_max; dica = "Leve demais: próxima série com " + prox.kg + " kg."; }
    else if (en.reps < e.reps_min || en.rir === 0 && e.rir >= 2) { prox.kg = Math.max(0, en.kg - c.inc); prox.reps = e.reps_max; dica = "Pesado demais: próxima com " + prox.kg + " kg."; }
  }
  PL.entrada = prox;

  const acabouEx = e.feitas.length >= e.series;
  const ultimoEx = log.atual >= log.exercicios.length - 1;
  if (acabouEx && ultimoEx && log.exercicios.every((x) => x.feitas.length >= x.series)) {
    PL.tela = "fim";
    renderPlayer();
    bip(2);
    return;
  }
  let proxTexto;
  if (acabouEx) {
    const i = log.exercicios.findIndex((x, k) => k > log.atual && x.feitas.length < x.series);
    const alvo = i >= 0 ? i : log.exercicios.findIndex((x) => x.feitas.length < x.series);
    if (alvo >= 0) { log.atual = alvo; PL.entrada = null; }
    const nx = exAtual();
    proxTexto = "Próximo: <b>" + esc(nx.nome) + "</b>" + (nx.kg ? " · " + nx.kg + " kg" : "");
  } else {
    proxTexto = "Série " + (e.feitas.length + 1) + " de " + e.series + " · " + prox.kg + " kg" + (dica ? "<br>" + esc(dica) : "");
  }
  await idb.put("forca", log);
  iniciarDescanso(e.descanso_s || c.descanso_s || 90, proxTexto);
  renderPlayer();
}

function iniciarDescanso(seg, texto) {
  PL.fimDescanso = Date.now() + seg * 1000;
  PL.acabou = false;
  PL.avisou10 = false;
  $("#dProx").innerHTML = texto;
  $("#descanso").classList.add("on");
  tickPlayer();
}
function fimDescanso() {
  $("#descanso").classList.remove("on");
  PL.acabou = true;
  renderPlayer();
}

function trocarExercicio() {
  const e = exAtual();
  const cat = (S.pac && S.pac.catalogo_forca) || {};
  const grupo = catEx(e.chave).grupo;
  const opcoes = Object.keys(cat).filter((k) => k !== e.chave).sort((a, b) => (cat[b].grupo === grupo) - (cat[a].grupo === grupo));
  const corpo = $("#pCorpo");
  corpo.innerHTML = '<div class="exnome" style="font-size:20px">Trocar ' + esc(e.nome) + " por…</div>" +
    '<div class="card">' + opcoes.map((k) => '<div class="ex" data-troca="' + k + '"><b>' + esc(cat[k].nome) + '</b><span class="sub">' + esc(cat[k].grupo) + "</span></div>").join("") + "</div>" +
    '<button class="btn" style="width:100%" id="pVoltar">Voltar</button>';
  $("#pVoltar").onclick = () => renderPlayer();
  corpo.querySelectorAll("[data-troca]").forEach((d) => {
    d.onclick = async () => {
      const k = d.dataset.troca, c = cat[k];
      guardarSubstituto(e.chave, k);
      e.chave = k; e.nome = c.nome; e.medida = c.medida; e.descanso_s = descansosPreferidos()[k] || c.descanso_s;
      if (c.medida === "s") { e.alvo_s = 40; } else if (e.reps_min == null) { e.reps_min = 10; e.reps_max = 12; }
      const sg = GERADOR.sugerirCarga(e, historicoForca()[k], c);
      e.kg = sg.kg; e.motivo = sg.motivo; e.feitas = [];
      PL.entrada = null;
      await idb.put("forca", PL.log);
      renderPlayer();
    };
  });
}

function renderLista(corpo) {
  const log = PL.log;
  corpo.innerHTML = '<div class="exnome" style="font-size:20px">Exercícios</div><div class="card">' + log.exercicios.map((e, i) =>
    '<div class="ex" data-ir="' + i + '"><b>' + (i === log.atual ? "▶ " : "") + esc(e.nome) + '</b><span class="kg num">' + e.feitas.length + "/" + e.series + "</span><small>" +
    (e.feitas.length ? e.feitas.map((f) => (f.kg || 0) + "×" + (f.reps != null ? f.reps : f.s + "s")).join(" · ") : (e.kg ? e.kg + " kg sugerido" : "")) + "</small></div>").join("") + "</div>" +
    '<div class="acoes"><button class="btn" id="pAdd">+ Exercício</button><button class="btn ok" id="pEncerrar">Encerrar treino</button></div>';
  corpo.querySelectorAll("[data-ir]").forEach((d) => { d.onclick = () => irPara(Number(d.dataset.ir)); });
  $("#pEncerrar").onclick = () => { PL.tela = "fim"; renderPlayer(); };
  $("#pAdd").onclick = () => {
    const cat = (S.pac && S.pac.catalogo_forca) || {};
    const usados = new Set(log.exercicios.map((e) => e.chave));
    corpo.innerHTML = '<div class="exnome" style="font-size:20px">Adicionar</div><div class="card">' + Object.keys(cat).filter((k) => !usados.has(k)).map((k) =>
      '<div class="ex" data-novo="' + k + '"><b>' + esc(cat[k].nome) + '</b><span class="sub">' + esc(cat[k].grupo) + "</span></div>").join("") + "</div>";
    corpo.querySelectorAll("[data-novo]").forEach((d) => {
      d.onclick = async () => {
        const k = d.dataset.novo, c = cat[k];
        const base = log.exercicios[0] || {};
        const e = { chave: k, nome: c.nome, medida: c.medida, series: 3, reps_min: c.medida === "s" ? null : base.reps_min || 8, reps_max: c.medida === "s" ? null : base.reps_max || 10,
          alvo_s: c.medida === "s" ? 40 : null, rir: log.rir == null ? 2 : log.rir, descanso_s: descansosPreferidos()[k] || c.descanso_s, feitas: [] };
        const sg = GERADOR.sugerirCarga(e, historicoForca()[k], c);
        e.kg = sg.kg; e.motivo = sg.motivo;
        log.exercicios.push(e);
        await idb.put("forca", log);
        irPara(log.exercicios.length - 1);
      };
    });
  };
}

function renderFim(corpo) {
  const log = PL.log;
  const feitas = log.exercicios.filter((e) => e.feitas.length);
  const series = feitas.reduce((s, e) => s + e.feitas.length, 0);
  const volume = feitas.reduce((s, e) => s + e.feitas.reduce((v, f) => v + (f.kg || 0) * (f.reps || 0), 0), 0);
  const min = Math.round((Date.now() - new Date(log.inicio).getTime()) / 60000);
  const hist = historicoForca();
  const recordes = [];
  for (const e of feitas) {
    if (e.medida === "s") continue;
    const antes = Math.max(0, ...(hist[e.chave] || []).map((h) => Math.max(...h.series.map((s) => GERADOR.e1rm(s[0] || 0, s[1], s[2])))));
    const agora = Math.max(...e.feitas.map((f) => GERADOR.e1rm(f.kg || 0, f.reps, f.rir)));
    if (antes > 0 && agora > antes * 1.005) recordes.push(e.nome + ": 1RM estimado " + Math.round(antes) + " → " + Math.round(agora) + " kg");
  }
  const faltam = log.exercicios.filter((e) => e.feitas.length < e.series);
  corpo.innerHTML = '<div class="exnome">Treino concluído</div><div class="mini"><div><span>Tempo</span><b class="num">' + fmtMin(min) + '</b></div><div><span>Séries</span><b class="num">' + series +
    '</b></div><div><span>Volume</span><b class="num">' + Math.round(volume).toLocaleString("pt-BR") + " kg</b></div></div>" +
    (recordes.length ? '<h2>Recordes</h2><div class="card">' + recordes.map((r) => "<div>🏆 " + esc(r) + "</div>").join("") + "</div>" : "") +
    (faltam.length ? '<div class="aviso">Ficou por fazer: ' + faltam.map((e) => esc(e.nome) + " (" + e.feitas.length + "/" + e.series + ")").join(", ") + "</div>" : "") +
    htmlSensacao(feitas) +
    '<div class="acoes" style="margin-top:16px"><button class="btn" id="pVoltarTreino">Voltar ao treino</button><button class="btn ok" id="pSalvar">Salvar treino</button></div>' +
    '<p class="sub">As séries vão para o computador e passam a definir as cargas das próximas sessões. Grave a atividade no relógio como Treino de força para a FC e as calorias.</p>';
  $("#pFeita").textContent = "Salvar treino";
  $("#pVoltarTreino").onclick = () => { PL.tela = "serie"; if (log.auto && !log.auto.pausadoEm) log.auto.pausadoEm = Date.now(); renderPlayer(); };
  $("#pSalvar").onclick = salvarForca;
  corpo.querySelectorAll("[data-sens]").forEach((b) => {
    b.onclick = () => {
      const e = log.exercicios[Number(b.dataset.ex)];
      e.sensacao = b.dataset.sens;
      for (const f of e.feitas) {
        if (!f.auto && f.sensacao == null) continue;
        f.rir = e.sensacao === "facil" ? (e.rir || 2) + 2 : e.sensacao === "pesado" ? 0 : e.rir;
        f.auto = false;
        f.sensacao = e.sensacao;
      }
      idb.put("forca", log);
      renderPlayer();
    };
  });
  $("#pFeita").onclick = salvarForca;
}

/* Series registradas pelo modo automatico carregam a carga e as repeticoes
 * planejadas. Sem confirmacao, a proxima carga so repete; um toque por
 * exercicio diz se foi facil (sobe), na medida ou pesado. */
function htmlSensacao(feitas) {
  const lista = feitas.map((e, i) => [e, PL.log.exercicios.indexOf(e)]).filter(([e]) => e.feitas.some((f) => f.auto || f.sensacao));
  if (!lista.length) return "";
  return '<h2>Como foi cada exercício?</h2><div class="card">' + lista.map(([e, i]) =>
    '<div style="padding:8px 0;border-top:1px solid var(--line)"><b>' + esc(e.nome) + '</b> <span class="sub">' + (e.feitas[0].kg || 0) + " kg</span>" +
    '<div class="chips" style="margin-top:6px">' + [["facil", "Fácil (subir)"], ["medida", "Na medida"], ["pesado", "Pesado"]].map(([k, t]) =>
      '<button class="chip ' + (e.sensacao === k ? "on" : "") + '" data-ex="' + i + '" data-sens="' + k + '">' + t + "</button>").join("") + "</div></div>").join("") +
    '<div class="sub" style="margin-top:6px">Sem resposta, a próxima sessão repete a carga.</div></div>';
}

async function salvarForca() {
  const log = PL.log;
  const feitas = log.exercicios.filter((e) => e.feitas.length);
  if (!feitas.length) {
    if (!confirm("Nenhuma série registrada. Descartar o treino?")) return;
    S.forca = S.forca.filter((f) => f.id !== log.id);
    await idb.del("forca", log.id);
    $("#pFeita").onclick = serieFeita;
    fecharPlayer();
    return;
  }
  log.status = "concluido";
  log.fim = agoraIso();
  log.duracao_min = Math.round((new Date(log.fim) - new Date(log.inicio)) / 60000);
  await idb.put("forca", log);
  const corpo = {
    tipo: "forca", id: log.id, data: log.data, sessao_id: log.sessao_id, titulo: log.titulo, inicio: log.inicio, fim: log.fim, duracao_min: log.duracao_min,
    exercicios: feitas.map((e) => ({
      chave: e.chave, nome: e.nome, alvo: { reps_min: e.reps_min, reps_max: e.reps_max, rir: e.rir },
      series: e.feitas.map((f) => ({ kg: f.kg, reps: f.reps, s: f.s, rir: f.rir, t: f.t, auto: f.auto ? 1 : 0 })),
    })),
  };
  await enfileirar("treino-app forca " + log.data, corpo);
  $("#pFeita").onclick = serieFeita;
  fecharPlayer();
  S.aba = "forca";
  render();
  toast("Treino salvo · " + corpo.exercicios.reduce((s, e) => s + e.series.length, 0) + " séries", 3000);
}
