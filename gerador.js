/* Gerador de sessoes do Treino.
 *
 * Recebe um MODELO (vem pronto do treino-ia, em treino.json) e uma duracao, e
 * devolve a sessao encaixada: blocos, texto para o relogio, avisos. E conta,
 * nao julgamento — o julgamento ja veio escrito no modelo (quanto cada serie
 * pode crescer, qual bloco absorve o tempo que sobra). Roda no celular, sem
 * internet, em milissegundos.
 *
 * As regras de encaixe, na ordem em que um treinador faria:
 *  - aquecimento e volta a calma crescem devagar (raiz da escala) e tem piso e
 *    teto: uma sessao de 2 h nao pede 30 min de aquecimento;
 *  - series crescem na proporcao do tempo, mas param no teto do modelo — um
 *    tiro de VO2 a mais nao melhora a sessao; volume facil sim;
 *  - o tempo que sobra vai para os blocos continuos, pelo peso de cada um,
 *    respeitando o teto dos blocos fortes;
 *  - se ainda sobrar, entra o bloco `extra` (Z2) antes da volta a calma;
 *  - se faltar tempo: primeiro encurta aquecimento e calma ate o piso, depois
 *    tira repeticoes ate o minimo, depois encolhe os continuos, e so por
 *    ultimo derruba uma serie — com aviso.
 */
