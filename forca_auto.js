/* Musculacao no modo automatico: tempo fixo por serie.
 *
 * Pedido dele: "4 series de 2:30 cada", sem ficar apertando botao. Cada
 * exercicio tem um CICLO (execucao + descanso). Toca Iniciar uma vez; a cada
 * ciclo o app bipa, vibra e fala a serie e a carga, e registra a serie com a
 * carga e as repeticoes que estao na tela. Mexe-se so quando algo sai
 * diferente. Entre um exercicio e outro ha uma troca de 60 s.
 *
 * O estado e marcado por horario (inicio da fase), nao por contador: com a
 * tela apagada ou o app fechado, ao voltar ele recupera as series que
 * passaram.
 */
"use strict";

const TROCA_S = 60;
const PRESETS_CICLO = [60, 80, 90, 120, 150, 180];

function ciclosPreferidos() { try { return JSON.parse(localStorage.getItem("treino_ciclo") || "{}"); } catch { return {}; } }
function guardarCiclo(chave, s) {
  const d = ciclosPreferidos();
  d[chave] = s;
  try { localStorage.setItem("treino_ciclo", JSON.stringify(d)); } catch {}
}
function cicloDe(e) {
  if (e.ciclo_s) return e.ciclo_s;
  const pref = ciclosPreferidos()[e.chave];
  const fd = (S.pac && S.pac.forca_descanso) || {};
  const c = catEx(e.chave);
  return pref || (c.tipo === "composto" ? fd.pesado_s || 80 : fd.leve_s || 60);
}

function modoAuto() {
  let m = null;
  try { m = localStorage.getItem("treino_forca_modo"); } catch {}
  m = m || ((S.pac && S.pac.forca_descanso && S.pac.forca_descanso.modo) === "apos" ? "manual" : "auto");
  return m === "auto";
}
function definirModo(auto) {
  try { localStorage.setItem("treino_forca_modo", auto ? "auto" : "manual"); } catch {}
  const log = PL.log;
  if (log && log.auto) log.auto.pausadoEm = log.auto.pausadoEm || Date.now();
  PL.entrada = null;
  if (log) idb.put("forca", log);
  renderPlayer();
}

function estadoAuto() {
  const log = PL.log;
  if (!log.auto) log.auto = { iniciado: false, fase: "serie", faseInicio: 0, pausadoEm: null };
  return log.auto;
}

function falar(txt) {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = "pt-BR";
    u.rate = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {}
}

function anunciarSerie() {
  const e = exAtual();
  const n = e.feitas.length + 1;
  bip(3);
  try { navigator.vibrate && navigator.vibrate([300, 120, 300, 120, 500]); } catch {}
  const en = PL.entrada || entradaPadrao(e);
  const carga = en.kg ? ", " + String(en.kg).replace(".", " vírgula ") + " quilos" : "";
  falar((n === 1 ? e.nome + ". " : "") + "Série " + n + carga);
}

function iniciarAuto() {
  const a = estadoAuto();
  a.iniciado = true;
  a.fase = "serie";
  a.faseInicio = Date.now();
  a.pausadoEm = null;
  PL.avisoFase = null;
  idb.put("forca", PL.log);
  anunciarSerie();
  renderPlayer();
}

function pausarAuto() {
  const a = estadoAuto();
  if (!a.iniciado) { iniciarAuto(); return; }
  if (a.pausadoEm) { a.faseInicio += Date.now() - a.pausadoEm; a.pausadoEm = null; bip(1); }
  else a.pausadoEm = Date.now();
  idb.put("forca", PL.log);
  renderPlayer();
}

function autoIrPara(i) {
  const log = PL.log;
  if (i < 0 || i >= log.exercicios.length) return;
  log.atual = i;
  PL.entrada = null;
  const a = estadoAuto();
  a.fase = "troca";
  a.faseInicio = Date.now();
  if (!a.iniciado) { a.iniciado = true; a.pausadoEm = Date.now(); }
  idb.put("forca", log);
  renderPlayer();
}

function duracaoFase(a) { return a.fase === "troca" ? TROCA_S : cicloDe(exAtual()); }

function registrarSerieAuto() {
  const e = exAtual();
  const en = PL.entrada || entradaPadrao(e);
  e.feitas.push({ kg: en.kg, reps: e.medida === "s" ? null : en.reps, s: e.medida === "s" ? en.s : null, rir: en.rir, t: agoraIso(), auto: true });
}

