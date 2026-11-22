import { createWorker } from "tesseract.js";
import { parseEuroToCents } from "../../../../packages/domain/src/money.js";

export type InvoiceOcrPage = { page: number; text: string; confidence: number | null; source: "native_pdf_text" | "local_ocr" };
export type InvoiceOcrLine = {
  description: string;
  lineTotalCents: number;
  sourcePage: number;
  confidence: number | null;
  source: "native_pdf_text" | "local_ocr";
};
export type InvoiceOcrResult = {
  engine: "pdfjs+tesseract.js";
  engineVersion: string;
  pages: InvoiceOcrPage[];
  recognizedText: string;
  lines: InvoiceOcrLine[];
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalCents: number | null;
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 20;
const MAX_PAGE_PIXELS = 16_000_000;

export async function extractInvoiceLocally(file: File, onProgress: (message: string) => void): Promise<InvoiceOcrResult> {
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error("Le fichier doit faire entre 1 octet et 25 Mio.");
  if (file.type !== "application/pdf" && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Formats pris en charge : PDF, JPEG, PNG et WebP.");
  }

  const pages = file.type === "application/pdf"
    ? await recognizePdf(file, onProgress)
    : [await recognizeImage(file, onProgress)];
  const recognizedText = pages.map((page) => `--- PAGE ${page.page} ---\n${page.text}`).join("\n\n");
  const lines = pages.flatMap((page) => extractLineItems(page));
  const candidates = extractInvoiceFields(pages);
  return {
    engine: "pdfjs+tesseract.js",
    engineVersion: "pdfjs-dist 6.5.438; tesseract.js 7.0.0",
    pages,
    recognizedText,
    lines,
    ...candidates,
  };
}

function createInvoiceOcrWorker(onProgress: (message: string) => void) {
  return createWorker("fra", 1, {
    workerPath: `${window.location.origin}/ocr/worker.min.js`,
    corePath: `${window.location.origin}/ocr/core`,
    langPath: `${window.location.origin}/ocr/lang`,
    gzip: true,
    cacheMethod: "write",
    logger: (message: { status: string; progress: number }) => onProgress(progressLabel(message)),
  });
}

async function recognizeImage(file: File, onProgress: (message: string) => void) {
  const worker = await createInvoiceOcrWorker(onProgress);
  try {
    onProgress("Lecture OCR locale de l’image…");
    const result = await worker.recognize(file);
    return { page: 1, text: result.data.text, confidence: result.data.confidence / 100, source: "local_ocr" as const };
  } finally {
    await worker.terminate();
  }
}

async function recognizePdf(file: File, onProgress: (message: string) => void) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/ocr/pdf.worker.min.mjs`;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${window.location.origin}/ocr/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${window.location.origin}/ocr/standard_fonts/`,
  });
  const pdf = await loadingTask.promise;
  if (pdf.numPages > MAX_PDF_PAGES) {
    await loadingTask.destroy();
    throw new Error(`Le PDF dépasse la limite de ${MAX_PDF_PAGES} pages pour l’OCR automatique.`);
  }

  const pages: InvoiceOcrPage[] = [];
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress(`Vérification du texte PDF de la page ${pageNumber}/${pdf.numPages}…`);
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const nativeText = textContentToLines(textContent.items);
      if (hasReadableNativeText(nativeText)) {
        pages.push({ page: pageNumber, text: nativeText, confidence: null, source: "native_pdf_text" });
        page.cleanup();
        continue;
      }

      onProgress(`Rendu de la page ${pageNumber}/${pdf.numPages} pour l’OCR…`);
      const baseViewport = page.getViewport({ scale: 2 });
      const pixels = baseViewport.width * baseViewport.height;
      const scale = pixels > MAX_PAGE_PIXELS ? 2 * Math.sqrt(MAX_PAGE_PIXELS / pixels) : 2;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Le navigateur ne peut pas préparer la page PDF pour l’OCR.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      worker ??= await createInvoiceOcrWorker(onProgress);
      onProgress(`Lecture OCR locale de la page ${pageNumber}/${pdf.numPages}…`);
      const result = await worker.recognize(canvas);
      pages.push({ page: pageNumber, text: result.data.text, confidence: result.data.confidence / 100, source: "local_ocr" });
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
    }
    return pages;
  } finally {
    if (worker) await worker.terminate();
    await loadingTask.destroy();
  }
}

