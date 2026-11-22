import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import ProjectWorkspace from "./project-workspace";

export const metadata: Metadata = { title: "Chantiers | Compta Immo" };

export default async function ProjectsPage() {
  await connection();
  return (
    <main className="page-shell ledger">
      <header className="topbar"><Link href="/">← Compta Immo</Link></header>
      <h1>Chantiers et débours</h1>
      <p role="note">Suivez le pot de débours, les factures et les justificatifs. Les soldes sont opérationnels et ne constituent pas une qualification fiscale.</p>
      <ProjectWorkspace />
    </main>
  );
}
