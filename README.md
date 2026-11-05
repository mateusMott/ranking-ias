# ModelScope

Painel independente de benchmarks de IA, em português. Interface responsiva, temas claro e escuro, efeito opcional no cursor, busca, filtros, exportação CSV, fichas de modelos e comparação de até três modelos.

## Atualização automática

O workflow **Atualizar e publicar ModelScope** executa diariamente às **08:17 de Brasília (11:17 UTC)**, em alterações da branch `main` e por execução manual. O GitHub pode atrasar tarefas agendadas.

O processo testa o código, consulta Artificial Analysis e Arena, valida as métricas, atualiza `models.json` e o snapshot incorporado em `index.html`, salva ambos e publica os arquivos públicos no GitHub Pages. O workflow usa o `GITHUB_TOKEN` com permissões declaradas; não exige chave paga de API nem depende de um computador ligado.

**Endereço previsto do projeto:** https://mateusmott.github.io/ranking-ias/

A publicação configura Pages para GitHub Actions. O primeiro deploy pode depender das políticas da conta ou de regras de aprovação do ambiente `github-pages`. O resultado de cada execução está em [Actions](https://github.com/mateusMott/ranking-ias/actions).

Com a página aberta, a interface verifica `models.json` a cada cinco minutos e ao voltar à aba ou recuperar conexão. O navegador guarda a última cópia válida. Sem conexão, preserva os dados e mostra o estado real. Coletas com mais de 48 horas recebem aviso de desatualização, mesmo quando o arquivo é carregado com sucesso.

## Origem e significado dos dados

- **Artificial Analysis:** índice técnico, custo por tarefa em USD, tempo por tarefa em minutos, primeiro token de resposta em segundos e contexto em tokens.
- **Arena:** score de preferência humana e classificação de pesos apenas quando o nome e a variante coincidem exatamente. Não há associação por semelhança aproximada nem inferência de licença pela família.
- `1k` significa 1.000 tokens e `1M`, 1.000.000 tokens.
- Campos ausentes permanecem `null` e aparecem como “—”. Tempo por tarefa não é convertido em velocidade de geração. A velocidade em tokens/s aparece na ficha somente se a fonte publicar essa unidade.
- O ranking inicial usa o Intelligence Index. Não existe nota combinada própria ou recomendações fixas de modelos para código, imagem ou vídeo.
- SWEN.AI não alimenta a coleta automática. Não é exibida como fonte ativa.

A captura de tabelas públicas pode parar se as fontes mudarem de estrutura, bloquearem acesso ou saírem do ar. A validação interrompe atualizações da fonte principal quando a tabela é inválida ou a contagem cai mais de 35%; o último snapshot publicado permanece disponível com sua data original. Falhas da Arena não impedem a atualização das métricas técnicas e são indicadas na interface. Automação reduz trabalho rotineiro; mudanças das fontes podem exigir manutenção do coletor.

## Estrutura

```text
index.html                  Interface e fallback incorporado
assets/app.js               Filtros, comparação, cache, temas e cursor
assets/styles.css           Layout responsivo e acessibilidade
models.json                 Fonte de dados lida pela interface
update_rankings.py          Coleta, validação e associação exata
scripts/build_site.py       Pacote público, sem arquivos de desenvolvimento
tests/                      Regressões do coletor e comportamento do DOM
.github/workflows/main.yml  Coleta diária e publicação
```

## Desenvolvimento

Não há etapa de compilação da interface. Use um servidor HTTP local para testar `index.html` com os assets e `models.json`. Abrir diretamente como arquivo usa o snapshot incorporado; a cópia será tão recente quanto a versão baixada.

```sh
python -m pip install -r requirements.txt
npm ci --ignore-scripts
python -m unittest discover -s tests -p 'test_*.py' -v
npm run check
npm test
python update_rankings.py
python scripts/build_site.py
```

A pasta `_site/` contém apenas os arquivos publicados. `--source-dir /caminho` permite reproduzir a coleta com arquivos públicos `aa.html` e `arena.html` já baixados. Os testes de interface usam jsdom; não substituem revisão visual em um navegador real.

O cursor mantém o ponteiro nativo, não bloqueia cliques, pode ser desligado e respeita `prefers-reduced-motion` e telas de toque. Atalho `/` abre a busca; `Esc` fecha as janelas. Preferências de tema e cursor são guardadas somente no navegador.
