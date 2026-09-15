# Treino

Guia do dia no celular, ligado ao relógio Garmin pelo treino-ia (sistema pessoal).

- **Hoje**: prontidão, o que os sinais liberam, a noite (VFC do sono), a orientação da manhã e o treino do dia.
- **Alterar**: tempo, modalidade e tipo. O `gerador.js` remonta a sessão na hora, sem internet, a partir de modelos que o treino-ia publica com os alvos pessoais (FC de Karvonen, paces, CSS da natação).
- **Força**: player de musculação com carga, repetições, repetições de reserva e descanso cronometrado; a próxima carga sai do histórico (progressão dupla).

Dados: `treino.json` num repositório privado, lido com token do GitHub guardado só no aparelho (o mesmo do app Ciclo). O que é alterado aqui volta como issue; o computador aplica, grava no plano e manda ao relógio.

`?demo=1` lê `_local/treino.json` (fora do git) e não envia nada.