/* Avanca as fases que ja passaram. Devolve true se algo mudou. */
function avancarAuto() {
  const log = PL.log;
  const a = estadoAuto();
  if (!a.iniciado || a.pausadoEm || PL.tela === "fim") return false;
  let mudou = false;
  for (let guarda = 0; guarda < 200; guarda++) {
    const dur = duracaoFase(a) * 1000;
    if (Date.now() - a.faseInicio < dur) break;
    a.faseInicio += dur;
    mudou = true;
    if (a.fase === "serie") {
      registrarSerieAuto();
      const e = exAtual();
      if (e.feitas.length < e.series) { a.fase = "serie"; continue; }
      const prox = log.exercicios.findIndex((x, k) => k > log.atual && x.feitas.length < x.series);
      const alvo = prox >= 0 ? prox : log.exercicios.findIndex((x) => x.feitas.length < x.series);
      if (alvo < 0) { PL.tela = "fim"; a.pausadoEm = Date.now(); break; }
      log.atual = alvo;
      PL.entrada = null;
      a.fase = "troca";
    } else {
      a.fase = "serie";
    }
  }
  if (mudou) {
    idb.put("forca", log);
    if (PL.tela === "fim") { bip(2); falar("Treino concluído"); }
    else if (a.fase === "serie") anunciarSerie();
    else { bip(2); falar("Troca. Próximo: " + exAtual().nome); }
  }
  return mudou;
}

function tickAuto() {
  if (!PL.log || PL.tela === "lista") return;
  if (avancarAuto()) { renderPlayer(); return; }
  const a = estadoAuto();
  if (!a.iniciado || PL.tela === "fim") return;
  const dur = duracaoFase(a);
  const passou = ((a.pausadoEm || Date.now()) - a.faseInicio) / 1000;
  const resta = Math.max(0, Math.ceil(dur - passou));
  const el = $("#aRelogio");
  if (el) el.textContent = fmtSeg(resta);
  const bar = $("#aBarra");
  if (bar) bar.style.width = Math.min(100, 100 * passou / dur) + "%";
  const chave = a.fase + a.faseInicio;
  if (!a.pausadoEm && resta === 5 && PL.avisoFase !== chave) { PL.avisoFase = chave; bip(1); }
}

