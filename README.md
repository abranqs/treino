# Treino

A tela do dia no celular, ligada ao relógio (Amazfit T-Rex 3 Pro, app Zepp) pelo treino-ia (sistema pessoal).

- **Hoje**: prontidão, o treino do dia, a orientação do treinador, sono, pressão e o registro de 30 segundos (nota, vinho, cigarros, pressão, peso).
- **Semana**: feito × planejado por dia, por modalidade e a lista de sessões.
- **Saúde**: pressão, sono, noites de vinho, cigarro, peso e cintura, exames.
- **Alterar**: tempo, modalidade e tipo. O `gerador.js` remonta a sessão na hora, sem internet, a partir de modelos que o treino-ia publica com os alvos pessoais (FC por zonas de limiar, paces, CSS da natação).
- **Força**: player de musculação com carga, repetições, repetições de reserva e descanso cronometrado; a próxima carga sai do histórico (progressão dupla).

Dados: `treino.json` num repositório privado, lido com token do GitHub guardado só no aparelho (o mesmo do app Ciclo). O que é alterado aqui volta como issue; o computador aplica, grava no plano e manda ao relógio.

`?demo=1` lê `_local/treino.json` (fora do git) e não envia nada.
