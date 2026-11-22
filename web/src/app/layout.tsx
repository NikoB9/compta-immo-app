import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Compta Immo — Votre espace de gestion",
  description: "Un espace privé pour organiser la comptabilité immobilière et le suivi des chantiers.",
  applicationName: "Compta Immo",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
