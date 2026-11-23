import "server-only";

import { once } from "node:events";
import { connect, type Socket } from "node:net";

const DEFAULT_PORT = 3310;
const SOCKET_TIMEOUT_MS = 120_000;
const STREAM_CHUNK_BYTES = 64 * 1024;
const MAX_REPLY_BYTES = 8 * 1024;
const MAX_SCANNED_BYTES = 25 * 1024 * 1024;

export class DocumentScanError extends Error {
  constructor(message: string, readonly status: 413 | 415 | 503) {
    super(message);
    this.name = "DocumentScanError";
  }
}

export async function assertDocumentIsClean(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_SCANNED_BYTES) {
    throw new DocumentScanError("Le fichier dépasse la limite d’analyse antivirus de 25 Mio.", 413);
  }
  const host = process.env.DOCUMENT_SCANNER_HOST;
  if (!host) {
    if (process.env.NODE_ENV === "development" && process.env.DOCUMENT_SCANNER_BYPASS_LOCAL === "true") return;
    throw new DocumentScanError("L’analyse antivirus est indisponible ; le fichier n’a pas été enregistré.", 503);
  }

  const port = Number(process.env.DOCUMENT_SCANNER_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DocumentScanError("La configuration de l’analyse antivirus est invalide.", 503);
  }

  let result: string;
  try {
    result = await scanStream(host, port, bytes);
  } catch {
    throw new DocumentScanError("L’analyse antivirus est indisponible ; le fichier n’a pas été enregistré.", 503);
  }

  if (result === "stream: OK") return;
  if (/^stream: .+ FOUND$/.test(result)) {
    throw new DocumentScanError("Le fichier a été refusé par l’analyse antivirus.", 415);
  }
  throw new DocumentScanError("L’analyse antivirus n’a pas pu valider le fichier.", 503);
}

function scanStream(host: string, port: number, bytes: Uint8Array) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect({ host, port });
    let reply = Buffer.alloc(0);
    let settled = false;

    const finish = (error?: Error, result?: string) => {
      if (settled) return;
      settled = true;
      if (error) {
        socket.destroy();
        reject(error);
      } else {
        socket.end();
        resolve(result ?? "");
      }
    };

    socket.setTimeout(SOCKET_TIMEOUT_MS, () => finish(new Error("ClamAV scan timed out.")));
    socket.once("error", (error) => finish(error));
    socket.once("close", () => {
      if (!settled) finish(new Error("ClamAV closed the connection without a verdict."));
    });
    socket.on("data", (chunk: Buffer) => {
      reply = Buffer.concat([reply, chunk]);
      if (reply.byteLength > MAX_REPLY_BYTES) {
        finish(new Error("ClamAV returned an oversized response."));
        return;
      }
      const terminator = reply.indexOf(0);
      if (terminator >= 0) finish(undefined, reply.subarray(0, terminator).toString("utf8").trim());
    });

    socket.once("connect", () => {
      void sendInstream(socket, bytes).catch((error: unknown) => {
        finish(error instanceof Error ? error : new Error("Unable to stream the file to ClamAV."));
      });
    });
  });
}

async function sendInstream(socket: Socket, bytes: Uint8Array) {
  await writeWithBackpressure(socket, Buffer.from("zINSTREAM\0", "ascii"));
  for (let offset = 0; offset < bytes.byteLength; offset += STREAM_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, Math.min(offset + STREAM_CHUNK_BYTES, bytes.byteLength));
    const frame = Buffer.allocUnsafe(4);
    frame.writeUInt32BE(chunk.byteLength);
    await writeWithBackpressure(socket, frame);
    await writeWithBackpressure(socket, chunk);
  }
  socket.end(Buffer.alloc(4));
}

async function writeWithBackpressure(socket: Socket, chunk: Uint8Array) {
  if (!socket.write(chunk)) await once(socket, "drain");
}
