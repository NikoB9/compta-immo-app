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
        Votre identité est vérifiée par Cloudflare Access. Cette étape crée votre compte propriétaire
        et votre espace de travail. Vous pourrez ensuite ajouter autant d’adresses et de lots que nécessaire.
      </p>
      <OwnerSetupForm />
    </main>
  );
}