"use strict";
(function (raiz) {

  const PASSO = { min: 1, m: 50, km: 1 };
  const ORDEM = { zero: 0, baixa: 1, moderada: 2, alta: 3 };
  const NOME_MOD = { corrida: "Corrida", bike: "Bike", natacao: "Natação", forca: "Força", brick: "Brick", descanso: "Descanso" };

  const clamp = (v, a, b) => Math.max(a == null ? v : a, b == null ? v : Math.min(b, v));
  const arred = (v, unid) => { const p = PASSO[unid] || 1; return Math.round(v / p) * p; };
  const copia = (o) => JSON.parse(JSON.stringify(o));

  function custo(b) {
    // conta a pausa de todas as repeticoes, como o relogio executa e como o plano e escrito
    if (b.tipo === "serie") return (b.n || 0) * (b.trab * b.s_unid + (b.pausa_s || 0));
    if (b.tipo === "nota") return 0;
    return (b.v || 0) * b.s_unid;
  }
  const total = (bl) => bl.reduce((s, b) => s + custo(b), 0);

  /* Distribui `seg` segundos entre os continuos pelo peso, com teto. Devolve o que sobrou. */
  function encher(conts, seg) {
    conts.forEach((c) => { c.v = c.min || 0; });
    let resto = seg - conts.reduce((s, c) => s + c.v * c.s_unid, 0);
    let ativos = conts.slice();
    for (let volta = 0; volta < 12 && resto > 1 && ativos.length; volta++) {
      const pesoTotal = ativos.reduce((s, c) => s + (c.peso > 0 ? c.peso : 1), 0);
      const presos = ativos.filter((c) => c.max != null && c.v + (resto * (c.peso > 0 ? c.peso : 1) / pesoTotal) / c.s_unid >= c.max);
      if (!presos.length) {
        ativos.forEach((c) => { c.v += (resto * (c.peso > 0 ? c.peso : 1) / pesoTotal) / c.s_unid; });
        resto = 0;
        break;
      }
      presos.forEach((c) => { resto -= (c.max - c.v) * c.s_unid; c.v = c.max; });
      ativos = ativos.filter((c) => !presos.includes(c));
    }
    return Math.max(0, resto);
  }

  function encaixar(modelo, minutos) {
    const T = minutos * 60;
    const escala = minutos / (modelo.padrao || minutos);
    const bl = copia(modelo.blocos || []);
    const avisos = [];

    for (const b of bl) {
      if (b.tipo === "serie") {
        // encurtar nao corta repeticao de cara: primeiro sai aquecimento e calma
        b.n = escala >= 1 ? clamp(Math.round(b.n * escala), b.n_min, b.n_max) : Math.min(b.n, b.n_max);
        b.n0 = b.n;
      } else if (b.tipo === "aquec" || b.tipo === "calma") {
        b.v = b.v0 = arred(clamp(b.base * Math.sqrt(escala), b.min, b.max), b.unid);
      } else b.v = 0;
    }
    const conts = bl.filter((b) => b.tipo === "continuo");
    const bordas = bl.filter((b) => b.tipo === "aquec" || b.tipo === "calma");
    const series = bl.filter((b) => b.tipo === "serie");
    const minConts = () => conts.reduce((s, c) => s + (c.min || 0) * c.s_unid, 0);
    const sobra = () => T - total(bordas) - total(series) - minConts();
    const passo = (b) => PASSO[b.unid] || 1;
    const piso = (b) => b.unid === "min" ? Math.max(3, Math.round(b.min / 2)) : Math.max(100, arred(b.min / 2, b.unid));

    // --- falta tempo --------------------------------------------------------
    for (let guarda = 0; sobra() < 0 && guarda < 600; guarda++) {
      const encolhivel = bordas.filter((b) => b.v - passo(b) >= b.min).sort((a, b) => custo(b) - custo(a))[0];
      if (encolhivel) { encolhivel.v -= passo(encolhivel); continue; }
      const tiravel = series.filter((s) => s.n > s.n_min).sort((a, b) => (b.n - b.n_min) - (a.n - a.n_min) || custo(b) - custo(a))[0];
      if (tiravel) { tiravel.n -= 1; continue; }
      const cont = conts.filter((c) => (c.min || 0) >= passo(c)).sort((a, b) => b.min * b.s_unid - a.min * a.s_unid)[0];
      if (cont) { cont.min = Math.max(0, cont.min - passo(cont)); continue; }
      const aperto = bordas.filter((b) => b.v - passo(b) >= piso(b)).sort((a, b) => custo(b) - custo(a))[0];
      if (aperto) { aperto.v -= passo(aperto); continue; }
      // ultimo recurso: a serie mais longa perde repeticoes abaixo do minimo
      const ultima = series.filter((s) => s.n > 0).sort((a, b) => custo(b) - custo(a))[0];
      if (ultima) {
        ultima.n -= 1;
        if (ultima.n < ultima.n_min && !ultima._avisada) {
          ultima._avisada = true;
          avisos.push({ tipo: "tempo", texto: "Tempo curto para esta sessão: a série principal ficou abaixo do mínimo que dá efeito." });
        }
        continue;
      }
      const borda = bordas.filter((b) => b.v > 0)[0];
      if (borda) { borda.v = Math.max(0, borda.v - passo(borda)); continue; }
      break;
    }

    // --- sobra tempo --------------------------------------------------------
    let livre = T - total(bordas) - total(series) - minConts();
    // 1. devolve repeticoes tiradas no aperto, se couberem inteiras
    for (let g = 0; g < 50; g++) {
      const s = series.find((x) => x.n < x.n0 && x.trab * x.s_unid + (x.pausa_s || 0) <= livre);
      if (!s) break;
      livre -= s.trab * s.s_unid + (s.pausa_s || 0);
      s.n += 1;
    }
    // 2. aquecimento e calma voltam em direcao ao tamanho natural, na proporcao do que perderam
    const falta = bordas.map((b) => Math.max(0, b.v0 - b.v) * b.s_unid);
    const faltaTotal = falta.reduce((s, x) => s + x, 0);
    if (faltaTotal > 0 && livre >= 60) {
      const dar = Math.min(livre, faltaTotal);
      bordas.forEach((b, i) => {
        const add = Math.floor((dar * falta[i] / faltaTotal) / (b.s_unid * passo(b))) * passo(b);
        b.v += add; livre -= add * b.s_unid;
      });
    }
    // 3. continuos pelo peso; 4. o que ainda sobrar vira o bloco extra
    let resto = encher(conts, T - total(bordas) - total(series));
    if (resto >= 300 && !modelo.extra) {
      for (const b of bordas) {
        const cabe = Math.floor(Math.min(resto, (b.max - b.v) * b.s_unid) / (b.s_unid * passo(b))) * passo(b);
        if (cabe > 0) { b.v += cabe; resto -= cabe * b.s_unid; }
      }
    }
    if (resto >= 300 && modelo.extra) {
      const ex = copia(modelo.extra);
      ex.v = arred(resto / ex.s_unid, ex.unid);
      if (ex.v > 0) {
        const iCalma = bl.findIndex((b) => b.tipo === "calma");
        if (iCalma >= 0) bl.splice(iCalma, 0, ex); else bl.push(ex);
        resto -= ex.v * ex.s_unid;
      }
    } else if (resto >= 300 && conts.length) {
      conts[conts.length - 1].v += resto / conts[conts.length - 1].s_unid;
      resto = 0;
    }

    // --- arredonda e corrige o erro de arredondamento no maior continuo -----
    for (const b of bl) if (b.tipo !== "serie" && b.v != null) b.v = arred(b.v, b.unid);
    const livres = conts.filter((c) => c.max == null || c.v < c.max).sort((a, b) => custo(b) - custo(a));
    if (livres.length) {
      const c = livres[0];
      const dif = arred((T - total(bl)) / c.s_unid, c.unid);
      if (dif && c.v + dif >= (PASSO[c.unid] || 1)) c.v += dif;
    }
    const final = bl.filter((b) => b.tipo === "nota" || (b.tipo === "serie" ? b.n > 0 : b.v > 0));
    return { blocos: final, segundos: total(final), avisos };
  }

  function fmtV(v, unid) { return unid === "km" ? String(Math.round(v * 10) / 10).replace(".", ",") : String(Math.round(v)); }

  function textoBloco(b) {
    let t = b.texto;
    if (t.includes("{v}")) t = t.replace("{v}", fmtV(b.v, b.unid));
    if (t.includes("{n}")) t = t.replace("{n}", String(b.n));
    return t.trim();
  }

  function metros(bl) {
    return bl.reduce((s, b) => s + (b.unid === "m" ? (b.tipo === "serie" ? b.n * b.trab : b.v) : 0), 0);
  }

  /* Uma sessao completa a partir de um modelo de endurance ou brick. */
  function gerarEndurance(modelo, minutos) {
    if (modelo.partes) {
      const trans = modelo.transicao || 0;
      const util = Math.max(10, minutos - trans * (modelo.partes.length - 1));
      const partes = modelo.partes.map((p) => {
        const alvo = Math.max(10, Math.round(util * p.pct));
        const r = encaixar(Object.assign({}, p, { padrao: p.padrao || Math.round((modelo.padrao || minutos) * p.pct) }), alvo);
        return { rotulo: p.rotulo, modalidade: p.modalidade, ...r };
      });
      const txt = partes.map((p) => p.rotulo + " " + p.blocos.map(textoBloco).join("; ")
        + (p.modalidade === "natacao" ? "; total ~" + metros(p.blocos) + "m" : ""));
      const estrutura = txt.join(trans ? "; troca em ate " + trans + " min; " : "; ");
      const seg = partes.reduce((s, p) => s + p.segundos, 0) + trans * 60 * (partes.length - 1);
      return {
        estrutura, segundos: seg,
        blocos: partes.flatMap((p) => [{ texto: p.rotulo, intens: 0, titulo: true }]
          .concat(p.blocos.map((b) => ({ texto: textoBloco(b), intens: b.intens, seg: custo(b) })))),
        avisos: partes.flatMap((p) => p.avisos),
        principal: partes.map((p) => principalDe(p.blocos)).filter(Boolean).join(" / "),
      };
    }
    const r = encaixar(modelo, minutos);
    let estrutura = r.blocos.map(textoBloco).join("; ");
    if (modelo.modalidade === "natacao") estrutura += "; total ~" + metros(r.blocos) + "m";
    return {
      estrutura, segundos: r.segundos, avisos: r.avisos,
      blocos: r.blocos.map((b) => ({ texto: textoBloco(b), intens: b.intens, seg: custo(b) })),
      principal: principalDe(r.blocos),
    };
  }

  function principalDe(bl) {
    const cand = bl.filter((b) => b.tipo === "serie" || b.tipo === "continuo")
      .sort((a, b) => (b.intens * 1e6 + custo(b)) - (a.intens * 1e6 + custo(a)))[0];
    return cand ? textoBloco(cand) : "";
  }

  /* ------------------------------------------------------------------------ */
  /* Forca                                                                     */
  /* ------------------------------------------------------------------------ */

  function e1rm(kg, reps, rir) { return kg * (1 + ((reps || 0) + (rir == null ? 2 : rir)) / 30); }

  function arredCarga(kg, inc) {
    const p = inc && inc > 0 ? inc : 1;
    return Math.max(0, Math.round(kg / p) * p);
  }

  /* hist: [{data, alvo:{reps_min,reps_max,rir}, series:[[kg,reps,rir],...]}], mais recente primeiro */
  function sugerirCarga(ex, hist, cat) {
    const inc = (cat && cat.inc) || 2;
    if (cat && cat.corporal && !(hist || []).some((h) => h.series.some((s) => s[0] > 0))) {
      return { kg: 0, motivo: cat.medida === "s" ? "Peso do corpo: segure o tempo com a postura perfeita." : "Peso do corpo." };
    }
    const validas = (hist || []).filter((h) => h.series && h.series.some((s) => s[0] != null));
    if (!validas.length) {
      return { kg: null, motivo: "Primeira vez: escolha uma carga que deixe ~" + ex.rir + " repetições sobrando na última série." };
    }
    const ult = validas[0];
    const topo = Math.max(...ult.series.map((s) => s[0] || 0));
    const melhor = Math.max(...ult.series.map((s) => e1rm(s[0] || 0, s[1], s[2])));
    if (ex.carga === "percentual") {
      const kg = arredCarga(topo * (ex.percentual || 60) / 100, inc);
      return { kg, motivo: (ex.percentual || 60) + "% da última carga (" + topo + " kg): ativação, sem fadiga." };
    }
    if (ult.series.every((s) => s[3])) {
      return { kg: topo, motivo: "Última vez registrada no automático sem dizer como foi: repete " + topo + " kg." };
    }
    if (ex.carga === "manter") return { kg: topo, motivo: "Mesma carga da última vez (" + ult.data.slice(8, 10) + "/" + ult.data.slice(5, 7) + "): o plano pede para não subir." };
    const aPrev = ult.alvo || {};
    if (aPrev.reps_max && Math.abs(aPrev.reps_max - ex.reps_max) >= 2) {
      const kg = arredCarga(melhor / (1 + (ex.reps_max + ex.rir) / 30), inc);
      return { kg, motivo: "Faixa de repetições mudou: carga convertida do seu 1RM estimado (" + Math.round(melhor) + " kg)." };
    }
    const alvoMax = aPrev.reps_max || ex.reps_max, alvoMin = aPrev.reps_min || ex.reps_min;
    const rirAlvo = aPrev.rir != null ? aPrev.rir : ex.rir;
    const deTopo = ult.series.filter((s) => (s[0] || 0) >= topo);
    const bateu = deTopo.length >= Math.min(2, ult.series.length) && deTopo.every((s) => s[1] >= alvoMax && (s[2] == null || s[2] >= rirAlvo));
    const abaixo = ult.series.filter((s) => s[1] < alvoMin).length;
    if (bateu && ex.progredir !== false) {
      return { kg: topo + inc, motivo: "Todas as séries no topo da faixa (" + alvoMax + ") sobrando " + rirAlvo + ": sobe " + inc + " kg." };
    }
    if (abaixo >= 2) {
      const ant = validas[1];
      const antAbaixo = ant && Math.max(...ant.series.map((s) => s[0] || 0)) >= topo && ant.series.filter((s) => s[1] < alvoMin).length >= 2;
      if (antAbaixo) return { kg: arredCarga(topo * 0.9, inc), motivo: "Duas sessões abaixo da faixa com " + topo + " kg: desce 10% e reconstrói." };
      return { kg: topo, motivo: "Última vez ficou abaixo de " + alvoMin + " repetições: repete " + topo + " kg." };
    }
    return { kg: topo, motivo: "Repete " + topo + " kg e busca " + alvoMax + " repetições em todas as séries antes de subir." };
  }

  function segTrabalho(cat, ex) { return cat.medida === "s" ? (ex.alvo_s || 40) : Math.max(25, ex.reps_max * 4); }

  function custoEx(ex, cat) {
    return ex.series * (segTrabalho(cat, ex) + ex.descanso_s) - ex.descanso_s + 90;
  }

  /* ctx: {catalogo, historico, prescricao} */
  function gerarForca(modelo, minutos, ctx) {
    const cat = ctx.catalogo || {};
    const avisos = [];
    const nivel = (ctx.prescricao && ctx.prescricao.intensidade_max) || "alta";
    let series = modelo.series || 3;
    let carga = modelo.carga || "progredir";
    if (ORDEM[nivel] <= ORDEM.baixa && series > 2) {
      series -= 1;
      if (carga === "progredir") carga = "manter";
      avisos.push({ tipo: "prescricao", texto: "Sinais de hoje (" + ((ctx.prescricao || {}).resumo || "intensidade baixa") + "): uma série a menos e sem subir carga." });
    }
    const aquec = minutos >= 30 ? 5 : 3;
    const disp = (minutos - aquec) * 60;
    const novoEx = (k) => {
      const c = cat[k];
      const composto = c.tipo === "composto";
      return {
        chave: k, nome: c.nome, medida: c.medida,
        series: c.tipo === "core" ? Math.min(series, 3) : series,
        reps_min: c.medida === "s" ? null : (c.tipo === "core" ? Math.max(modelo.reps_min, 10) : modelo.reps_min),
        reps_max: c.medida === "s" ? null : (c.tipo === "core" ? Math.max(modelo.reps_max, 12) : modelo.reps_max),
        alvo_s: c.medida === "s" ? 40 : null,
        rir: modelo.rir == null ? 2 : modelo.rir,
        descanso_s: (ctx.descansos && ctx.descansos[k]) || (modelo.descanso_s && composto ? modelo.descanso_s : c.descanso_s),
        carga, percentual: modelo.percentual,
      };
    };
    let lista = (modelo.exercicios || []).filter((k) => cat[k]).map(novoEx);
    const soma = () => lista.reduce((s, e) => s + custoEx(e, cat[e.chave]), 0);

    // encolher: acessorio perde serie, depois composto, depois sai o ultimo
    for (let g = 0; soma() > disp && g < 100; g++) {
      const acess = lista.slice().reverse().find((e) => cat[e.chave].tipo !== "composto" && e.series > 2);
      if (acess) { acess.series--; continue; }
      const comp = lista.slice().reverse().find((e) => e.series > 2);
      if (comp) { comp.series--; continue; }
      if (lista.length > 2) { lista.pop(); continue; }
      const um = lista.slice().reverse().find((e) => e.series > 1);
      if (um) { um.series--; continue; }
      break;
    }
    // crescer: +1 serie nos compostos, depois exercicios do mesmo foco
    const teto = Math.min(5, series + 1);
    for (let g = 0; g < 40; g++) {
      const folga = disp - soma();
      const comp = lista.find((e) => cat[e.chave].tipo === "composto" && e.series < teto && custoEx(Object.assign({}, e, { series: e.series + 1 }), cat[e.chave]) - custoEx(e, cat[e.chave]) <= folga);
      if (comp) { comp.series++; continue; }
      const usados = new Set(lista.map((e) => e.chave));
      const foco = modelo.foco || "corpo";
      const candidato = Object.keys(cat).find((k) => !usados.has(k) && cat[k].garmin !== undefined &&
        (foco === "corpo" ? cat[k].tipo === "composto" : foco === "core" ? (cat[k].grupo === "core" || cat[k].tipo === "acessorio") : cat[k].grupo === foco) &&
        !cat[k].corporal);
      if (candidato && lista.length < 9) {
        const e = novoEx(candidato);
        if (custoEx(e, cat[candidato]) <= folga) { lista.push(e); continue; }
      }
      break;
    }
    if (soma() > disp) avisos.push({ tipo: "tempo", texto: "Tempo curto: mesmo com o mínimo, a sessão passa um pouco de " + minutos + " min." });

    const hist = ctx.historico || {};
    for (const e of lista) {
      const s = sugerirCarga(e, hist[e.chave], cat[e.chave]);
      e.kg = s.kg; e.motivo = s.motivo;
    }
    const seg = aquec * 60 + soma();
    const faixa = (e) => e.medida === "s" ? e.series + "x" + e.alvo_s + " s" : e.series + "x" + (e.reps_min === e.reps_max ? e.reps_min : e.reps_min + "-" + e.reps_max);
    const estrutura = lista.map((e) => e.nome + " " + faixa(e) + (e.kg ? " (" + String(e.kg).replace(".", ",") + " kg)" : "")).join("; ")
      + ". Parar " + (modelo.rir == null ? 2 : modelo.rir) + " repeticoes antes da falha.";
    return {
      estrutura, segundos: seg, avisos,
      principal: faixa(lista[0] || { series: 0, reps_min: 0, reps_max: 0 }) + ", sobrando " + (modelo.rir == null ? 2 : modelo.rir),
      forca: { aquecimento_min: aquec, rir: modelo.rir == null ? 2 : modelo.rir, carga, exercicios: lista },
      blocos: [{ texto: aquec + " min de aquecimento articular e 1 série leve do primeiro exercício", intens: 1, seg: aquec * 60 }]
        .concat(lista.map((e) => ({ texto: e.nome + " " + faixa(e) + (e.kg ? " · " + e.kg + " kg" : ""), intens: cat[e.chave].tipo === "composto" ? 3 : 2, seg: custoEx(e, cat[e.chave]) }))),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Entrada unica                                                             */
  /* ------------------------------------------------------------------------ */

  function gerar(modelo, minutos, ctx) {
    ctx = ctx || {};
    minutos = Math.max(10, Math.round(minutos));
    const r = modelo.modalidade === "forca" ? gerarForca(modelo, minutos, ctx) : gerarEndurance(modelo, minutos);
    const presc = ctx.prescricao;
    if (presc && ORDEM[modelo.nivel || "baixa"] > ORDEM[presc.intensidade_max || "alta"]) {
      r.avisos.unshift({
        tipo: "veto", texto: presc.intensidade_max === "zero"
          ? "Os sinais de hoje pedem descanso: " + presc.resumo
          : "Os sinais de hoje liberam no máximo intensidade " + presc.intensidade_max + ". " + presc.resumo,
      });
    }
    if (modelo.max && minutos > modelo.max) r.avisos.push({ tipo: "duracao", texto: "Acima do que esse treino costuma ter (" + modelo.max + " min): o tempo extra virou volume fácil." });
    if (modelo.min && minutos < modelo.min && modelo.modalidade !== "forca") r.avisos.push({ tipo: "duracao", texto: "Abaixo do mínimo útil desse treino (" + modelo.min + " min)." });
    const titulo = modelo.grupo === "plano" ? modelo.nome.replace(/^Do plano: /, "")
      : (modelo.modalidade === "brick" ? modelo.nome : NOME_MOD[modelo.modalidade] + " — " + modelo.nome);
    return {
      modalidade: modelo.modalidade,
      titulo,
      duracao_min: Math.round(r.segundos / 60),
      intensidade: r.principal || modelo.nome,
      estrutura: r.estrutura,
      proposito: modelo.proposito || "",
      detalhe: {
        modelo_id: modelo.id, modelo_nome: modelo.nome, nivel: modelo.nivel, minutos_pedidos: minutos,
        blocos: r.blocos, avisos: r.avisos, forca: r.forca || null,
      },
    };
  }

  const api = { gerar, encaixar, sugerirCarga, e1rm, arredCarga, textoBloco, ORDEM, NOME_MOD };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.GERADOR = api;
})(typeof self !== "undefined" ? self : this);
