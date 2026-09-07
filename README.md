# ModelScope — versão autoatualizável

Esta versão separa a interface do snapshot de dados. O site lê `data/models.json`; uma GitHub Action executa `scripts/update_rankings.py` semanalmente e publica um novo snapshot quando encontra mudanças.

## Como usar

1. Crie um repositório no GitHub e envie **todo o conteúdo desta pasta**.
2. Em **Settings → Pages**, publique a branch `main` (raiz `/`).
3. Em **Settings → Actions → General → Workflow permissions**, permita **Read and write permissions**.
4. A Action `Atualizar rankings ModelScope` roda toda segunda-feira e também pode ser executada manualmente em **Actions → Run workflow**.

## Como funciona

- **Artificial Analysis** é a fonte técnica primária para inteligência, custo, velocidade, latência e contexto.
- **Arena** é usada como sinal de preferência humana/Elo quando o nome do modelo pode ser associado com confiança.
- **SWEN.AI** continua listado como referência editorial, mas o script não publica dados dela se a estrutura não puder ser confirmada com segurança.
- Se um site mudar o HTML ou ficar fora do ar, o script **não sobrescreve o último snapshot bom com dados vazios**.
- O frontend usa o JSON publicado e mostra um estado `AUTO`. Se aberto diretamente como arquivo (`file://`), alguns navegadores bloqueiam `fetch`; nesse caso ele usa o snapshot interno. Em GitHub Pages ou qualquer servidor HTTP, a atualização automática funciona normalmente.

## Importante

Um HTML estático não consegue reescrever o próprio arquivo no computador do visitante. A automação acontece no repositório/servidor: a rotina coleta os dados, atualiza o JSON e o site passa a exibir a nova versão sem edição manual do HTML.
