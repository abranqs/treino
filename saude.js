/* Saude: o registro de 30 segundos (aba Hoje) e a aba Saude.
 *
 * O computador publica em treino.json o bloco "saude" (sono, pressao, peso,
 * vinho, cigarro e o que ja foi registrado hoje). Aqui o dia e registrado em
 * um cartao so e volta como issue "treino-app registro <data>", pela mesma
 * fila das trocas (um toque pode gerar dois registros: o que fecha ontem, com
 * vinho e cigarros, e o de hoje). O registro fica no celular ate o id aparecer em
 * registros_recebidos; enquanto isso a tela mostra o valor local como
 * "enviado, aguardando o computador".
 *
 * O bloco "saude" pode faltar (treino.json antigo) ou vir com partes nulas:
 * cada cartao mostra "ainda sem dados" e segue. O app mede; nao da sermao.
 */
"use strict";

const SEM_DADOS = '<div class="sub">Ainda sem dados.</div>';
const PROTOCOLO_PARADO = "protocolo parado; lance uma medida para recomeçar";   // protocolo null: sem medida ou parado ha mais de 2 dias
const lista = (x) => (Array.isArray(x) ? x.filter((y) => y != null) : []);
const fmtDM = (iso) => (iso ? String(iso).slice(8, 10) + "/" + String(iso).slice(5, 7) : "—");
function fmtV(v, casas) {
  if (v == null || isNaN(Number(v))) return "—";
  const n = Number(v);
  return n.toFixed(casas == null ? (Number.isInteger(n) ? 0 : 1) : casas).replace(".", ",");
}
const comSinal = (v, casas) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmtV(Math.abs(v), casas);
function dataMais(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function horaAgora() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
/* Diferenca em minutos entre duas horas HH:MM, passando pela meia-noite: 00:10 contra 22:15 = +115. */
function difHora(hora, alvo) {
  const m = (t) => { const x = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
  const a = m(hora), b = m(alvo);
  if (a == null || b == null) return null;
  return ((a - b + 720) % 1440 + 1440) % 1440 - 720;
}

/* ------------------------------------------------------------------------- */
/* Registro do dia: rascunho, montagem e fila                                 */
/* ------------------------------------------------------------------------- */

/* O rascunho guarda o texto como foi digitado (os campos sao redesenhados com
 * ele) e so vira numero na hora de enviar.
 *
 * Vinho e cigarros tem dois lugares. O registro costuma ser feito de manha e o
 * vinho acontece a noite: mandar 0 para HOJE de manha gravaria um zero falso.
 * Por isso o que fecha o dia e o bloco "Ontem" (ontemVinho, ontemCigarros;
 * null = ainda nao mexi, vale o valor de partida), que vai num registro
 * separado com a data de ontem. Os de hoje (vinho, cigarros) so vao se ele
 * abrir "ja bebi ou fumei hoje" (bebiHoje) e marcar. */
const REG_VAZIO = { ontemVinho: null, ontemCigarros: null, ontemCorrigir: false, nota: null, bebiHoje: false, vinho: "", cigarros: "",
  sis: "", dia: "", fc: "", medidas: [], peso: "", cintura: "", obs: "" };
const REG = JSON.parse(JSON.stringify(REG_VAZIO));
const PASSO_REG = { vinho: 1, cigarros: 1, ontemVinho: 1, ontemCigarros: 1, peso: 0.1, cintura: 0.5 };
const DO_ZERO = { vinho: 1, cigarros: 1, ontemVinho: 1, ontemCigarros: 1 };   // campos que, vazios, partem de 0 ou 1 no toque

/* O que ja se sabe de ontem: o computador publica saude.ontem (null = ainda
 * nao informado); um registro de ontem que ainda aguarda o computador vale por
 * cima. Se o treino.json for de ontem (o computador ainda nao publicou hoje),
 * o "hoje" dele e o nosso ontem. */
function ontemSabido() {
  const p = S.pac || {}, sd = p.saude || {}, hoje = hojeLocal(), ontem = dataMais(hoje, -1);
  const comp = (p.hoje === hoje ? sd.ontem : p.hoje === ontem ? sd.hoje : null) || {};
  const v = { data: ontem, vinho_tacas: comp.vinho_tacas != null ? comp.vinho_tacas : null, cigarros: comp.cigarros != null ? comp.cigarros : null, pend: null };
  for (const r of registrosPendentes()) {
    if (r.data !== ontem) continue;
    if (r.corpo.vinho_tacas != null) { v.vinho_tacas = r.corpo.vinho_tacas; v.pend = r; }
    if (r.corpo.cigarros != null) { v.cigarros = r.corpo.cigarros; v.pend = r; }
  }
  v.completo = v.vinho_tacas != null && v.cigarros != null;
  return v;
}
/* O bloco de ontem fica aberto (e e enviado) enquanto faltar valor, ou quando ele pede para corrigir. */
function ontemAberto(r) { return !!(r || REG).ontemCorrigir || !ontemSabido().completo; }
function textoReg(k, r) {
  r = r || REG;
  if (r[k] != null) return r[k];
  if (k !== "ontemVinho" && k !== "ontemCigarros") return "";
  const v = ontemSabido()[k === "ontemVinho" ? "vinho_tacas" : "cigarros"];
  return String(v == null ? 0 : v).replace(".", ",");   // nada informado: abre em 0 (= nao bebi / nao fumei)
}

function guardarRascunho() {
  clearTimeout(guardarRascunho.h);
  guardarRascunho.h = setTimeout(() => idb.put("kv", { k: "rascunho_registro", v: Object.assign({}, REG, { dia_ref: hojeLocal() }) }), 500);
}
function limparRascunho() {
  Object.assign(REG, JSON.parse(JSON.stringify(REG_VAZIO)));
  guardarRascunho();
}
async function carregarRascunho() {
  const r = await idb.get("kv", "rascunho_registro");
  if (!r || !r.v || r.v.dia_ref !== hojeLocal()) return;   // rascunho de outro dia nao vale
  for (const k of Object.keys(REG_VAZIO)) if (r.v[k] !== undefined) REG[k] = r.v[k];
  REG.medidas = lista(REG.medidas);
}

/* Campo vazio = null (nao mexe). Campo preenchido errado = erro, nunca descarte calado. */
function lerCampo(txt, rotulo, min, max, inteiro) {
  const t = String(txt == null ? "" : txt).trim().replace(",", ".");
  if (t === "") return null;
  const v = Number(t);
  if (!/^\d+(\.\d*)?$/.test(t) || isNaN(v) || v < min || v > max || (inteiro && !Number.isInteger(v))) {
    throw new Error(rotulo + ": confira o número (de " + min + " a " + max + (inteiro ? ", sem vírgula" : "") + ").");
  }
  return v;
}
function lerSolto(txt) {
  const v = Number(String(txt == null ? "" : txt).trim().replace(",", "."));
  return String(txt == null ? "" : txt).trim() === "" || isNaN(v) ? null : v;
}

/* A medida que esta nos tres campos de pressao; null se estao vazios. */
function lerMedida(r) {
  if (![r.sis, r.dia, r.fc].some((x) => String(x == null ? "" : x).trim())) return null;
  const sis = lerCampo(r.sis, "Pressão máxima", 60, 260, true);
  const dia = lerCampo(r.dia, "Pressão mínima", 30, 160, true);
  const fc = lerCampo(r.fc, "FC", 30, 220, true);
  if (sis == null || dia == null) throw new Error("Pressão: preencha a máxima e a mínima.");
  if (dia >= sis) throw new Error("Pressão: a máxima tem de ser maior que a mínima.");
  return { hora: horaAgora(), sis, dia, fc };
}

/* Um toque em Enviar pode gerar ate dois registros, cada um com seu id:
 *  - ontem: so vinho_tacas e cigarros, com a data de ontem, quando o bloco de
 *    ontem esta aberto (valor ainda nao informado, ou em correcao);
 *  - hoje: nota, pressao, peso, cintura, observacao e, so se "ja bebi ou fumei
 *    hoje" estiver aberto e marcado, vinho e cigarros.
 * Registro sem nenhum campo preenchido nao e gerado. Devolve { corpos } ou
 * { erro }. As datas sao ontem e hoje: o computador recusa data futura. */
function montarRegistros(r) {
  try {
    const hoje = hojeLocal();
    const corpos = [];
    if (ontemAberto(r)) {
      const o = { tipo: "registro", id: uid(), data: dataMais(hoje, -1),
        vinho_tacas: lerCampo(textoReg("ontemVinho", r), "Vinho de ontem", 0, 20, false),
        cigarros: lerCampo(textoReg("ontemCigarros", r), "Cigarros de ontem", 0, 100, true) };
      const sab = ontemSabido();
      const igual = sab.completo && o.vinho_tacas === sab.vinho_tacas && o.cigarros === sab.cigarros;   // abriu "corrigir" e nao mudou nada
      if ((o.vinho_tacas != null || o.cigarros != null) && !igual) corpos.push(o);
    }
    const corpo = {
      tipo: "registro", id: uid(), data: hoje,
      nota: r.nota == null ? null : r.nota,
      observacao: String(r.obs || "").trim() || null,
      vinho_tacas: r.bebiHoje ? lerCampo(r.vinho, "Vinho de hoje", 0, 20, false) : null,
      cigarros: r.bebiHoje ? lerCampo(r.cigarros, "Cigarros de hoje", 0, 100, true) : null,
      pressao: lista(r.medidas).map((m) => Object.assign({}, m)),
      peso_kg: lerCampo(r.peso, "Peso", 30, 250, false),
      cintura_cm: lerCampo(r.cintura, "Cintura", 40, 200, false),
      gordura_pct: null, cigarro_dia_d: null,
    };
    const m = lerMedida(r);
    if (m) corpo.pressao.push(m);
    const vazio = corpo.nota == null && !corpo.observacao && corpo.vinho_tacas == null && corpo.cigarros == null &&
      !corpo.pressao.length && corpo.peso_kg == null && corpo.cintura_cm == null;
    if (!vazio) corpos.push(corpo);
    return corpos.length ? { corpos } : { erro: "Nada preenchido ainda." };
  } catch (e) {
    return { erro: e.message };
  }
}

/* Guarda o registro no celular e poe a issue na fila. Ele so sai de
 * S.registros quando o computador publica o id (limparAplicados, em app.js). */
async function enviarRegistro(corpo) {
  S.registros.push({ id: corpo.id, data: corpo.data, corpo, criado_em: agoraIso(), enviado_em: null });
  await salvarRegistros();
  await enfileirar("treino-app registro " + corpo.data, corpo);
}

function registrosPendentes() {
  const recebidos = new Set(lista(S.pac && S.pac.registros_recebidos));
  return S.registros.filter((r) => r && r.corpo && !recebidos.has(r.id));
}
function estadoRegistro(r) { return r.enviado_em ? "enviado, aguardando o computador" : "na fila do celular"; }

function resumoRegistro(c) {
  const p = [];
  if (c.nota != null) p.push("nota " + c.nota);
  if (c.vinho_tacas != null) p.push(fmtV(c.vinho_tacas) + (c.vinho_tacas === 1 ? " taça" : " taças") + " de vinho");
  if (c.cigarros != null) p.push(c.cigarros + (c.cigarros === 1 ? " cigarro" : " cigarros"));
  lista(c.pressao).forEach((m) => p.push("pressão " + m.sis + "/" + m.dia + (m.fc ? " FC " + m.fc : "")));
  if (c.peso_kg != null) p.push(fmtV(c.peso_kg, 1) + " kg");
  if (c.cintura_cm != null) p.push("cintura " + fmtV(c.cintura_cm, 1) + " cm");
  if (c.cigarro_dia_d) p.push("Dia D em " + fmtDM(c.cigarro_dia_d));
  if (c.observacao) p.push("“" + c.observacao + "”");
  return p.join(" · ");
}

function htmlPendente(r, texto) {
  return '<div class="linha"><span><span class="badge ' + (r.enviado_em ? "info" : "warn") + '">' + estadoRegistro(r) + "</span><br>" + esc(texto) + "</span></div>";
}

/* ------------------------------------------------------------------------- */
/* Aba Hoje: sono, pressao e o cartao de registro                             */
/* ------------------------------------------------------------------------- */

function ultimaNoite(sono) {
  return lista(sono && sono.noites).filter((n) => n.data).sort((a, b) => String(a.data).localeCompare(String(b.data))).pop() || null;
}

function htmlSonoPressaoHoje(p) {
  const sd = p.saude || {}, so = sd.sono, pr = sd.pressao;
  let h = '<h2>Sono e pressão</h2><div class="card">';

  const n = ultimaNoite(so);
  const durou = n && n.duracao_min ? n.duracao_min : (p.hoje === hojeLocal() && p.sono && p.sono.duracao_min) || null;
  const partes = [];
  if (durou) partes.push("<b>" + fmtMin(durou) + "</b> na última noite" + (n && p.hoje && n.data !== p.hoje ? " (" + fmtDM(n.data) + ")" : ""));
  if (so && so.divida_semana_min != null) partes.push(so.divida_semana_min > 0 ? "dívida da semana <b>" + fmtMin(so.divida_semana_min) + "</b>" : "sem dívida na semana");
  if (n && n.deitou) {
    const d = so.alvo_deitar ? difHora(n.deitou, so.alvo_deitar) : null;
    partes.push("deitou <b>" + esc(n.deitou) + "</b>" + (so.alvo_deitar ? ", alvo " + esc(so.alvo_deitar) + (d == null ? "" : d === 0 ? " (na hora)" : " (" + comSinal(d, 0) + " min)") : ""));
  } else if (so && so.alvo_deitar) partes.push("alvo de deitar " + esc(so.alvo_deitar));
  h += '<div class="linha"><b>Sono</b><span>' + (partes.length ? partes.join(" · ") : "ainda sem dados") + "</span></div>";

  const m7 = pr && pr.media_7d, meta = pr && lista(pr.meta).length === 2 ? pr.meta : [130, 80];
  const pp = [];
  if (m7 && m7.sis != null) pp.push("média de 7 dias <b>" + Math.round(m7.sis) + "/" + Math.round(m7.dia) + "</b>, meta " + meta[0] + "/" + meta[1]);
  if (pr) pp.push(pr.protocolo ? "protocolo: <b>" + (pr.protocolo.dias_feitos || 0) + " de " + (pr.protocolo.dias_meta || 0) + "</b> dias" : PROTOCOLO_PARADO);
  const aguardando = registrosPendentes().reduce((s, r) => s + lista(r.corpo.pressao).length, 0);
  if (aguardando) pp.push(aguardando + (aguardando === 1 ? " medida aguardando" : " medidas aguardando") + " o computador");
  h += '<div class="linha"><b>Pressão</b><span>' + (pp.length ? pp.join(" · ") : "ainda sem dados") + "</span></div>";
  return h + "</div>";
}

function campoReg(k, rotulo, unid, modo) {
  return '<div class="campo"><span>' + rotulo + (unid ? "<small>" + unid + "</small>" : "") + "</span>" +
    '<button class="icon" data-rpasso="-1" data-rk="' + k + '" aria-label="Menos: ' + rotulo + '">−</button>' +
    '<input type="text" inputmode="' + modo + '" autocomplete="off" enterkeyhint="done" maxlength="6" data-rk="' + k + '" value="' + esc(textoReg(k)) + '" placeholder="—" aria-label="' + rotulo + '">' +
    '<button class="icon" data-rpasso="1" data-rk="' + k + '" aria-label="Mais: ' + rotulo + '">+</button></div>';
}

function htmlRegistro() {
  const p = S.pac || {}, h = hojeLocal(), sd = p.saude || {};
  const hj = p.hoje === h ? sd.hoje : null;
  let html = '<h2>Registro de 30 segundos</h2><div class="card" id="reg">';
  if (hj) {
    const ja = [];
    if (hj.nota != null) ja.push("nota " + hj.nota);
    if (hj.vinho_tacas != null) ja.push("vinho " + fmtV(hj.vinho_tacas));
    if (hj.cigarros != null) ja.push("cigarros " + hj.cigarros);
    if (hj.pressao_n) ja.push(hj.pressao_n + (hj.pressao_n === 1 ? " medida de pressão" : " medidas de pressão"));
    if (hj.peso_kg != null) ja.push(fmtV(hj.peso_kg, 1) + " kg");
    html += '<div class="sub">No computador hoje: ' + (ja.length ? esc(ja.join(" · ")) : "nada registrado ainda") + ".</div>";
  } else {
    html += '<div class="sub">Ainda sem dados de hoje vindos do computador.</div>';
  }
  for (const r of registrosPendentes()) html += htmlPendente(r, (r.data !== h ? nomeDia(r.data, true) + ": " : "") + resumoRegistro(r.corpo));

  // Ontem: fecha o dia de ontem (vinho e cigarros). Ja informado: mostra o valor e so reenvia se ele corrigir.
  const sab = ontemSabido();
  html += '<div class="lbl">Ontem (' + fmtDM(sab.data) + ")</div>";
  if (ontemAberto()) {
    html += campoReg("ontemVinho", "Vinho", "taças · 0 = não bebi", "decimal") + campoReg("ontemCigarros", "Cigarros", "0 = não fumei", "numeric") +
      (sab.completo ? '<button class="btn small ghost" id="rOntemCancela">Deixar ontem como estava</button>' : "");
  } else {
    html += '<div class="linha" style="align-items:center;border-top:0;padding-top:0"><span>ontem: ' + fmtV(sab.vinho_tacas) + (sab.vinho_tacas === 1 ? " taça" : " taças") + ", " +
      sab.cigarros + (sab.cigarros === 1 ? " cigarro" : " cigarros") + (sab.pend ? ' <span class="sub">(' + estadoRegistro(sab.pend) + ")</span>" : "") +
      '</span><span class="sp"></span><button class="btn small ghost" id="rOntemCorrige">Corrigir</button></div>';
  }

  html += '<div class="lbl">Hoje</div><div class="sub" style="margin-bottom:6px">Nota do dia</div><div class="rir seis">' +
    [0, 1, 2, 3, 4, 5].map((v) => '<button class="' + (REG.nota === v ? "on" : "") + '" data-nota="' + v + '" aria-label="Nota ' + v + '">' + v + "</button>").join("") + "</div>";
  html += '<div class="sub" style="margin:10px 0 0">Pressão</div>';
  lista(REG.medidas).forEach((m, i) => {
    html += '<div class="linha" style="align-items:center"><b class="num">' + m.sis + "/" + m.dia + '</b><span class="sub">' + (m.fc ? "FC " + m.fc + " · " : "") + esc(m.hora) +
      '</span><span class="sp"></span><button class="btn small ghost" data-rtira="' + i + '">Tirar</button></div>';
  });
  const pa = (k, id, dica, rot) => '<input type="text" inputmode="numeric" autocomplete="off" enterkeyhint="next" maxlength="3" id="' + id + '" data-rk="' + k + '" value="' + esc(REG[k]) +
    '" placeholder="' + dica + '" aria-label="' + rot + '">';
  html += '<div class="pa">' + pa("sis", "rSis", "máx", "Pressão máxima (sistólica)") + "<em>/</em>" + pa("dia", "rDia", "mín", "Pressão mínima (diastólica)") + pa("fc", "rFc", "FC", "Frequência cardíaca") + "</div>" +
    '<button class="btn small ghost" style="width:100%" id="rMaisMedida">+ outra medida</button>';
  html += "<details" + (REG.peso || REG.cintura ? " open" : "") + "><summary>Peso e cintura (opcional)</summary>" +
    campoReg("peso", "Peso", "kg", "decimal") + campoReg("cintura", "Cintura", "cm", "decimal") + "</details>";
  // vinho e cigarros de HOJE: recolhido; fechado, nao vai nada (o dia de hoje fecha amanha, no bloco Ontem)
  html += '<details id="rBebi"' + (REG.bebiHoje ? " open" : "") + "><summary>Já bebi ou fumei hoje</summary>" +
    campoReg("vinho", "Vinho", "taças", "decimal") + campoReg("cigarros", "Cigarros", "", "numeric") + "</details>";
  html += '<input type="text" autocomplete="off" enterkeyhint="done" maxlength="200" data-rk="obs" value="' + esc(REG.obs) + '" placeholder="Observação (opcional)" aria-label="Observação" style="margin-top:8px">';
  return html + '<button class="btn main" style="width:100%;margin-top:12px" id="rEnviar">Enviar registro</button></div>';
}

/* Peso e cintura partem do ultimo valor conhecido; vinho e cigarros, do zero (DO_ZERO). */
function baseReg(k) {
  const pe = (S.pac && S.pac.saude && S.pac.saude.peso) || {};
  const serie = lista(pe.serie).slice().sort((a, b) => String(a.data).localeCompare(String(b.data)));
  if (k === "peso") return pe.ultimo_kg != null ? pe.ultimo_kg : (serie.filter((x) => x.peso_kg != null).pop() || {}).peso_kg;
  if (k === "cintura") return (serie.filter((x) => x.cintura_cm != null).pop() || {}).cintura_cm;
  return null;
}

function passoReg(k, dir, campo) {
  const atual = lerSolto(textoReg(k));
  let v;
  if (atual == null) {
    if (DO_ZERO[k]) v = dir > 0 ? 1 : 0;
    else {
      v = baseReg(k);
      if (v == null) { if (campo) campo.focus(); return; }   // sem valor anterior: digita
    }
  } else {
    v = Math.max(0, Math.round((atual + dir * PASSO_REG[k]) * 10) / 10);
  }
  REG[k] = String(v).replace(".", ",");
  if (campo) campo.value = REG[k];
  guardarRascunho();
}

function ligarRegistro() {
  const c = $("#reg");
  if (!c) return;
  const corrige = $("#rOntemCorrige");
  if (corrige) corrige.onclick = () => { REG.ontemCorrigir = true; guardarRascunho(); render(); };
  const cancela = $("#rOntemCancela");
  if (cancela) cancela.onclick = () => { REG.ontemCorrigir = false; REG.ontemVinho = REG.ontemCigarros = null; guardarRascunho(); render(); };
  const bebi = $("#rBebi");
  if (bebi) bebi.ontoggle = () => { REG.bebiHoje = !!bebi.open; guardarRascunho(); };
  c.querySelectorAll("[data-nota]").forEach((b) => {
    b.onclick = () => {
      const v = Number(b.dataset.nota);
      REG.nota = REG.nota === v ? null : v;   // segundo toque tira a nota
      c.querySelectorAll("[data-nota]").forEach((x) => x.classList.toggle("on", Number(x.dataset.nota) === REG.nota));
      guardarRascunho();
    };
  });
  const campos = Array.from(c.querySelectorAll("input[data-rk]"));
  campos.forEach((el, i) => {
    el.oninput = () => { REG[el.dataset.rk] = el.value; guardarRascunho(); };
    el.onfocus = () => { try { el.select(); } catch {} };
    el.onkeydown = (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      const prox = el.closest(".pa") ? campos[i + 1] : null;   // na pressao o Enter anda para o campo seguinte
      if (prox && prox.closest(".pa")) prox.focus(); else el.blur();
    };
  });
  c.querySelectorAll("[data-rpasso]").forEach((b) => {
    b.onclick = () => passoReg(b.dataset.rk, Number(b.dataset.rpasso), c.querySelector('input[data-rk="' + b.dataset.rk + '"]'));
  });
  c.querySelectorAll("[data-rtira]").forEach((b) => { b.onclick = () => { REG.medidas.splice(Number(b.dataset.rtira), 1); guardarRascunho(); render(); }; });
  const mais = $("#rMaisMedida");
  if (mais) mais.onclick = () => {
    let m;
    try { m = lerMedida(REG); } catch (e) { toast(e.message, 3500); return; }
    if (!m) { toast("Digite a medida; este botão guarda e abre espaço para a próxima.", 3500); const s = $("#rSis"); if (s) s.focus(); return; }
    REG.medidas.push(m);
    REG.sis = REG.dia = REG.fc = "";
    guardarRascunho();
    render();
    const s = $("#rSis"); if (s) s.focus();
  };
  $("#rEnviar").onclick = async () => {
    if (ligarRegistro.enviando) return;
    const m = montarRegistros(REG);
    if (m.erro) { toast(m.erro, 3500); return; }
    ligarRegistro.enviando = true;
    try {
      for (const corpo of m.corpos) await enviarRegistro(corpo);   // ontem primeiro, depois hoje: um item na fila para cada
      limparRascunho();
      toast("Registrado: " + m.corpos.map((x) => (x.data === hojeLocal() ? "hoje" : "ontem") + " " + resumoRegistro(x)).join("; "), 4000);
    } finally {
      ligarRegistro.enviando = false;
    }
    render();
  };
}

/* ------------------------------------------------------------------------- */
/* Aba Saude                                                                  */
/* ------------------------------------------------------------------------- */

function renderSaude() {
  const p = S.pac || {}, sd = p.saude || {};
  let html = htmlTopo("Saúde", esc(quandoRecebido()));
  html += avisosGerais();
  if (!p.saude) html += '<div class="aviso">O computador ainda não publicou o quadro de saúde. Os cartões ficam vazios até lá.</div>';
  html += cartaoPressao(sd.pressao) + cartaoSono(sd.sono, p) + cartaoVinho(sd.vinho, p) + cartaoCigarro(sd.cigarro) + cartaoPeso(sd.peso) +
    '<h2>Exames</h2><div class="card">Laudos no Drive, pasta pessoal/Saude.</div>';
  $("#tela").innerHTML = html;
  ligarTela();
  const b = $("#diaDBtn");
  if (b) b.onclick = definirDiaD;
}

function cartaoPressao(pr) {
  let h = '<h2>Pressão</h2><div class="card">';
  const pend = [];
  registrosPendentes().forEach((r) => lista(r.corpo.pressao).forEach((m) => pend.push([r, m])));
  if (!pr && !pend.length) return h + SEM_DADOS + "</div>";
  pr = pr || {};
  const meta = lista(pr.meta).length === 2 ? pr.meta : [130, 80];
  const m7 = pr.media_7d && pr.media_7d.sis != null ? pr.media_7d : null;
  h += '<div class="row"><b class="num" style="font-size:26px">' + (m7 ? Math.round(m7.sis) + "/" + Math.round(m7.dia) : "—") + '</b><span class="sp"></span>' +
    (m7 ? '<span class="badge ' + (m7.sis > meta[0] || m7.dia > meta[1] ? 'warn">acima da meta' : 'ok">dentro da meta') + "</span>" : "") + "</div>" +
    '<div class="sub">' + (m7 ? "Média de 7 dias" : "Média de 7 dias: ainda sem medidas suficientes") + " · meta " + meta[0] + "/" + meta[1] + ".</div>";
  h += '<div class="sub" style="margin-top:4px">' + (pr.protocolo ? "Protocolo: " + (pr.protocolo.dias_feitos || 0) + " de " + (pr.protocolo.dias_meta || 0) + " dias com medida."
    : PROTOCOLO_PARADO.charAt(0).toUpperCase() + PROTOCOLO_PARADO.slice(1) + ".") + "</div>";
  pend.forEach(([r, m]) => { h += htmlPendente(r, fmtDM(r.data) + " " + m.hora + " · " + m.sis + "/" + m.dia + (m.fc ? " · FC " + m.fc : "")); });
  const med = lista(pr.medidas).slice().sort((a, b) => (String(b.data) + String(b.hora || "")).localeCompare(String(a.data) + String(a.hora || "")));
  const linha = (m) => '<div class="linha num"><b>' + esc(m.sis) + "/" + esc(m.dia) + '</b><span class="sub">' + (m.fc != null ? "FC " + esc(m.fc) : "") +
    '</span><span class="sp"></span><span class="sub">' + fmtDM(m.data) + " " + esc(m.hora || "") + "</span></div>";
  if (!med.length) h += '<div class="sub" style="margin-top:8px">Nenhuma medida publicada ainda.</div>';
  h += '<div style="margin-top:8px">' + med.slice(0, 6).map(linha).join("") + "</div>";
  if (med.length > 6) h += "<details><summary>Ver as " + med.length + " últimas medidas</summary>" + med.slice(6).map(linha).join("") + "</details>";
  return h + "</div>";
}

function cartaoSono(so, p) {
  let h = '<h2>Sono</h2><div class="card">';
  const noites = lista(so && so.noites).filter((n) => n.data).sort((a, b) => String(a.data).localeCompare(String(b.data))).slice(-14);
  if (!noites.length) h += SEM_DADOS;
  else {
    const alvo = so.alvo_min || 0;
    const teto = Math.max(alvo, 1, ...noites.map((n) => n.duracao_min || 0));
    h += '<div class="row"><div><b class="num" style="font-size:26px">' + (so.media_min != null ? fmtMin(so.media_min) : "—") + '</b> <span class="sub">média de ' + noites.length +
      (noites.length === 1 ? " noite" : " noites") + (alvo ? " · alvo " + fmtMin(alvo) : "") + "</span></div></div>";
    h += '<div class="cols">' + (alvo ? '<u style="bottom:' + Math.round(100 * alvo / teto) + '%"></u>' : "") + noites.map((n) => {
      const d = n.duracao_min || 0;
      return '<div class="col"><span class="' + (d && d < 360 ? "curta" : "so") + '" style="height:' + (d ? Math.max(3, Math.round(100 * d / teto)) : 0) + '%" title="' + fmtDM(n.data) + " · " + fmtMin(d) + '"></span></div>';
    }).join("") + "</div>";
    h += '<div class="eixo">' + noites.map((n) => "<div>" + String(n.data).slice(8, 10) + "</div>").join("") + "</div>";
    h += '<div class="sub" style="margin:8px 0 4px">Uma coluna por noite' + (alvo ? "; a linha tracejada é o alvo" : "") + ". Em outra cor, as noites com menos de 6 h.</div>";
    h += '<div class="linha"><span>Noites com menos de 6 h</span><span class="sp"></span><b class="num">' + (so.abaixo_6h != null ? so.abaixo_6h : noites.filter((n) => n.duracao_min && n.duracao_min < 360).length) +
      " de " + noites.length + "</b></div>";
    h += '<div class="linha"><span>Variação da hora de deitar<br><span class="sub">referência: até 30 min' + (so.alvo_deitar ? " · alvo " + esc(so.alvo_deitar) : "") + '</span></span><span class="sp"></span><b class="num">' +
      (so.desvio_deitar_min != null ? Math.round(so.desvio_deitar_min) + " min" : "precisa de 5 noites") + "</b></div>";
    if (so.divida_semana_min != null) h += '<div class="linha"><span>Dívida de sono na semana</span><span class="sp"></span><b class="num">' + fmtMin(Math.max(0, so.divida_semana_min)) + "</b></div>";
  }
  if (p.noite && typeof htmlNoite === "function") h += "<details><summary>Sinais da última noite</summary>" + htmlNoite(p.noite) + "</details>";
  return h + "</div>";
}

function cartaoVinho(vi, p) {
  let h = '<h2>Noites de vinho</h2><div class="card">';
  const pend = new Set(registrosPendentes().filter((r) => r.corpo.vinho_tacas > 0).map((r) => r.data));
  if (!vi && !pend.size) return h + SEM_DADOS + "</div>";
  vi = vi || {};
  const ref = hojeLocal() > String(p.hoje || "") ? hojeLocal() : p.hoje;   // a ultima casa e hoje
  const datas = new Set(lista(vi.datas));
  h += '<div class="quad">';
  for (let c = 0; c < 7; c++) h += "<span>" + DIAS_SEM[new Date(dataMais(ref, c - 27) + "T12:00:00").getDay()].slice(0, 1) + "</span>";
  for (let i = 0; i < 28; i++) {
    const d = dataMais(ref, i - 27);
    h += '<i class="' + (datas.has(d) ? "on" : pend.has(d) ? "pend" : "") + '" title="' + fmtDM(d) + '"></i>';
  }
  h += "</div>";
  h += '<div class="sub">28 dias, de ' + fmtDM(dataMais(ref, -27)) + " até hoje. Cheio: noite com vinho" + (pend.size ? "; tracejado: aguardando o computador" : "") + ".</div>";
  h += '<div class="linha" style="border-top:0"><span>Em 28 dias</span><span class="sp"></span><b class="num">' + (vi.noites_28d != null ? vi.noites_28d : datas.size) +
    (vi.noites_28d === 1 ? " noite" : " noites") + " · " + fmtV(vi.tacas_28d) + " taças</b></div>";
  const e = vi.efeito;
  if (e && e.fc_min_delta != null && e.rmssd_delta_pct != null) {
    h += '<div class="linha"><span>Nas noites com vinho a FC mínima fica <b>' + comSinal(e.fc_min_delta) + " bpm</b> e a VFC <b>" + comSinal(e.rmssd_delta_pct) +
      '%</b>.<br><span class="sub">Medido em ' + (e.n_com || 0) + " noites com vinho contra " + (e.n_sem || 0) + " sem.</span></span></div>";
  } else {
    h += '<div class="linha"><span class="sub">Efeito no sono: ainda sem noites suficientes para medir.</span></div>';
  }
  return h + "</div>";
}

function cartaoCigarro(ci) {
  let h = '<h2>Cigarro</h2><div class="card">';
  const pend = registrosPendentes();
  const pendD = pend.filter((r) => r.corpo.cigarro_dia_d).pop();
  const hoje = hojeLocal();
  if (!ci) h += SEM_DADOS;
  ci = ci || {};
  if (ci.dia_d) {
    if (ci.dia_d > hoje) {
      const falta = Math.round((new Date(ci.dia_d + "T12:00:00") - new Date(hoje + "T12:00:00")) / 864e5);
      h += '<div><b class="num" style="font-size:26px">Dia D em ' + fmtDM(ci.dia_d) + '</b> <span class="sub">' + (falta === 1 ? "falta 1 dia" : "faltam " + falta + " dias") + "</span></div>";
    } else {
      h += '<div><b class="num" style="font-size:34px">' + (ci.dias_sem != null ? ci.dias_sem : "—") + '</b> <span class="sub">' + (ci.dias_sem === 1 ? "dia" : "dias") +
        " sem fumar · Dia D em " + fmtDM(ci.dia_d) + "</span></div>";
    }
  } else if (ci.total_28d != null) {
    h += '<div class="sub">Sem Dia D definido: a contagem de dias sem fumar começa quando houver um.</div>';
  }
  if (ci.total_28d != null) h += '<div class="linha"><span>Cigarros em 28 dias</span><span class="sp"></span><b class="num">' + ci.total_28d + "</b></div>";
  if (ci.ultimo) h += '<div class="linha"><span>Último registrado</span><span class="sp"></span><b class="num">' + fmtDM(ci.ultimo) + "</b></div>";
  pend.filter((r) => r.corpo.cigarros != null).forEach((r) => { h += htmlPendente(r, fmtDM(r.data) + " · " + r.corpo.cigarros + (r.corpo.cigarros === 1 ? " cigarro" : " cigarros")); });
  if (pendD) h += htmlPendente(pendD, "Dia D em " + fmtDM(pendD.corpo.cigarro_dia_d));
  const campo = '<input type="date" id="diaD" value="' + esc((pendD && pendD.corpo.cigarro_dia_d) || ci.dia_d || hoje) + '" aria-label="Dia D">' +
    '<button class="btn" style="width:100%;margin-top:8px" id="diaDBtn">' + (ci.dia_d || pendD ? "Mudar o Dia D" : "Definir o Dia D") + "</button>";
  if (ci.dia_d || pendD) h += "<details><summary>Mudar o Dia D</summary>" + campo + "</details>";
  else h += '<div class="lbl">Dia D: a data a partir da qual contar</div>' + campo;
  return h + "</div>";
}

/* O Dia D vai no registro do dia, sozinho: os outros campos seguem nulos (= nao mexe). */
async function definirDiaD() {
  const el = $("#diaD"), v = el ? el.value : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast("Escolha a data do Dia D."); return; }
  if (definirDiaD.enviando) return;
  definirDiaD.enviando = true;
  try {
    await enviarRegistro({ tipo: "registro", id: uid(), data: hojeLocal(), nota: null, observacao: null, vinho_tacas: null, cigarros: null,
      pressao: [], peso_kg: null, cintura_cm: null, gordura_pct: null, cigarro_dia_d: v });
    toast("Dia D em " + fmtDM(v) + ": enviado ao computador.", 3500);
  } finally {
    definirDiaD.enviando = false;
  }
  render();
}

/* Linha de tendencia sem julgamento de cor: so a forma da serie. */
function linhaSerie(v) {
  if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v), w = 300, hgt = 44;
  const pts = v.map((x, i) => (i * w / (v.length - 1)).toFixed(1) + "," + (3 + (hgt - 6) * (hi === lo ? 0.5 : 1 - (x - lo) / (hi - lo))).toFixed(1)).join(" ");
  return '<svg viewBox="0 0 ' + w + " " + hgt + '" preserveAspectRatio="none" style="width:100%;height:' + hgt + 'px;display:block;margin:6px 0"><polyline points="' + pts +
    '" fill="none" stroke="var(--info)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
}

