import "server-only";

import { createHash } from "node:crypto";

export const MANDATE_TEMPLATE_VERSION = "mandat-debours-v1.0";

export type MandatePdfData = {
  title: string;
  createdAt: string;
  contentSha256: string;
  mandateData: {
    parties: Record<"mandant" | "mandataire", { name: string; email: string; address: string }>;
    project: { purpose: string; address: string };
    amountLimitCents: number;
    authorizedMaterials: string[];
    terms: string;
    effectiveOn: string;
    expiresOn: string;
  };
  signatures: Array<{
    partyRole: "mandant" | "mandataire";
    signerEmail: string;
    signerName: string;
    consentText: string;
    signedAt: string;
    signatureImageDocumentId: string | null;
  }>;
};

const LINES_PER_PAGE = 48;

export function mandateDataSha256(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function renderMandatePdf(mandate: MandatePdfData) {
  const data = mandate.mandateData;
  const lines = [
    "MANDAT SPÉCIAL DE DÉBOURS",
    `Modèle : ${MANDATE_TEMPLATE_VERSION}`,
    `Document : ${mandate.title}`,
    `Créé le : ${mandate.createdAt}`,
    "",
    "MANDANT",
    `Nom : ${data.parties.mandant.name}`,
    `E-mail : ${data.parties.mandant.email}`,
    `Adresse : ${data.parties.mandant.address}`,
    "",
    "MANDATAIRE",
    `Nom : ${data.parties.mandataire.name}`,
    `E-mail : ${data.parties.mandataire.email}`,
    `Adresse : ${data.parties.mandataire.address}`,
    "",
    "CHANTIER ET AUTORISATION",
    `Adresse du chantier : ${data.project.address}`,
    `Objet : ${data.project.purpose}`,
    `Plafond maximal TTC : ${formatCents(data.amountLimitCents)}`,
    `Période : du ${data.effectiveOn} au ${data.expiresOn}`,
    "Achats et matériaux autorisés :",
    ...(data.authorizedMaterials.length ? data.authorizedMaterials.map((item) => `- ${item}`) : ["- Aucun poste precise"]),
    "",
    "CONDITIONS DU MANDAT",
    ...data.terms.split(/\r?\n/),
    "",
    "SIGNATURES ENREGISTRÉES",
  ];

  for (const role of ["mandant", "mandataire"] as const) {
    const signature = mandate.signatures.find((item) => item.partyRole === role);
    lines.push(role === "mandant" ? "Mandant :" : "Mandataire :");
    if (!signature) {
      lines.push("En attente de signature.", "");
      continue;
    }
    lines.push(
      `Nom saisi : ${signature.signerName}`,
      `Compte authentifié : ${signature.signerEmail}`,
      `Date et heure UTC : ${new Date(signature.signedAt).toISOString()}`,
      `Consentement : ${signature.consentText}`,
      ...(signature.signatureImageDocumentId ? ["Une image de signature a été jointe comme élément visuel ; elle n'est pas reproduite dans ce PDF."] : []),
      "",
    );
  }
  lines.push(
    `Empreinte SHA-256 du contenu du mandat : ${mandate.contentSha256}`,
    "Cette empreinte identifie le contenu structure du mandat signe.",
    "Ce document retranscrit les informations enregistrées dans l'application. Il ne certifie pas un niveau de signature qualifié.",
  );

  const wrapped = lines.flatMap(wrapLine);
  const pages: string[][] = [];
  for (let index = 0; index < wrapped.length; index += LINES_PER_PAGE) pages.push(wrapped.slice(index, index + LINES_PER_PAGE));
  return makePdf(pages.length ? pages : [[]]);
}

function makePdf(pages: string[][]) {
  const objects: Buffer[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii");
  objects[2] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`, "ascii");
  objects[3] = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "ascii");

  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const streamId = pageId + 1;
    const stream = Buffer.from(
      `BT\n/F1 10 Tf\n54 756 Td\n14 TL\n${page.map((line) => `<${toWinAnsiHex(line)}> Tj\nT*`).join("\n")}\nET\n`,
      "ascii",
    );
    objects[pageId] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`,
      "ascii",
    );
    objects[streamId] = Buffer.concat([
      Buffer.from(`<< /Length ${stream.byteLength} >>\nstream\n`, "ascii"),
      stream,
      Buffer.from("endstream", "ascii"),
    ]);
  });

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets = [0];
  let byteOffset = chunks[0].byteLength;
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = byteOffset;
    const object = Buffer.concat([
      Buffer.from(`${id} 0 obj\n`, "ascii"),
      objects[id],
      Buffer.from("\nendobj\n", "ascii"),
    ]);
    chunks.push(object);
    byteOffset += object.byteLength;
  }
  const xrefOffset = byteOffset;
  const xref = ["xref", `0 ${objects.length}`, "0000000000 65535 f "];
  for (let id = 1; id < objects.length; id += 1) xref.push(`${String(offsets[id]).padStart(10, "0")} 00000 n `);
  chunks.push(Buffer.from(`${xref.join("\n")}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "ascii"));
  return Buffer.concat(chunks);
}

function wrapLine(line: string) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const output: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > 92) {
      if (current) { output.push(current); current = ""; }
      for (let offset = 0; offset < word.length; offset += 92) output.push(word.slice(offset, offset + 92));
      continue;
    }
    if (current && `${current} ${word}`.length > 92) { output.push(current); current = word; }
    else current = current ? `${current} ${word}` : word;
  }
  if (current) output.push(current);
  return output;
}

function toWinAnsiHex(value: string) {
  const special = new Map<number, number>([
    [0x0152, 0x8c], [0x0153, 0x9c], [0x0160, 0x8a], [0x0161, 0x9a], [0x0178, 0x9f],
    [0x017d, 0x8e], [0x017e, 0x9e], [0x0192, 0x83], [0x2013, 0x96], [0x2014, 0x97],
    [0x2018, 0x91], [0x2019, 0x92], [0x201a, 0x82], [0x201c, 0x93], [0x201d, 0x94],
    [0x2022, 0x95], [0x2026, 0x85], [0x20ac, 0x80], [0x2122, 0x99],
  ]);
  let output = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0x3f;
    const byte = codePoint <= 0xff ? codePoint : special.get(codePoint) ?? 0x3f;
    output += byte.toString(16).padStart(2, "0");
  }
  return output.toUpperCase();
}

function formatCents(value: number) {
  const euros = Math.floor(value / 100);
  const cents = String(value % 100).padStart(2, "0");
  return `${euros},${cents} EUR`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
