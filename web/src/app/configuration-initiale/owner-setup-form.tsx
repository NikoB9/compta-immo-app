"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

type Availability = "checking" | "available" | "unavailable" | "error" | "complete";

export default function OwnerSetupForm() {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/setup/owner", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Le service de configuration ne répond pas.");
        const result: { available?: boolean } = await response.json();
        setAvailability(result.available ? "available" : "unavailable");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAvailability("error");
        setMessage(error instanceof Error ? error.message : "Le service est indisponible.");
      });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const payload = {
      displayName: form.get("displayName"),
      workspaceName: form.get("workspaceName"),
    };

    try {
      const response = await fetch("/api/setup/owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "La configuration n'a pas abouti.");
      setAvailability("complete");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "La configuration n'a pas abouti.");
    } finally {
      setSaving(false);
    }
  }

  if (availability === "checking") return <p role="status">Vérification de la configuration…</p>;
  if (availability === "unavailable") {
    return <section className="ledger-panel" role="status">
      <h2>Cette étape est déjà terminée.</h2>
      <p>La création initiale est fermée. Vous pouvez accéder aux espaces de l’application.</p>
      <Link className="ledger-link" href="/">Retour à l’accueil</Link>
    </section>;
  }
  if (availability === "error") return <section className="ledger-panel" role="alert">
    <h2>Vérification impossible</h2><p>{message}</p>
  </section>;
  if (availability === "complete") return <section className="ledger-panel" role="status">
    <h2>Votre espace est prêt.</h2>
    <p>Votre compte propriétaire et votre espace ont été créés. Vous pouvez ajouter vos adresses et lots quand vous le souhaitez.</p>
    <Link className="ledger-link" href="/biens">Ajouter une adresse</Link>
  </section>;

  return (
    <form className="ledger-panel initial-setup-form" onSubmit={submit}>
      <fieldset disabled={saving}>
        <legend>Configuration initiale</legend>
        <section className="initial-setup-section" aria-labelledby="setup-account-title">
          <h2 id="setup-account-title">Votre compte</h2>
          <label>Nom affiché<input name="displayName" autoComplete="name" maxLength={160} required /></label>
        </section>
        <section className="initial-setup-section" aria-labelledby="setup-building-title">
          <h2 id="setup-building-title">Votre espace de travail</h2>
          <label>Nom de l’espace<input name="workspaceName" maxLength={160} required /></label>
        </section>
      </fieldset>
      {message && <p className="ledger-error" role="alert">{message}</p>}
      <button type="submit" disabled={saving}>{saving ? "Création en cours…" : "Créer mon espace"}</button>
    </form>
  );
}
