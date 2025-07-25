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
    }
  }

  return options;
}

function gerarNomeCSV() {
  const agora = new Date();
  const data = agora.toISOString().slice(0, 10);
  const hora = agora.toTimeString().slice(0, 5).replace(":", "h");
  return `output-${data}-${hora}.csv`;
}

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
    process.exit(1);
  }

  if (options.file) {
    const inputPath = path.resolve(options.file);
    if (!fs.existsSync(inputPath)) {
      console.error(`Arquivo não encontrado: ${inputPath}`);
      process.exit(1);
    }

    const data = await processTxtFile(inputPath);
    const outputFile = options.output || gerarNomeCSV();
    await writeCsv(outputFile, data);
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