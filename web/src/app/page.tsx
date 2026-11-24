import Link from "next/link";
import InitialSetupLink from "./initial-setup-link";

const modules = [
  {
    number: "01",
    title: "Comptabilité",
    description:
      "Classez vos recettes et dépenses, retrouvez vos justificatifs et préparez vos exports annuels.",
    status: "Registre annuel",
    href: "/comptabilite",
  },
  {
    number: "02",
    title: "Chantiers",
    description:
      "Suivez les avances, les factures et les remboursements dans un espace partagé par chantier.",
    status: "Débours et factures",
    href: "/chantiers",
  },
];

export default function Home() {
  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="#accueil" aria-label="Compta Immo, accueil">
          <span className="brand-mark" aria-hidden="true">CI</span>
          <span>Compta <strong>Immo</strong></span>
        </a>
        <span className="topbar-note">Espace de gestion immobilière</span>
      </header>

      <section className="hero" id="accueil" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> VOTRE ESPACE, EN CONSTRUCTION</p>
          <h1 id="page-title">La gestion immobilière,<br /><em>plus lisible.</em></h1>
          <p className="hero-description">
            Documents, comptabilité et suivi de chantier réunis dans un espace clair,
            conçu pour vous aider à garder chaque pièce au bon endroit.
          </p>
          <InitialSetupLink />
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="sun" />
          <div className="building building-back"><span /><span /><span /></div>
          <div className="building building-front"><span /><span /><span /><span /></div>
          <div className="ground-line" />
        </div>
      </section>

      <section className="modules" aria-labelledby="modules-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LES ESPACES</p>
            <h2 id="modules-title">Tout au même endroit.</h2>
          </div>
          <p className="section-aside">Une base simple, pensée pour évoluer avec vos besoins.</p>
        </div>
        <div className="module-grid">
          {modules.map((module) => (
            <article className="module-card" key={module.number}>
              <div className="card-topline">
                <span className="module-number">{module.number}</span>
                <span className="status"><span />{module.status}</span>
              </div>
              <div className="module-icon" aria-hidden="true">
                {module.number === "01" ? (
                  <svg viewBox="0 0 32 32" fill="none"><path d="M8 5.5h11l5 5v16H8z"/><path d="M19 5.5v6h5M12 17h8M12 21h8"/></svg>
                ) : (
                  <svg viewBox="0 0 32 32" fill="none"><path d="M5 26V12l11-7 11 7v14H5Z"/><path d="M12 26v-8h8v8M9.5 13.5h.01M16 13.5h.01M22.5 13.5h.01"/></svg>
                )}
              </div>
              <h3>{module.title}</h3>
              <p>{module.description}</p>
              <div className="card-footer">
                {module.href ? <Link className="ledger-link" href={module.href}>{module.number === "02" ? "Ouvrir le suivi chantier →" : "Ouvrir le registre annuel →"}</Link> : <span>Accès prochainement</span>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>Compta Immo</span>
        <span>Un espace privé pour mieux s’organiser.</span>
      </footer>
    </main>
  );
}
