import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import AnnualLedger from "./annual-ledger";

export const metadata: Metadata = { title: "Registre annuel | Compta Immo" };

export default async function AccountingPage() {
  await connection();
  const initialYear = Number(new Intl.DateTimeFormat("fr-FR", { year: "numeric", timeZone: "Europe/Paris" }).format(new Date()));
  return (
    <main className="page-shell ledger">
      <header className="topbar"><Link href="/">← Compta Immo</Link></header>
      <h1>Registre annuel</h1>
      <p role="note">Les écritures sont enregistrées dans l’espace de travail sélectionné. Vérifiez chaque qualification fiscale avant de préparer votre déclaration.</p>
      <AnnualLedger initialYear={initialYear} />
    </main>
  );
}