function textContentToLines(items: unknown[]) {
  const positioned = items
    .filter((item): item is { str: string; transform: number[] } => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as { str?: unknown; transform?: unknown };
      return typeof candidate.str === "string" && Boolean(candidate.str.trim())
        && Array.isArray(candidate.transform) && candidate.transform.length >= 6
        && candidate.transform.every((part) => typeof part === "number");
    })
    .map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y))
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const rows: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];
  for (const item of positioned) {
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
    if (!row) { row = { y: item.y, items: [] }; rows.push(row); }
    row.items.push({ x: item.x, text: item.text });
  }
  return rows.map((row) => row.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(" ")).join("\n");
}

function hasReadableNativeText(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  const readableCharacters = (compact.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return compact.length >= 32 && readableCharacters >= 16 && readableCharacters / compact.length >= 0.3;
}

function extractLineItems(page: InvoiceOcrPage): InvoiceOcrLine[] {
  const output: InvoiceOcrLine[] = [];
  const moneyPattern = /(-?\d[\d .\u00a0\u202f]*[,.]\d{2})\s*(?:\u20ac)?\s*$/u;
  for (const rawLine of page.text.split(/\r?\n/)) {
    const match = rawLine.match(moneyPattern);
    if (!match) continue;
    const description = rawLine.slice(0, match.index).replace(/[|:;\s-]+$/, "").trim();
    if (description.length < 3 || /\b(total|sous-total|tva|dont|net\s+a\s+payer|montant\s+a\s+payer|acompte|solde|iban|siret)\b/i.test(description)) continue;
    const amount = parsePrintedEuroAmount(match[1]);
    if (amount === null || amount <= 0) continue;
    output.push({ description: description.slice(0, 500), lineTotalCents: amount, sourcePage: page.page, confidence: page.confidence, source: page.source });
  }
  return output;
}

function extractInvoiceFields(pages: InvoiceOcrPage[]) {
  const text = pages.map((page) => page.text).join("\n");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const reference = text.match(/\b(?:facture|invoice)\s*(?:n(?:\u00b0|\u00ba|o|\.)|num(?:e|\u00e9)ro|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{1,39})/i)?.[1] ?? "";
  const dateLine = text.match(/\bdate\b.{0,24}?\b(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i)?.[1];
  const invoiceDate = dateLine ? normalizeDate(dateLine) : "";
  const totalLines = text.split(/\r?\n/).filter((line) => /\b(total\s*(?:ttc|a\s+payer)?|net\s+a\s+payer|montant\s+a\s+payer)\b/i.test(line));
  const totalCents = totalLines.map(lastEuroAmount).find((amount) => amount !== null) ?? null;
  const supplierName = lines.slice(0, 12).find((line) => {
    return line.length >= 3 && line.length <= 100 && /\p{L}/u.test(line)
      && !/^(facture|invoice|devis|date|siret|siren|t[e\u00e9]l|www\.|https?:|[\w.+-]+@)/i.test(line);
  })?.slice(0, 300) ?? "";
  return { supplierName, invoiceNumber: reference.slice(0, 120), invoiceDate, totalCents };
}

function lastEuroAmount(line: string) {
  const matches = [...line.matchAll(/(-?\d[\d .\u00a0\u202f]*[,.]\d{2})\s*(?:\u20ac)?/gu)];
  return matches.length ? parsePrintedEuroAmount(matches[matches.length - 1][1]) : null;
}

function parsePrintedEuroAmount(value: string) {
  const normalized = value.replace(/[\s\u00a0\u202f]/g, "").replace(/\.(?=\d{3}(?:[,\.]|$))/g, "").replace(",", ".");
  try { return parseEuroToCents(normalized); } catch { return null; }
}

function normalizeDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isValidIsoDate(value) ? value : "";
  const parts = value.split(/[/.\-]/);
  if (parts.length !== 3) return "";
  const [day, month, rawYear] = parts;
  let year = rawYear;
  if (year.length === 2) year = `${Number(year) < 70 ? "20" : "19"}${year}`;
  const result = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isValidIsoDate(result) ? result : "";
}

function isValidIsoDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function progressLabel(message: { status: string; progress: number }) {
  if (message.status === "recognizing text") return `Reconnaissance locale : ${Math.round(message.progress * 100)} %…`;
  return "Préparation du moteur OCR local…";
}
