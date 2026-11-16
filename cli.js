#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { generateImageDescription } from "./gptService.js";
import { createObjectCsvWriter } from "csv-writer";
import dotenv from "dotenv";
import cliProgress from "cli-progress";

dotenv.config();

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) {
      options.file = args[i + 1];
      i++;
    } else if (args[i] === "--url" && args[i + 1]) {
      options.url = args[i + 1];
      i++;
    } else if (args[i] === "--output" && args[i + 1]) {
      options.output = args[i + 1];
      i++;
    } else if (args[i] === "--resume") {
      options.resume = true;
    }
  }

  return options;
}

function isFatalApiError(err) {
  const status = err?.status;
  const code = err?.code;

  if (status === 401) return true; // chave de API inválida ou revogada
  if (status === 403) return true; // sem permissão para o modelo/recurso
  if (status === 429 && code === "insufficient_quota") return true; // créditos/orçamento esgotados

  return false;
}

function gerarNomeCSV() {
  const agora = new Date();
  const data = agora.toISOString().slice(0, 10);
  const hora = agora.toTimeString().slice(0, 5).replace(":", "h");
  return `output-${data}-${hora}.csv`;
}

// Parser simples de uma linha CSV (suporta campos entre aspas com "" como escape)
function parseCsvLine(line) {
  const fields = [];
  let i = 0;
  const n = line.length;

  while (i <= n) {
    let field = "";
    if (line[i] === '"') {
      i++;
      while (i < n) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          field += line[i];
          i++;
        }
      }
    } else {
      while (i < n && line[i] !== ",") {
        field += line[i];
        i++;
      }
    }
    fields.push(field);
    if (line[i] === ",") {
      i++;
    } else {
      break;
    }
  }

  return fields;
}

// Lê um CSV de saída já existente e retorna os registros já concluídos com
// sucesso (linhas "ERRO:" são descartadas para serem refeitas no resume)
function getSuccessfulRecords(outputPath) {
  const records = [];
  if (!fs.existsSync(outputPath)) return records;

  const lines = fs.readFileSync(outputPath, "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.length > 0);

  for (const line of lines.slice(1)) { // pula o cabeçalho
    const [url, description = ""] = parseCsvLine(line);
    if (url && !description.startsWith("ERRO:")) {
      records.push({ url, description });
    }
  }

  return records;
}

async function processTxtFileIncremental(filePath, outputPath, resume = false) {
  const allUrls = fs.readFileSync(filePath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const outputExists = fs.existsSync(outputPath);
  const resuming = resume && outputExists;

  const successfulRecords = resuming ? getSuccessfulRecords(outputPath) : [];
  const alreadyDone = new Set(successfulRecords.map((r) => r.url));
  const lines = allUrls.filter((url) => !alreadyDone.has(url));

  if (resume) {
    if (!outputExists) {
      console.log(`↪ --resume: ${outputPath} não existe ainda, processando tudo desde o início.`);
    } else if (alreadyDone.size > 0) {
      console.log(`↪ Retomando: ${alreadyDone.size} imagens já concluídas serão puladas. Restam ${lines.length}.`);
    } else {
      console.log(`↪ Retomando: nenhuma imagem concluída encontrada em ${outputPath}. Processando ${lines.length} imagens.`);
    }
  }

  const bar = new cliProgress.SingleBar(
    {
      format: "Progresso [{bar}] {percentage}% | {value}/{total} imagens | Última: {lastProcessed}",
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true
    },
    cliProgress.Presets.shades_classic
  );

  bar.start(lines.length, 0, { lastProcessed: 'Iniciando...' });

  // Criar o CSV writer para escrita incremental. No resume, o arquivo é
  // reescrito só com os registros de sucesso (descartando ERROs antigos que
  // serão refeitos), e as próximas escritas passam a ser em modo append.
  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: "url", title: "URL" },
      { id: "description", title: "Description" },
    ],
    append: false,
  });

  await csvWriter.writeRecords(successfulRecords);

  let processedCount = 0;
  let errorCount = 0;
  let abortedByFatalError = null;

  for (const url of lines) {
    try {
      const description = await generateImageDescription(url);

      // Escrever cada linha individualmente no CSV
      await csvWriter.writeRecords([{ url, description }]);

      processedCount++;
      const shortUrl = url.length > 40 ? url.substring(0, 40) + '...' : url;
      bar.increment(1, { lastProcessed: `✓ ${shortUrl}` });
    } catch (err) {
      const errorDescription = "ERRO: " + err.message;

      // Escrever o erro no CSV também
      await csvWriter.writeRecords([{ url, description: errorDescription }]);

      errorCount++;
      const shortUrl = url.length > 40 ? url.substring(0, 40) + '...' : url;
      bar.increment(1, { lastProcessed: `✗ ${shortUrl}` });

      if (isFatalApiError(err)) {
        abortedByFatalError = err;
        break;
      }
    }
  }

  bar.stop();

  if (abortedByFatalError) {
    const skipped = lines.length - processedCount - errorCount;
    console.error(`\n❌ Processamento interrompido: ${abortedByFatalError.message}`);
    console.log(`✓ Imagens processadas com sucesso: ${processedCount}`);
    console.log(`✗ Erros: ${errorCount}`);
    console.log(`⏭️  Imagens não processadas (puladas): ${skipped}`);
    console.log(`📁 Arquivo CSV salvo em: ${outputPath}`);
    process.exit(1);
  }

  console.log(`\nProcessamento concluído!`);
  console.log(`✓ Imagens processadas com sucesso: ${processedCount}`);
  console.log(`✗ Erros: ${errorCount}`);
  console.log(`📁 Arquivo CSV salvo em: ${outputPath}`);
}

