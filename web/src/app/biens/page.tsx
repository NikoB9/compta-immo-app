import type { Metadata } from "next";
import Link from "next/link";
import PropertiesWorkspace from "./properties-workspace";

export const metadata: Metadata = { title: "Biens immobiliers | Compta Immo" };

export default function PropertiesPage() {
  return (
    <main className="page-shell ledger properties-page">
      <header className="topbar"><Link href="/">← Compta Immo</Link></header>
      <p className="eyebrow initial-setup-eyebrow">PATRIMOINE IMMOBILIER</p>
      <h1>Vos biens.</h1>
      <p role="note" className="initial-setup-intro">
        Ajoutez vos adresses et créez les lots de chaque bien au fur et à mesure. Chaque bien peut contenir autant de lots que nécessaire.
      </p>
      <PropertiesWorkspace />
    </main>
  );
}