function cartaoPeso(pe) {
  let h = '<h2>Peso e cintura</h2><div class="card">';
  const pend = registrosPendentes().filter((r) => r.corpo.peso_kg != null || r.corpo.cintura_cm != null);
  if (!pe && !pend.length) return h + SEM_DADOS + "</div>";
  pe = pe || {};
  const serie = lista(pe.serie).filter((x) => x.data).sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const pesos = serie.filter((x) => x.peso_kg != null), cinturas = serie.filter((x) => x.cintura_cm != null);
  const ultimo = pe.ultimo_kg != null ? pe.ultimo_kg : (pesos[pesos.length - 1] || {}).peso_kg;
  const n = pe.dias_sem_pesar;
  h += '<div><b class="num" style="font-size:26px">' + (ultimo != null ? fmtV(ultimo, 1) + " kg" : "—") + '</b> <span class="sub">' +
    (n == null ? "" : n === 0 ? "pesado hoje" : n === 1 ? "há 1 dia sem pesar" : "há " + n + " dias sem pesar") +
    (pe.meta_kg != null ? (n == null ? "" : " · ") + "meta " + fmtV(pe.meta_kg, 1) + " kg" : "") + "</span></div>";
  h += linhaSerie(pesos.map((x) => x.peso_kg));
  if (cinturas.length) {
    const c = cinturas[cinturas.length - 1];
    h += '<div class="linha"><span>Cintura</span><span class="sp"></span><b class="num">' + fmtV(c.cintura_cm, 1) + ' cm</b><span class="sub">' + fmtDM(c.data) + "</span></div>";
  }
  pend.forEach((r) => {
    h += htmlPendente(r, fmtDM(r.data) + (r.corpo.peso_kg != null ? " · " + fmtV(r.corpo.peso_kg, 1) + " kg" : "") + (r.corpo.cintura_cm != null ? " · cintura " + fmtV(r.corpo.cintura_cm, 1) + " cm" : ""));
  });
  if (!serie.length) h += '<div class="sub" style="margin-top:8px">Nenhuma pesagem publicada ainda.</div>';
  else {
    h += "<details><summary>Ver as últimas pesagens</summary>" + serie.slice(-8).reverse().map((x) =>
      '<div class="linha num"><b>' + (x.peso_kg != null ? fmtV(x.peso_kg, 1) + " kg" : "—") + '</b><span class="sub">' +
      [x.cintura_cm != null ? "cintura " + fmtV(x.cintura_cm, 1) + " cm" : "", x.gordura_pct != null ? "gordura " + fmtV(x.gordura_pct, 1) + "%" : ""].filter(Boolean).join(" · ") +
      '</span><span class="sp"></span><span class="sub">' + fmtDM(x.data) + "</span></div>").join("") + "</details>";
  }
  return h + "</div>";
}