// Função original mantida para compatibilidade
async function processTxtFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const bar = new cliProgress.SingleBar(
    { format: "Progresso [{bar}] {percentage}% | {value}/{total} imagens" },
    cliProgress.Presets.shades_classic
  );
  bar.start(lines.length, 0);

  const results = [];

  for (const url of lines) {
    try {
      const description = await generateImageDescription(url);
      results.push({ url, description });
    } catch (err) {
      results.push({ url, description: "ERRO: " + err.message });
    }
    bar.increment();
  }

  bar.stop();
  return results;
}

async function writeCsv(outputPath, data) {
  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: "url", title: "URL" },
      { id: "description", title: "Description" },
    ],
  });

  await csvWriter.writeRecords(data);
  console.log(`\nArquivo CSV salvo em: ${outputPath}`);
}

async function main() {
  const options = parseArgs();

  if (!options.file && !options.url) {
    console.error("Uso: describe --file arquivo.txt  OU  describe --url https://imagem.png");
    console.error("     describe --file arquivo.txt --output saida.csv --resume");
    process.exit(1);
  }

  if (options.file) {
    const inputPath = path.resolve(options.file);
    if (!fs.existsSync(inputPath)) {
      console.error(`Arquivo não encontrado: ${inputPath}`);
      process.exit(1);
    }

    if (options.resume && !options.output) {
      console.error("A opção --resume requer --output apontando para o CSV a continuar.");
      console.error("Ex: describe --file imagens.txt --output output.csv --resume");
      process.exit(1);
    }

    const outputFile = options.output || gerarNomeCSV();

    // Usar o novo método incremental por padrão
    await processTxtFileIncremental(inputPath, outputFile, options.resume);
  }

  if (options.url) {
    console.log(`Analisando imagem única: ${options.url}`);
    try {
      const description = await generateImageDescription(options.url);
      console.log("\nDescrição acessível:\n");
      console.log(description);
    } catch (err) {
      console.error("Erro ao gerar descrição:", err.message);
    }
  }
}

main();