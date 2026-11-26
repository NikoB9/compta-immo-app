"use client";

import { useEffect, useState, type FormEvent } from "react";

type Unit = { id: string; reference: string; description: string | null };
type Building = {
  workspace_id: string;
  building_id: string;
  building_label: string;
  address_line1: string;
  postal_code: string;
  locality: string;
  units: Unit[];
};
type Workspace = { workspace_id: string; workspace_name: string; role: "owner" | "administrator" };
type Session = { workspaces: Workspace[]; buildings: Building[] };

async function jsonRequest<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "La requête n’a pas abouti.");
  return result;
}

export default function PropertiesWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refreshSession() {
    const result = await jsonRequest<Session>("/api/auth/session");
    setSession(result);
    setWorkspaceId((current) => result.workspaces.some((workspace) => workspace.workspace_id === current)
      ? current
      : result.workspaces[0]?.workspace_id ?? "");
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as Session & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Impossible de charger votre espace.");
        setSession(result);
        setWorkspaceId(result.workspaces[0]?.workspace_id ?? "");
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Impossible de charger votre espace.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function createBuilding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await jsonRequest("/api/buildings", "POST", {
        workspaceId,
        label: data.get("label"),
        addressLine1: data.get("addressLine1"),
        addressLine2: data.get("addressLine2"),
        postalCode: data.get("postalCode"),
        locality: data.get("locality"),
      });
      formElement.reset();
      await refreshSession();
      setMessage("Adresse ajoutée. Vous pouvez maintenant créer ses lots.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L’adresse n’a pas pu être ajoutée.");
    } finally {
      setSaving(false);
    }
  }

  async function createUnit(event: FormEvent<HTMLFormElement>, buildingId: string) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await jsonRequest(`/api/buildings/${encodeURIComponent(buildingId)}/units`, "POST", {
        unitRef: data.get("unitRef"),
        description: data.get("description"),
      });
      formElement.reset();
      await refreshSession();
      setMessage("Lot ajouté.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Le lot n’a pas pu être ajouté.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p role="status">Chargement de vos biens…</p>;
  if (error && !session) return <p role="alert" className="ledger-error">{error}</p>;
  if (!session?.workspaces.length) return <section className="ledger-panel">
    <h2>Aucun espace propriétaire associé à ce compte.</h2>
    <p>La gestion des biens est réservée aux propriétaires et administrateurs de l’espace.</p>
  </section>;

  const workspaceBuildings = session.buildings.filter((building) => building.workspace_id === workspaceId);

  return (
    <>
      {error && <p role="alert" className="ledger-error">{error}</p>}
      {message && <p role="status">{message}</p>}
      {session.workspaces.length > 1 && <label className="properties-workspace-select">Espace de travail
        <select value={workspaceId} disabled={saving} onChange={(event) => setWorkspaceId(event.target.value)}>
          {session.workspaces.map((workspace) => <option key={workspace.workspace_id} value={workspace.workspace_id}>{workspace.workspace_name}</option>)}
        </select>
      </label>}

      <section className="ledger-panel" aria-labelledby="add-building-title">
        <h2 id="add-building-title">Ajouter une adresse</h2>
        <form className="properties-form" onSubmit={createBuilding}>
          <label>Nom ou repère du bien<input name="label" maxLength={160} required placeholder="Maison, immeuble…" /></label>
          <label>Adresse<input name="addressLine1" autoComplete="address-line1" maxLength={240} required /></label>
          <label>Complément d’adresse (facultatif)<input name="addressLine2" autoComplete="address-line2" maxLength={240} /></label>
          <div className="initial-setup-address-row">
            <label>Code postal<input name="postalCode" autoComplete="postal-code" maxLength={24} required /></label>
            <label>Commune<input name="locality" autoComplete="address-level2" maxLength={120} required /></label>
          </div>
          <button disabled={saving || !workspaceId}>{saving ? "Enregistrement…" : "Ajouter cette adresse"}</button>
        </form>
      </section>

      <section aria-labelledby="buildings-title">
        <h2 id="buildings-title">Adresses enregistrées</h2>
        {workspaceBuildings.length === 0 ? <p>Aucune adresse pour le moment. Ajoutez-en une ci-dessus pour commencer.</p> : (
          <div className="properties-grid">
            {workspaceBuildings.map((building) => (
              <article className="ledger-panel property-card" key={building.building_id}>
                <h3>{building.building_label}</h3>
                <p>{building.address_line1}, {building.postal_code} {building.locality}</p>
                <h4>Lots ({building.units.length})</h4>
                {building.units.length ? <ul className="property-unit-list">
                  {building.units.map((unit) => <li key={unit.id}><strong>{unit.reference}</strong>{unit.description && <span> — {unit.description}</span>}</li>)}
                </ul> : <p>Aucun lot enregistré.</p>}
                <form className="property-unit-form" onSubmit={(event) => void createUnit(event, building.building_id)}>
                  <label>Référence du nouveau lot<input name="unitRef" maxLength={80} required placeholder="Ex. Appartement 1" /></label>
                  <label>Description (facultatif)<input name="description" maxLength={300} placeholder="Ex. T2 au premier étage" /></label>
                  <button disabled={saving}>{saving ? "Enregistrement…" : "Ajouter un lot"}</button>
                </form>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
