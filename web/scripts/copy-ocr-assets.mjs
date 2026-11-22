import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDir, "..");
const publicRoot = join(webRoot, "public", "ocr");
const tesseractDist = dirname(require.resolve("tesseract.js/package.json"));
const tesseractCore = dirname(require.resolve("tesseract.js-core/package.json"));
const frenchData = dirname(require.resolve("@tesseract.js-data/fra/package.json"));
const pdfjsDist = dirname(require.resolve("pdfjs-dist/package.json"));

await mkdir(join(publicRoot, "core"), { recursive: true });
await mkdir(join(publicRoot, "lang"), { recursive: true });
await cp(join(pdfjsDist, "cmaps"), join(publicRoot, "cmaps"), { recursive: true });
await cp(join(pdfjsDist, "standard_fonts"), join(publicRoot, "standard_fonts"), { recursive: true });
await cp(join(tesseractDist, "dist", "worker.min.js"), join(publicRoot, "worker.min.js"));
await cp(join(pdfjsDist, "build", "pdf.worker.min.mjs"), join(publicRoot, "pdf.worker.min.mjs"));

for (const file of await readdir(tesseractCore)) {
  if (/^tesseract-core.*\.wasm\.js$/.test(file)) {
    await cp(join(tesseractCore, file), join(publicRoot, "core", file));
  }
}

const languageFile = join(frenchData, "4.0.0_best_int", "fra.traineddata.gz");
if ((await stat(languageFile)).size > 2_000_000) {
  throw new Error("Unexpectedly large French OCR model.");
}
await cp(languageFile, join(publicRoot, "lang", "fra.traineddata.gz"));

console.log("Prepared local OCR worker, French model, PDF worker, and WASM cores.");
