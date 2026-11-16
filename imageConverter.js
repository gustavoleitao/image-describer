import fs from "fs";
import { createRequire } from "module";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

// A API de visão da OpenAI só aceita PNG, JPEG, WEBP e GIF não animado.
// SVG e GIF (que pode ser animado) são baixados e convertidos para PNG localmente
// com resvg em WASM — sem dependência nativa, funciona tanto com `node cli.js`
// quanto nos binários do pkg. Para GIF, o resvg usa o primeiro quadro.

const SVG_MIN_WIDTH = 1024; // SVGs costumam ter dimensões pequenas (ícones); amplia para legibilidade
const MAX_SIDE = 2048; // limite prático da API para o lado maior

// Fontes comuns do sistema: resvg-wasm não acessa fontes do SO sozinho,
// então carregamos algumas para que textos dentro do SVG sejam renderizados.
const SYSTEM_FONT_CANDIDATES = [
  // macOS
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
  "/System/Library/Fonts/Supplemental/Courier New.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
  // Linux
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  // Windows
  "C:\\Windows\\Fonts\\arial.ttf",
  "C:\\Windows\\Fonts\\arialbd.ttf",
  "C:\\Windows\\Fonts\\times.ttf",
  "C:\\Windows\\Fonts\\cour.ttf",
  "C:\\Windows\\Fonts\\segoeui.ttf",
];

let wasmReady = null;
let fontBuffers = null;

function getRequire() {
  // No bundle CommonJS (esbuild/pkg) `require` existe; em ESM criamos um.
  // eslint-disable-next-line no-undef
  return typeof require !== "undefined" ? require : createRequire(import.meta.url);
}

function ensureWasm() {
  if (!wasmReady) {
    const wasmPath = getRequire().resolve("@resvg/resvg-wasm/index_bg.wasm");
    wasmReady = initWasm(fs.readFileSync(wasmPath));
  }
  return wasmReady;
}

function loadFonts() {
  if (!fontBuffers) {
    fontBuffers = [];
    for (const file of SYSTEM_FONT_CANDIDATES) {
      try {
        fontBuffers.push(new Uint8Array(fs.readFileSync(file)));
      } catch {
        // fonte não disponível neste sistema
      }
    }
  }
  return fontBuffers;
}

/** Pela URL, indica se a imagem precisa de conversão: "svg", "gif" ou null. */
export function convertibleTypeFromUrl(url) {
  if (/^data:image\/svg\+xml/i.test(url)) return "svg";
  if (/^data:image\/gif/i.test(url)) return "gif";
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".svg")) return "svg";
    if (pathname.endsWith(".gif")) return "gif";
  } catch {
    // URL inválida: deixa a API reportar o erro
  }
  return null;
}

/** Pelo conteúdo baixado, identifica "svg", "gif" ou null. */
export function detectConvertibleType(contentType, buffer) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("image/svg+xml")) return "svg";
  if (ct.includes("image/gif")) return "gif";
  if (buffer.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  const head = buffer.subarray(0, 1024).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return null;
}

function decodeDataUrl(url) {
  const comma = url.indexOf(",");
  const meta = url.slice(5, comma); // depois de "data:"
  const data = url.slice(comma + 1);
  const buffer = meta.includes(";base64")
    ? Buffer.from(data, "base64")
    : Buffer.from(decodeURIComponent(data), "utf8");
  return { contentType: meta.split(";")[0], buffer };
}

/** Baixa o conteúdo da URL; retorna { contentType, buffer }. */
export async function fetchImage(url) {
  if (url.startsWith("data:")) return decodeDataUrl(url);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Falha ao baixar imagem (${res.status} ${res.statusText})`);
  }
  return {
    contentType: res.headers.get("content-type") || "",
    buffer: Buffer.from(await res.arrayBuffer()),
  };
}

function renderPng(svgText, targetWidth) {
  const resvg = new Resvg(svgText, {
    font: { fontBuffers: loadFonts(), defaultFontFamily: "Arial", loadSystemFonts: false },
    background: "white", // evita fundo transparente (texto preto sobre preto)
    fitTo: { mode: "width", value: Math.max(1, Math.round(targetWidth)) },
  });
  const png = resvg.render().asPng();
  resvg.free();
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

function capWidth(width, height, targetWidth) {
  const scale = targetWidth / width;
  if (Math.max(width, height) * scale > MAX_SIDE) {
    return Math.floor(width * (MAX_SIDE / Math.max(width, height)));
  }
  return targetWidth;
}

/** Rasteriza um SVG (string) e retorna uma data URL PNG pronta para a API. */
export async function svgToPngDataUrl(svgText) {
  await ensureWasm();
  // Primeira passada só para descobrir as dimensões intrínsecas.
  const probe = new Resvg(svgText, { font: { loadSystemFonts: false } });
  const { width, height } = probe;
  probe.free();
  return renderPng(svgText, capWidth(width, height, Math.max(width, SVG_MIN_WIDTH)));
}

/** Converte o primeiro quadro de um GIF (animado ou não) para data URL PNG. */
export async function gifToPngDataUrl(buffer) {
  if (buffer.length < 10 || buffer.subarray(0, 4).toString("latin1") !== "GIF8") {
    throw new Error("Arquivo GIF inválido");
  }
  await ensureWasm();
  // Dimensões do "logical screen" no cabeçalho GIF (little-endian).
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<image width="${width}" height="${height}" href="data:image/gif;base64,${buffer.toString("base64")}"/>` +
    `</svg>`;
  // Mantém o tamanho original (ampliar bitmap não adiciona informação), só limita o máximo.
  return renderPng(svg, capWidth(width, height, width));
}

/** Converte o conteúdo baixado para PNG conforme o tipo detectado. */
export function toPngDataUrl(type, buffer) {
  return type === "svg" ? svgToPngDataUrl(buffer.toString("utf8")) : gifToPngDataUrl(buffer);
}
