"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { parseAnnualLedgerCsv, serializeAnnualLedgerCsv } from "../../../../packages/domain/src/annual-csv.js";
import { formatEuroCents, parseEuroToCents } from "../../../../packages/domain/src/money.js";

type Preview = ReturnType<typeof parseAnnualLedgerCsv>;
type Entry = Preview["rows"][number] & { documents?: Array<{ id: string; originalFilename: string }> };
type Session = {
  email: string;
  workspaces: Array<{ workspace_id: string; workspace_name: string; role: "owner" | "administrator" }>;
  projects: Array<{ project_id: string; project_name: string; status: string }>;
  buildings: Array<{
    workspace_id: string;
    building_id: string;
    building_label: string;
    address_line1: string;
    postal_code: string;
    locality: string;
    units: Array<{ id: string; reference: string; description: string | null }>;
  }>;
};
const MAX_CSV_BYTES = 2 * 1024 * 1024;

async function fetchLedgerEntries(workspaceId: string, year: string, signal?: AbortSignal): Promise<Entry[]> {
  const response = await fetch(`/api/accounting/entries?workspaceId=${encodeURIComponent(workspaceId)}&year=${encodeURIComponent(year)}`, {
    cache: "no-store",
    signal,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Impossible de charger le registre.");
  return body as Entry[];
}

async function postJson(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "La requête n'a pas abouti.");
  return result;
}

function EntryTable({ rows, edit, remove, attach }: { rows: Entry[]; edit?: (row: Entry) => void; remove?: (id: string) => void; attach?: (row: Entry, file: File) => void }) {
  return (
    <div className="ledger-table" tabIndex={0} role="region" aria-label={remove ? "Écritures du registre" : "Écritures à importer"}>
      <table>
        <thead><tr><th scope="col">Date</th><th scope="col">Libellé</th><th scope="col">Type</th><th scope="col">Total payé</th><th scope="col">Part administrative</th><th scope="col">Frais annexes internes</th>{remove && <><th scope="col">Fichier(s)</th><th scope="col">Action</th></>}</tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id}>
            <td>{row.occurredOn}</td><td>{row.description || "Sans libellé"}</td>
            <td>{row.entryType === "income" ? "Recette" : "Dépense"}</td><td>{formatEuroCents(row.amountCents!)}</td>
            <td>{formatEuroCents(row.administrativeAmountCents ?? row.amountCents!)}</td>
            <td>{formatEuroCents(row.internalOnlyCents ?? 0)}</td>
            {remove && <td>
              {(row.documents ?? []).map((file: { id: string; originalFilename: string }) => <div key={file.id}><a href={`/api/documents/${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer">{file.originalFilename}</a></div>)}
              {attach && <label>Ajouter une facture ou un justificatif<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) attach(row, file);
              }} /></label>}
            </td>}
            {remove && <td className="ledger-actions">
              {edit && <button type="button" aria-label={`Modifier l’écriture : ${row.description || row.id}`} onClick={() => edit(row)}>Modifier</button>}
              <button type="button" aria-label={`Supprimer l’écriture : ${row.description || row.id}`} onClick={() => remove(row.id)}>Supprimer</button>
            </td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function AnnualLedger({ initialYear }: { initialYear: number }) {
  const [year, setYear] = useState(String(initialYear));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [unitRef, setUnitRef] = useState("");
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [csvText, setCsvText] = useState("");
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [amountText, setAmountText] = useState("");
  const [administrativeShareCents, setAdministrativeShareCents] = useState(0);
  const [shareManuallySet, setShareManuallySet] = useState(false);
  const readId = useRef(0);
  const formId = useRef(0);
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 2200;
  const workspaceBuildings = session?.buildings.filter((building) => building.workspace_id === workspaceId) ?? [];
  const selectedBuilding = workspaceBuildings.find((building) => building.building_id === buildingId);
  const rows = entries.filter((row) => row.taxYear === Number(year));
  const ids = new Set(entries.map((row) => row.id));
  const conflicts = preview?.rows.filter((row) => ids.has(row.id)) ?? [];
  let totalCents = 0;
  try { totalCents = parseEuroToCents(amountText); } catch { totalCents = 0; }
  const safeAdministrativeShare = Math.min(administrativeShareCents, totalCents);
  const internalShareCents = totalCents - safeAdministrativeShare;

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Impossible de charger la session.");
        return body as Session;
      })
      .then((data) => {
        if (!active) return;
        setSession(data);
        const initialWorkspace = data.workspaces[0]?.workspace_id ?? "";
        setWorkspaceId(initialWorkspace);
        setBuildingId(data.buildings.find((building) => building.workspace_id === initialWorkspace)?.building_id ?? "");
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Impossible de charger la session.");
      })
      .finally(() => { if (active) setSessionReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!sessionReady || !workspaceId || !validYear) {
      if (sessionReady) {
        setEntries([]);
        setLoadingEntries(false);
      }
      return;
    }
    const controller = new AbortController();
    setLoadingEntries(true);
    setEntries([]);
    fetchLedgerEntries(workspaceId, year, controller.signal)
      .then((data) => { setEntries(data); setError(""); })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Impossible de charger le registre.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingEntries(false); });
    return () => controller.abort();
  }, [sessionReady, workspaceId, year, validYear]);

  function selectYear(event: ChangeEvent<HTMLInputElement>) {
    readId.current += 1;
    setYear(event.target.value);
    setEditing(null);
    setPreview(null);
    setCsvText("");
    setReading(false);
    setError("");
    setMessage("");
    setAmountText("");
    setAdministrativeShareCents(0);
    setShareManuallySet(false);
  }

  function selectWorkspace(nextWorkspaceId: string) {
    const nextBuildingId = session?.buildings.find((building) => building.workspace_id === nextWorkspaceId)?.building_id ?? "";
    setWorkspaceId(nextWorkspaceId);
    setBuildingId(nextBuildingId);
    setUnitRef("");
    setEditing(null);
    setPreview(null);
    setCsvText("");
    setError("");
    setMessage("");
  }

  function selectBuilding(nextBuildingId: string) {
    setBuildingId(nextBuildingId);
    setUnitRef("");
    if (editing) setEditing({ ...editing, buildingRef: nextBuildingId, unitRef: null });
  }

  async function loadCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !validYear) return;
    const operation = ++readId.current;
    setPreview(null);
    setReading(false);
    setError("");
    setMessage("");
    if (file.size > MAX_CSV_BYTES) {
      setError("Le fichier doit faire au plus 2 Mio.");
      return;
    }

    setReading(true);
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (operation === readId.current) {
        setCsvText(content);
        setPreview(parseAnnualLedgerCsv(content, { expectedTaxYear: Number(year) }));
      }
    } catch {
      if (operation === readId.current) setError("Impossible de lire ce fichier. Vérifiez qu’il est encodé en UTF-8.");
    } finally {
      if (operation === readId.current) setReading(false);
    }
  }

  async function acceptPreview() {
    if (!preview?.canImport || !preview.rows.length || conflicts.length || !validYear || !workspaceId || !buildingId) return;
    setReading(true);
    setError("");
    setMessage("");
    try {
      const result = await postJson("/api/accounting/import", "POST", {
        workspaceId,
        defaultBuildingId: buildingId,
        year: Number(year),
        csv: csvText,
      });
      const latest = await fetchLedgerEntries(workspaceId, year);
      setEntries(latest);
      setMessage(`${result.imported} écriture(s) enregistrée(s) dans le registre.`);
      setPreview(null);
      setCsvText("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import impossible.");
    } finally {
      setReading(false);
    }
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validYear || !workspaceId || !buildingId) return;
    setError("");
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const occurredOn = String(data.get("date"));
    if (occurredOn.slice(0, 4) !== year) {
      setError("Choisissez une date de paiement ou d’encaissement dans l’année affichée.");
      return;
    }
    let amountCents: number;
    try {
      amountCents = parseEuroToCents(String(data.get("amount")));
      if (amountCents === 0) throw new RangeError();
      if (safeAdministrativeShare > amountCents) throw new RangeError();
    } catch {
      setError("Saisissez un montant positif avec au plus deux décimales, par exemple 125,50.");
      return;
    }
    const description = String(data.get("description")).trim();
    if (!description) {
      setError("Saisissez un libellé.");
      return;
    }
    const id = editing?.id ?? (globalThis.crypto?.randomUUID?.() ?? `manual-${Date.now()}-${++formId.current}`);
    const entry: Entry = {
      id, taxYear: Number(year), occurredOn, entryType: String(data.get("type")),
      amountCents, administrativeAmountCents: safeAdministrativeShare,
      internalOnlyCents: amountCents - safeAdministrativeShare,
      description, currency: "EUR", categoryCode: editing?.categoryCode ?? null,
      buildingRef: buildingId, unitRef: unitRef || null,
      documentRef: editing?.documentRef ?? null, reviewStatus: "needs_review",
      sourceReviewStatus: editing?.sourceReviewStatus ?? "needs_review",
    };
    setSaving(true);
    try {
      await postJson("/api/accounting/entries", editing ? "PATCH" : "POST", { workspaceId, entry });
      setEntries(await fetchLedgerEntries(workspaceId, year));
      setMessage(editing ? "Écriture modifiée." : "Écriture enregistrée.");
      setEditing(null);
      setUnitRef("");
      form.reset();
      setAmountText("");
      setAdministrativeShareCents(0);
      setShareManuallySet(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  function download() {
    setError("");
    setMessage("");
    try {
      const csv = serializeAnnualLedgerCsv(Number(year), rows);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `registre-${year}.csv`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Export impossible. Vérifiez les champs de texte qui commencent par un signe de formule de tableur.");
    }
  }

  async function attachDocument(entry: Entry, file: File) {
    if (!workspaceId) return;
    setError("");
    setMessage("");
    if (file.size === 0 || file.size > 25 * 1024 * 1024) {
      setError("Le fichier doit contenir des données et faire au plus 25 Mio.");
      return;
    }
    setUploading(true);
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "x-workspace-id": workspaceId,
          "x-entry-reference": entry.id,
          "x-document-filename": encodeURIComponent(file.name),
        },
        body: file,
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "L'ajout du document a échoué.");
      setEntries(await fetchLedgerEntries(workspaceId, year));
      setMessage(`Document « ${result.originalFilename} » ajouté à l'écriture.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L'ajout du document a échoué.");
    } finally {
      setUploading(false);
    }
  }

  async function deleteEntry(id: string) {
    if (!workspaceId) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await postJson("/api/accounting/entries", "DELETE", { workspaceId, id });
      setEntries(await fetchLedgerEntries(workspaceId, year));
      if (editing?.id === id) setEditing(null);
      setMessage("Écriture supprimée du registre.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Suppression impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="ledger-bar">
        {sessionReady && session?.workspaces.length ? <>
          <label>Espace de travail<select value={workspaceId} disabled={saving || reading} onChange={(event) => selectWorkspace(event.target.value)}>
            {session.workspaces.map((workspace) => <option key={workspace.workspace_id} value={workspace.workspace_id}>{workspace.workspace_name}</option>)}
          </select></label>
          <label>Adresse<select value={buildingId} disabled={saving || reading || workspaceBuildings.length === 0} onChange={(event) => selectBuilding(event.target.value)}>
            {workspaceBuildings.map((building) => <option key={building.building_id} value={building.building_id}>{building.building_label} — {building.address_line1}, {building.postal_code} {building.locality}</option>)}
          </select></label>
        </> : sessionReady ? <p role="alert">Aucun espace de comptabilité n’est associé à ce compte.</p> : <p role="status">Chargement du compte…</p>}
        <label>Année fiscale<input type="number" min="1900" max="2200" step="1" value={year} disabled={saving || reading} onChange={selectYear} /></label>
        <button type="button" onClick={download} disabled={!rows.length || !validYear}>Télécharger le CSV</button>
      </div>
      {loadingEntries && <p role="status">Chargement du registre…</p>}
      {!validYear && <p role="alert">Saisissez une année entre 1900 et 2200.</p>}
      {error && <p role="alert" className="ledger-error">{error}</p>}
      {message && <p role="status">{message}</p>}

      <section className="ledger-panel" aria-labelledby="add-entry-title">
        <h2 id="add-entry-title">{editing ? "Modifier l’écriture" : "Ajouter une écriture"}</h2>
        <form key={editing?.id ?? "new"} className="ledger-bar" onSubmit={saveEntry}>
          <label>Date de paiement ou d’encaissement<input type="date" name="date" defaultValue={editing?.occurredOn} required /></label>
          <label>Type<select name="type" defaultValue={editing?.entryType ?? "expense"}><option value="expense">Dépense</option><option value="income">Recette</option></select></label>
          <label>Libellé<input name="description" defaultValue={editing?.description} required maxLength={2000} /></label>
          <label>Appartement (facultatif)<select name="unit" value={unitRef} onChange={(event) => setUnitRef(event.target.value)}><option value="">Toute l’adresse</option>{selectedBuilding?.units.map((unit) => <option key={unit.id} value={unit.reference}>{unit.reference}</option>)}</select></label>
          <label>Total payé (€)<input name="amount" value={amountText} onChange={(event) => {
            setAmountText(event.target.value);
            try { const cents = parseEuroToCents(event.target.value); setAdministrativeShareCents((current) => shareManuallySet ? Math.min(current, cents) : cents); } catch { setAdministrativeShareCents(0); }
          }} inputMode="decimal" required maxLength={32} /></label>
          <label>Part administrative<input type="range" min="0" max={totalCents} step="1" value={safeAdministrativeShare}
            aria-label="Part administrative dans le total payé" onChange={(event) => { setAdministrativeShareCents(Number(event.target.value)); setShareManuallySet(true); }} />
            <output>{formatEuroCents(safeAdministrativeShare)}</output>
          </label>
          <p>Frais annexes internes hors export administratif : {formatEuroCents(internalShareCents)}</p>
          <button disabled={!validYear || !workspaceId || !buildingId || saving}>{saving ? "Enregistrement…" : editing ? "Enregistrer la modification" : "Ajouter"}</button>
          {editing && <button type="button" onClick={() => { setEditing(null); setUnitRef(""); setAmountText(""); setAdministrativeShareCents(0); setShareManuallySet(false); }}>Annuler la modification</button>}
        </form>
      </section>

      <section className="ledger-panel" aria-labelledby="import-title">
        <h2 id="import-title">Importer un registre CSV</h2>
        <label>Fichier CSV au format Compta Immo<input type="file" accept=".csv,text/csv" onChange={loadCsv} disabled={!validYear || !workspaceId || !buildingId || saving || reading} /></label>
        {reading && <p role="status">Lecture du fichier…</p>}
        {preview && (
          <>
            <p role="status">{preview.rows.length} ligne(s) valide(s), {preview.errors.length} erreur(s).</p>
            {!preview.canImport && <p>Corrigez les erreurs dans le fichier puis importez-le à nouveau.</p>}
            {preview.errors.length > 0 && <ul className="ledger-error">{preview.errors.slice(0, 20).map((item, index) => <li key={index}>Enregistrement {item.row} · {item.field} · {item.message}</li>)}</ul>}
            {conflicts.length > 0 && <p role="alert" className="ledger-error">{conflicts.length} identifiant(s) existent déjà dans le registre. Retirez les lignes en double du fichier avant de le réimporter.</p>}
            {preview.rows.length > 0 && <EntryTable rows={preview.rows.slice(0, 20)} />}
            {preview.rows.length > 20 && <p>Aperçu des 20 premières lignes valides.</p>}
            <div className="ledger-bar">
              <button type="button" onClick={acceptPreview} disabled={!preview.canImport || !preview.rows.length || conflicts.length > 0 || saving || reading}>Confirmer l'import</button>
              <button type="button" onClick={() => setPreview(null)}>Annuler l’import</button>
            </div>
          </>
        )}
      </section>

      <section className="ledger-panel" aria-labelledby="entries-title">
        <h2 id="entries-title">Écritures de l’année</h2>
        {rows.length ? <EntryTable rows={rows} attach={(row, file) => { void attachDocument(row, file); }} edit={(row) => {
          setEditing(row);
          setBuildingId(row.buildingRef ?? buildingId);
          setUnitRef(row.unitRef ?? "");
          setAmountText(formatEuroCents(row.amountCents!));
          setAdministrativeShareCents(row.administrativeAmountCents ?? row.amountCents!);
          setShareManuallySet(true);
          setError("");
          setMessage("");
          document.getElementById("add-entry-title")?.scrollIntoView();
        }} remove={(id) => { void deleteEntry(id); }} /> : loadingEntries ? <p>Chargement du registre…</p> : <p>Aucune écriture pour cette année.</p>}
        {uploading && <p role="status">Ajout et vérification du document.</p>}
      </section>
    </>
  );
}