function renderAuto(corpo) {
  const log = PL.log;
  const a = estadoAuto();
  const e = exAtual();
  const c = catEx(e.chave);
  if (!PL.entrada) PL.entrada = entradaPadrao(e);
  const en = PL.entrada;
  const ciclo = cicloDe(e);
  const n = e.feitas.length;
  const alvo = e.medida === "s" ? e.series + " × " + (e.alvo_s || 40) + " s" : e.series + " × " + e.reps_min + (e.reps_max !== e.reps_min ? "–" + e.reps_max : "") + " reps · sobrar " + e.rir;

  let h = '<div class="row"><span class="sub">Exercício ' + (log.atual + 1) + " de " + log.exercicios.length + '</span><span class="sp"></span>' +
    '<button class="btn small ghost" id="aManual">Modo manual</button></div>' +
    '<div class="exnome">' + esc(e.nome) + '</div><div class="alvo">' + esc(alvo) + "</div>";

  let rotulo;
  if (!a.iniciado) rotulo = "PRONTO";
  else if (a.pausadoEm) rotulo = "PAUSADO";
  else if (a.fase === "troca") rotulo = "TROCA DE EXERCÍCIO";
  else rotulo = "SÉRIE " + Math.min(n + 1, e.series) + " DE " + e.series;
  const dur = a.iniciado ? duracaoFase(a) : ciclo;
  const passou = a.iniciado ? ((a.pausadoEm || Date.now()) - a.faseInicio) / 1000 : 0;
  h += '<div class="card" style="text-align:center;margin-top:10px"><div class="sub" style="font-weight:800;letter-spacing:.1em">' + rotulo + "</div>" +
    '<div class="num" id="aRelogio" style="font-size:84px;font-weight:800;line-height:1.05">' + fmtSeg(Math.max(0, Math.ceil(dur - passou))) + "</div>" +
    '<div class="barra"><span id="aBarra" style="width:' + Math.min(100, 100 * passou / dur) + '%;background:var(--forca)"></span></div>' +
    '<div class="sub">' + (a.fase === "troca" && a.iniciado ? "Prepare o próximo exercício. A primeira série começa no bipe." :
      "Faça a série e descanse até o bipe. A série é registrada sozinha com os valores abaixo.") + "</div></div>";

  // o que vai ser registrado
  h += '<div class="lbl">Vai registrar</div><div class="row" style="gap:6px">' +
    '<button class="icon" data-kg="-1">−</button><div style="flex:1;text-align:center"><button class="valbtn" style="font-size:36px" id="inKg">' + String(en.kg).replace(".", ",") + '</button><div class="sub">kg</div></div>' +
    '<button class="icon" data-kg="1">+</button><span style="width:10px"></span>' +
    (e.medida === "s"
      ? '<button class="icon" data-s="-5">−</button><div style="flex:1;text-align:center"><b class="num" style="font-size:34px">' + en.s + '</b><div class="sub">seg</div></div><button class="icon" data-s="5">+</button>'
      : '<button class="icon" data-reps="-1">−</button><div style="flex:1;text-align:center"><button class="valbtn" style="font-size:36px" id="inReps">' + en.reps + '</button><div class="sub">reps</div></div><button class="icon" data-reps="1">+</button>') +
    "</div>";

  if (n) {
    h += '<table class="tabela num"><tr><th>Série</th><th>kg</th><th>' + (e.medida === "s" ? "seg" : "reps") + "</th><th></th></tr>" +
      e.feitas.map((f, i) => "<tr class=\"feita\"><td>" + (i + 1) + " ✓</td><td>" + (f.kg || 0) + "</td><td>" + (f.reps != null ? f.reps : f.s) + "</td><td>" +
        (i === n - 1 ? '<button class="btn small ghost" id="aCorrigir">usar valores acima</button>' : "") + "</td></tr>").join("") + "</table>" +
      '<div class="sub">Saiu diferente? Ajuste kg e reps acima e toque em "usar valores acima" para corrigir a última série.</div>';
  }

  h += '<div class="lbl">Tempo por série (execução + descanso)</div>' +
    '<div class="row"><button class="icon" data-ciclo="-10">−</button><b class="num" style="flex:1;text-align:center;font-size:26px">' + fmtSeg(ciclo) +
    '</b><button class="icon" data-ciclo="10">+</button></div><div class="chips">' +
    PRESETS_CICLO.map((v) => '<button class="chip ' + (ciclo === v ? "on" : "") + '" data-cicloset="' + v + '">' + fmtSeg(v) + "</button>").join("") + "</div>" +
    '<div class="sub">' + e.series + " séries × " + fmtSeg(ciclo) + " = " + fmtSeg(e.series * ciclo) + ". Vale para " + esc(e.nome) + " daqui em diante.</div>" +
    '<div class="acoes"><button class="btn small ghost" id="pMaisSerie">+ série</button><button class="btn small ghost" id="aMenosSerie">− série</button><button class="btn small ghost" id="pTrocar">Trocar exercício</button></div>';
  corpo.innerHTML = h;

  const btn = $("#pFeita");
  btn.textContent = !a.iniciado ? "▶ Iniciar" : a.pausadoEm ? "▶ Continuar" : "⏸ Pausar";
  btn.onclick = pausarAuto;
  $("#pAnt").disabled = log.atual === 0;
  $("#pProx").disabled = log.atual >= log.exercicios.length - 1;

  const inc = c.inc || 1;
  corpo.querySelectorAll("[data-kg]").forEach((b) => { b.onclick = () => { en.kg = Math.max(0, Math.round((en.kg + Number(b.dataset.kg) * inc) * 100) / 100); renderPlayer(); }; });
  corpo.querySelectorAll("[data-reps]").forEach((b) => { b.onclick = () => { en.reps = Math.max(0, en.reps + Number(b.dataset.reps)); renderPlayer(); }; });
  corpo.querySelectorAll("[data-s]").forEach((b) => { b.onclick = () => { en.s = Math.max(5, en.s + Number(b.dataset.s)); renderPlayer(); }; });
  ligarTeclados(corpo, e, en);
  const mudarCiclo = (v) => { e.ciclo_s = Math.max(20, Math.min(600, v)); guardarCiclo(e.chave, e.ciclo_s); idb.put("forca", log); renderPlayer(); };
  corpo.querySelectorAll("[data-ciclo]").forEach((b) => { b.onclick = () => mudarCiclo(ciclo + Number(b.dataset.ciclo)); });
  corpo.querySelectorAll("[data-cicloset]").forEach((b) => { b.onclick = () => mudarCiclo(Number(b.dataset.cicloset)); });
  $("#aManual").onclick = () => definirModo(false);
  $("#pMaisSerie").onclick = () => { e.series += 1; idb.put("forca", log); renderPlayer(); };
  $("#aMenosSerie").onclick = () => { e.series = Math.max(Math.max(1, n), e.series - 1); idb.put("forca", log); renderPlayer(); };
  $("#pTrocar").onclick = () => trocarExercicio();
  const cor = $("#aCorrigir");
  if (cor) cor.onclick = () => {
    const f = e.feitas[n - 1];
    f.kg = en.kg;
    if (e.medida === "s") f.s = en.s; else f.reps = en.reps;
    f.auto = false;
    idb.put("forca", log);
    toast("Série " + n + " corrigida: " + f.kg + " kg × " + (f.reps != null ? f.reps : f.s + " s"));
    renderPlayer();
  };
}
