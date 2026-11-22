import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, parse, resolve, sep } from "node:path";

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PrivateDocumentError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 413 | 415 | 503) {
    super(message);
    this.name = "PrivateDocumentError";
  }
}

export function getPrivateDocumentRoot() {
  const configuredPath = process.env.PRIVATE_DOCUMENTS_DIR;
  if (!configuredPath || !isAbsolute(configuredPath)) {
    throw new PrivateDocumentError("Le stockage privé des documents n'est pas configuré.", 503);
  }
  const root = resolve(configuredPath);
  if (root === parse(root).root) {
    throw new PrivateDocumentError("Le stockage priv\u00e9 ne peut pas utiliser la racine du syst\u00e8me.", 503);
  }
  return root;
}

export function makeDocumentObjectKey(workspaceId: string, documentId: string) {
  if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(documentId)) {
    throw new PrivateDocumentError("Référence de document invalide.", 400);
  }
  return `${workspaceId}/${documentId}`;
}

export function detectDocumentMediaType(bytes: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" {
  if (bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  throw new PrivateDocumentError("Seuls les PDF et les images JPEG, PNG ou WebP sont acceptés.", 415);
}

export function sanitizeDocumentFilename(value: string | null) {
  const filename = (value ?? "document").replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
  if (!filename || filename.length > 255) {
    throw new PrivateDocumentError("Nom de fichier invalide.", 400);
  }
  return filename;
}

export async function writePrivateDocument(objectKey: string, bytes: Uint8Array) {
  const filePath = resolveObjectPath(objectKey);
  const root = getPrivateDocumentRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(resolve(root, objectKey.split("/")[0]), { recursive: true, mode: 0o700 });
  await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
  return filePath;
}

export async function readPrivateDocument(objectKey: string) {
  return readFile(resolveObjectPath(objectKey));
}

export async function removePrivateDocument(objectKey: string) {
  try {
    await unlink(resolveObjectPath(objectKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function resolveObjectPath(objectKey: string) {
  const segments = objectKey.split("/");
  if (segments.length !== 2 || !segments.every((segment) => UUID_PATTERN.test(segment))) {
    throw new PrivateDocumentError("Référence de document invalide.", 400);
  }

  const root = getPrivateDocumentRoot();
  const filePath = resolve(root, segments[0], segments[1]);
  if (!filePath.startsWith(`${root}${sep}`)) {
    throw new PrivateDocumentError("Référence de document invalide.", 400);
  }
  return filePath;
}
