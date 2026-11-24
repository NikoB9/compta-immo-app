import type { Metadata } from "next";
import Link from "next/link";
import OwnerSetupForm from "./owner-setup-form";

export const metadata: Metadata = { title: "Configuration initiale | Compta Immo" };

export default function InitialSetupPage() {
  return (
    <main className="page-shell ledger initial-setup">
      <header className="topbar"><Link href="/">← Compta Immo</Link></header>
      <p className="eyebrow initial-setup-eyebrow">PREMIÈRE UTILISATION</p>
      <h1>Préparons votre espace.</h1>
      <p role="note" className="initial-setup-intro">
        Votre identité vient de Cloudflare Access. Ces informations servent à créer votre espace,
        son adresse et ses trois premiers lots.
      </p>
      <OwnerSetupForm />
    </main>
  );
}
