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
      buildingLabel: form.get("buildingLabel"),
      addressLine1: form.get("addressLine1"),
      addressLine2: form.get("addressLine2"),
      postalCode: form.get("postalCode"),
      locality: form.get("locality"),
      unitRefs: [form.get("unitRef1"), form.get("unitRef2"), form.get("unitRef3")],
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
    <p>Votre compte propriétaire, l’adresse et les trois lots ont été créés.</p>
    <Link className="ledger-link" href="/">Ouvrir Compta Immo</Link>
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
          <h2 id="setup-building-title">Votre espace et le bâtiment</h2>
          <label>Nom de l’espace<input name="workspaceName" maxLength={160} required /></label>
          <label>Nom ou repère du bâtiment<input name="buildingLabel" maxLength={160} required /></label>
          <label>Adresse<input name="addressLine1" autoComplete="address-line1" maxLength={240} required /></label>
          <label>Complément d’adresse (facultatif)<input name="addressLine2" autoComplete="address-line2" maxLength={240} /></label>
          <div className="initial-setup-address-row">
            <label>Code postal<input name="postalCode" autoComplete="postal-code" maxLength={24} required /></label>
            <label>Commune<input name="locality" autoComplete="address-level2" maxLength={120} required /></label>
          </div>
        </section>
        <section className="initial-setup-section" aria-labelledby="setup-units-title">
          <h2 id="setup-units-title">Les trois premiers lots</h2>
          <p className="initial-setup-hint">Saisissez leurs références comme vous souhaitez les retrouver dans l’application.</p>
          <div className="initial-setup-units">
            <label>Lot 1<input name="unitRef1" maxLength={80} required /></label>
            <label>Lot 2<input name="unitRef2" maxLength={80} required /></label>
            <label>Lot 3<input name="unitRef3" maxLength={80} required /></label>
          </div>
        </section>
      </fieldset>
      {message && <p className="ledger-error" role="alert">{message}</p>}
      <button type="submit" disabled={saving}>{saving ? "Création en cours…" : "Créer mon espace"}</button>
    </form>
  );
}
