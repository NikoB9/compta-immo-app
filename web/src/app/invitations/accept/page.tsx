import type { Metadata } from "next";
import Link from "next/link";
import AcceptInvitation from "./accept-invitation";

export const metadata: Metadata = { title: "Invitation chantier | Compta Immo" };

export default function AcceptInvitationPage() {
  return (
    <main className="page-shell ledger">
      <header className="topbar"><Link href="/">Compta Immo</Link></header>
      <h1>Invitation à un chantier</h1>
      <p>L’accès est associé à l’adresse e-mail vérifiée par Cloudflare Access et reste limité au chantier invité.</p>
      <AcceptInvitation />
    </main>
  );
}
