# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

CLI (`describe`) que usa a API da OpenAI (modelo `gpt-4o`) para gerar descrições acessíveis (alt text) de imagens, a partir de uma URL única ou de um arquivo `.txt` com uma lista de URLs, produzindo um CSV com os resultados.

## Comandos

```bash
yarn install                              # instalar dependências
yarn link                                 # registrar o comando `describe` globalmente
node cli.js --url https://.../img.png     # descrever uma única imagem
node cli.js --file imagens.txt            # processar um arquivo de URLs (gera output-YYYY-MM-DD-HHmm.csv)
node cli.js --file imagens.txt --output resultado.csv             # customizar nome do CSV de saída
node cli.js --file imagens.txt --output resultado.csv --resume    # retomar um processamento interrompido
yarn build                                # gera binários standalone (dist/) via esbuild + pkg
```

Não há testes nem linter configurados neste projeto.

Requer um arquivo `.env` na raiz com `OPENAI_API_KEY=sk-...` (ver `.env-sample`).

## Arquitetura

Fluxo simples de 3 módulos ES (`"type": "module"` no `package.json`):

- **`cli.js`** — entrypoint (`#!/usr/bin/env node`, mapeado como `bin.describe`). Faz parsing manual de argumentos (`--file`, `--url`, `--output`, `--resume`), lê o arquivo de URLs (uma por linha, ignorando linhas vazias ou iniciadas com `#`) e escreve o CSV. O processamento é **sequencial** (`for...of` com `await`), não paralelo — importante ao estimar tempo/custo de lotes grandes.
  - `processTxtFileIncremental` é o caminho usado por padrão: escreve cada linha do CSV incrementalmente conforme cada imagem é processada (via `csv-writer`), o que preserva progresso parcial se o processo for interrompido. Erros por imagem são capturados e gravados como `"ERRO: <mensagem>"` na própria linha do CSV.
  - `isFatalApiError(err)` classifica erros da OpenAI (401 chave inválida, 403 sem permissão, 429 com `code === "insufficient_quota"`) como **fatais**: ao encontrar um desses, o loop para imediatamente (`process.exit(1)`) em vez de continuar chamando a API para todas as imagens restantes — evita desperdiçar tempo/chamadas quando os créditos acabam ou a chave é inválida. Erros não-fatais (rate limit comum, conexão) são gravados como `ERRO:` e o processamento continua.
  - `--resume` (requer `--output` apontando para o CSV a continuar): lê o CSV existente via `parseCsvLine`/`getSuccessfulRecords`, pula URLs que já têm uma descrição bem-sucedida, e reprocessa as que estão ausentes ou marcadas `ERRO:`. Ao retomar, o CSV é reescrito só com os registros de sucesso antes de continuar (evita linhas duplicadas quando uma URL que falhou é refeita com êxito).
  - `processTxtFile` (não-incremental, acumula tudo em memória) é mantida só por compatibilidade e não é chamada pelo fluxo atual do `main()`.
- **`gptService.js`** — encapsula a chamada à OpenAI (`generateImageDescription(imageUrl)`), incluindo o prompt de acessibilidade usado para todas as descrições. O prompt exige formatação específica no texto retornado (prefixo "Descrição da imagem:", sufixo "Fim da descrição.", substituição de aspas curvas por `´´´´`, limite de 300 palavras, sem quebras de linha) — ao alterar esse prompt, manter essas regras de formatação, pois consumidores downstream (CSV/planilhas) dependem delas.
- **`imageConverter.js`** — a API de visão da OpenAI só aceita PNG/JPEG/WEBP/GIF não animado, então SVG e GIF são baixados e convertidos para PNG (data URL base64) com `@resvg/resvg-wasm` antes do envio (GIF: só o primeiro quadro, decodificado pelo resvg via `<image>` embutido num SVG; todo GIF é convertido, animado ou não, por simplicidade). `gptService.js` converte direto quando a URL termina em `.svg`/`.gif` (ou é `data:image/svg+xml`/`data:image/gif`); para outras URLs, se a API responder 400, baixa o conteúdo e, se for SVG/GIF (content-type, assinatura `GIF8` ou `<svg` no início), converte e tenta de novo. O resvg-wasm não lê fontes do SO sozinho: o módulo carrega uma lista de fontes comuns (macOS/Linux/Windows) para que textos do SVG sejam renderizados. Usa WASM (não `sharp`/`resvg-js` nativos) para continuar funcionando nos binários do `pkg`; o `.wasm` é incluído via `pkg.assets`.
- **`bootstrap.js`** — wrapper mínimo que importa `cli.js` dinamicamente; existe para uso como entrypoint alternativo (empacotamento via `pkg`), mas **não é mais o entrypoint usado no build** (ver seção Build abaixo).

## Build de binários standalone

`pkg` (usado para gerar os executáveis em `dist/`) não lida bem com ESM/`import()` dinâmico no runtime Node 18.5 que ele empacota — empacotar `cli.js` ou `bootstrap.js` diretamente falha (`ERR_REQUIRE_ESM` / `Invalid host defined options`). Por isso o `build` primeiro empacota `cli.js` + `gptService.js` num único arquivo CommonJS com `esbuild` (`build/cli.cjs`, gitignored) e só então roda o `pkg` sobre esse bundle:

```bash
yarn build         # roda build:bundle e depois pkg — gera dist/image-describer-{macos,linux,win.exe}
yarn build:bundle  # só o bundle esbuild (build/cli.cjs)
```

O campo `pkg.scripts` foi removido do `package.json` porque deixou de ser necessário (tudo já está em um único arquivo após o bundle).

## Dados e arquivos gerados

O `.gitignore` exclui `.env`, `node_modules`, `dist`, `data/`, `*.csv`, `*.zip`, `scripts`, `tmp`. Arquivos `imagens*.txt`, `arquivos/`, `data/`, e os `output-*.csv`/`resultado-*.csv` na raiz são artefatos de execução/dados de entrada específicos de lotes processados localmente — não fazem parte do código-fonte da ferramenta.
