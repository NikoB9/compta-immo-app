"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { formatEuroCents, parseEuroToCents } from "../../../../packages/domain/src/money.js";

type Session = {
  workspaces: Array<{ workspace_id: string; workspace_name: string; role: "owner" | "administrator" }>;
  projects: Array<{ project_id: string; project_name: string; status: string }>;
  buildings: Array<{ workspace_id: string; building_id: string; building_label: string; address_line1: string; postal_code: string; locality: string }>;
};
type Project = { id: string; workspace_id: string; building_id: string; name: string; status: string; can_edit: boolean };
type Invoice = { id: string; supplierName: string; invoiceNumber: string | null; invoiceDate: string | null; totalCents: number; documentId: string; extractionStatus: string };
type Movement = {
  id: string; movementType: string; occurredOn: string; amountCents: number; invoiceId: string | null;
  evidenceDocumentId: string | null; paidInCash: boolean; note: string | null; supplierName: string | null;
  invoiceNumber: string | null; invoiceTotalCents: number | null; invoiceDocumentId: string | null;
};
type Detail = {
  project: Project;
  invoices: Invoice[];
  movements: Movement[];
  summary: Record<string, number>;
};

async function jsonRequest(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "La requête n'a pas abouti.");
  return result;
}

function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function movementLabel(type: string) {
  return ({
    advance: "Avance vers le mandataire",
    reimbursement: "Remboursement au mandataire",
    supplier_payment: "Paiement fournisseur",
    supplier_refund: "Remboursement fournisseur",
    return: "Restitution au propriétaire",
  } as Record<string, string>)[type] ?? type;
}

export default function ProjectWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const workspaceBuildings = session?.buildings.filter((building) => building.workspace_id === workspaceId) ?? [];
  const selectedProject = projects.find((project) => project.id === projectId);

  useEffect(() => {
    let active = true;
    jsonRequest("/api/auth/session").then((result: Session) => {
      if (!active) return;
      setSession(result);
      setWorkspaceId(result.workspaces[0]?.workspace_id ?? "");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Session indisponible.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!workspaceId && !session?.projects.length) { setProjects([]); setProjectId(""); return; }
    let active = true;
    setLoading(true);
    const projectsUrl = workspaceId ? `/api/projects?workspaceId=${encodeURIComponent(workspaceId)}` : "/api/projects";
    jsonRequest(projectsUrl).then((result: Project[]) => {
      if (!active) return;
      setProjects(result);
      setProjectId((current) => result.some((project) => project.id === current) ? current : result[0]?.id ?? "");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Chantiers indisponibles.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, session]);

  useEffect(() => {
    if (!projectId) { setDetail(null); return; }
    let active = true;
    jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/debours`).then((result: Detail) => {
      if (active) { setDetail(result); setError(""); }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Débours indisponibles.");
    });
    return () => { active = false; };
  }, [projectId]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true); setError(""); setMessage("");
    try {
      const created = await jsonRequest("/api/projects", "POST", {
        workspaceId,
        buildingId: String(data.get("buildingId")),
        name: String(data.get("name")),
      }) as Project;
      setProjects((current) => [created, ...current]);
      setProjectId(created.id);
      form.reset();
      setMessage("Chantier créé.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Création impossible."); }
    finally { setSaving(false); }
  }

  async function uploadToProject(file: File) {
    if (!selectedProject || !workspaceId) throw new Error("Sélectionnez un chantier.");
    const response = await fetch("/api/documents", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "x-workspace-id": workspaceId,
        "x-project-id": selectedProject.id,
        "x-document-filename": encodeURIComponent(file.name),
      },
      body: file,
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Le document n'a pas été ajouté.");
    return result.id as string;
  }

  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("invoiceFile");
    if (!(file instanceof File) || !file.size) { setError("Choisissez le fichier de la facture."); return; }
    let totalCents: number;
    try { totalCents = parseEuroToCents(String(data.get("total"))); if (totalCents <= 0) throw new RangeError(); }
    catch { setError("Saisissez le montant positif de la facture, avec deux décimales au maximum."); return; }
    setSaving(true); setError(""); setMessage("");
    try {
      const documentId = await uploadToProject(file);
      await jsonRequest(`/api/projects/${encodeURIComponent(selectedProject.id)}/invoices`, "POST", {
        supplierName: String(data.get("supplier")),
        invoiceNumber: String(data.get("invoiceNumber")),
        invoiceDate: String(data.get("invoiceDate")),
        totalCents,
        documentId,
      });
      setDetail(await jsonRequest(`/api/projects/${encodeURIComponent(selectedProject.id)}/debours`));
      form.reset();
      setMessage("Facture enregistrée pour vérification. Le montant est saisi manuellement à ce stade.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement de la facture impossible."); }
    finally { setSaving(false); }
  }

  async function addMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    let amountCents: number;
    try { amountCents = parseEuroToCents(String(data.get("amount"))); if (amountCents <= 0) throw new RangeError(); }
    catch { setError("Saisissez un montant positif, avec deux décimales au maximum."); return; }
    const file = data.get("proof");
    const paidInCash = data.get("paidInCash") === "on";
    if (paidInCash && file instanceof File && file.size) { setError("Ne joignez pas une preuve de virement à un paiement liquide."); return; }
    setSaving(true); setError(""); setMessage("");
    try {
      const evidenceDocumentId = file instanceof File && file.size ? await uploadToProject(file) : null;
      await jsonRequest(`/api/projects/${encodeURIComponent(selectedProject.id)}/debours`, "POST", {
        type: String(data.get("type")),
        occurredOn: String(data.get("occurredOn")),
        amountCents,
        invoiceId: String(data.get("invoiceId")) || null,
        evidenceDocumentId,
        paidInCash,
        note: String(data.get("note")),
      });
      setDetail(await jsonRequest(`/api/projects/${encodeURIComponent(selectedProject.id)}/debours`));
      form.reset();
      setMessage("Mouvement de débours enregistré.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }

  if (loading && !session) return <p role="status">Chargement des chantiers.</p>;
  return (
    <>
      {error && <p role="alert" className="ledger-error">{error}</p>}
      {message && <p role="status">{message}</p>}
      {session?.workspaces.length ? <div className="ledger-bar">
        <label>Espace de travail<select value={workspaceId} disabled={saving} onChange={(event) => { setWorkspaceId(event.target.value); setDetail(null); }}>
          {session.workspaces.map((workspace) => <option key={workspace.workspace_id} value={workspace.workspace_id}>{workspace.workspace_name}</option>)}
        </select></label>
        {projects.length > 0 && <label>Chantier<select value={projectId} disabled={saving} onChange={(event) => setProjectId(event.target.value)}>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>}
      </div> : session?.projects.length ? <p>Projets auxquels ce compte a accès :</p> : <p>Aucun espace ou chantier n'est associé à ce compte.</p>}
      {!session?.workspaces.length && projects.length > 0 && <label>Chantier<select value={projectId} disabled={saving} onChange={(event) => setProjectId(event.target.value)}>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>}

      {session?.workspaces.some((workspace) => workspace.workspace_id === workspaceId && workspace.role === "owner") && workspaceBuildings.length > 0 && <section className="ledger-panel" aria-labelledby="create-project-title">
        <h2 id="create-project-title">Créer un chantier</h2>
        <form className="ledger-bar" onSubmit={createProject}>
          <label>Adresse<select name="buildingId" required>{workspaceBuildings.map((building) => <option key={building.building_id} value={building.building_id}>{building.building_label} — {building.address_line1}, {building.postal_code} {building.locality}</option>)}</select></label>
          <label>Nom du chantier<input name="name" required maxLength={200} placeholder="Travaux appartement" /></label>
          <button disabled={saving}>{saving ? "Enregistrement…" : "Créer le chantier"}</button>
        </form>
      </section>}

      {selectedProject && detail && <>
        <section className="ledger-panel" aria-labelledby="debours-balance-title">
          <h2 id="debours-balance-title">Situation du pot de débours — {selectedProject.name}</h2>
          <div className="ledger-bar" aria-live="polite">
            <p><strong>À restituer au propriétaire :</strong> {formatEuroCents(detail.summary.mandataryOwesOwnerCents)}</p>
            <p><strong>À rembourser au mandataire :</strong> {formatEuroCents(detail.summary.ownerOwesMandataryCents)}</p>
            <p><strong>Avances sans facture :</strong> {formatEuroCents(detail.summary.advanceAwaitingInvoiceCents)}</p>
            <p><strong>Paiements sans facture :</strong> {formatEuroCents(detail.summary.paymentsAwaitingInvoiceCents)}</p>
            <p><strong>Solde de trésorerie du pot :</strong> {formatEuroCents(detail.summary.cashHeldCents)}</p>
          </div>
          {!selectedProject.can_edit && <p role="note">Accès invité en lecture seule.</p>}
        </section>

        <details className="ledger-panel">
          <summary>Repères fiscaux officiels — chaque facture reste à qualifier</summary>
          <ul>
            <li>En régime réel, les charges déduites doivent notamment se rapporter à un bien relevant des revenus fonciers, être engagées pour acquérir ou conserver le revenu, effectivement supportées par le propriétaire, payées pendant l'année concernée et justifiées. Conserver mandat, facture fournisseur, preuve de paiement et rapprochement du pot.</li>
            <li>Pour un logement qui n'est pas encore loué, l'administration indique que les dépenses payées avant la location peuvent être déclarées sous conditions : annoncer clairement l'intention de location nue après travaux, louer après achèvement ou pouvoir prouver les démarches de recherche. Une absence de location effective peut entraîner une remise en cause ultérieure.</li>
            <li>Les remboursements de dépenses engagées par un mandataire sont un sujet distinct de déductibilité des revenus fonciers. L'exclusion de la base TVA pour les débours dépend notamment du mandat préalable, de l'action au nom et pour le compte du mandant, de la reddition de compte précise, de comptes de passage et des justificatifs exacts. La présence d'un mandat ne suffit donc pas à qualifier chaque dépense.</li>
          </ul>
          <p>Le registre de débours rapproche les flux et n'attribue aucun statut fiscal automatique.</p>
          <p><a href="https://www.impots.gouv.fr/particulier/questions/puis-je-deduire-les-travaux-effectues-dans-un-logement-qui-nest-pas-encore-en" target="_blank" rel="noreferrer">Impots.gouv.fr — travaux avant location</a> · <a href="https://bofip.impots.gouv.fr/bofip/3974-PGP.html/identifiant%3DBOI-RFPI-DECLA-20-20191113" target="_blank" rel="noreferrer">BOFiP — conditions des charges au régime réel</a> · <a href="https://bofip.impots.gouv.fr/bofip/1476-PGP.html/identifiant%3DBOI-TVA-BASE-10-20-40-30-20241009" target="_blank" rel="noreferrer">BOFiP — conditions TVA des débours</a></p>
        </details>

        {selectedProject.can_edit && <section className="ledger-panel" aria-labelledby="add-invoice-title">
          <h2 id="add-invoice-title">Ajouter une facture au chantier</h2>
          <form className="ledger-bar" onSubmit={createInvoice}>
            <label>Fournisseur<input name="supplier" required maxLength={300} /></label>
            <label>Numéro de facture<input name="invoiceNumber" maxLength={120} /></label>
            <label>Date de facture<input name="invoiceDate" type="date" /></label>
            <label>Total de la facture<input name="total" inputMode="decimal" required /></label>
            <label>Fichier facture<input name="invoiceFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /></label>
            <button disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer la facture"}</button>
          </form>
          <p>Le montant est saisi et reste à vérifier. Aucune lecture automatique n'est encore activée.</p>
        </section>}

        {selectedProject.can_edit && <section className="ledger-panel" aria-labelledby="add-movement-title">
          <h2 id="add-movement-title">Ajouter un mouvement</h2>
          <form className="ledger-bar" onSubmit={addMovement}>
            <label>Type<select name="type" defaultValue="advance">
              <option value="advance">Avance vers le mandataire</option><option value="reimbursement">Remboursement au mandataire</option>
              <option value="supplier_payment">Paiement fournisseur</option><option value="supplier_refund">Remboursement fournisseur</option>
              <option value="return">Restitution au propriétaire</option>
            </select></label>
            <label>Date<input name="occurredOn" type="date" defaultValue={localToday()} required /></label>
            <label>Montant<input name="amount" inputMode="decimal" required /></label>
            <label>Facture liée<select name="invoiceId" defaultValue=""><option value="">Aucune facture liée</option>{detail.invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.supplierName} — {formatEuroCents(invoice.totalCents)}</option>)}</select></label>
            <label>Preuve de virement ou justificatif<input name="proof" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" /></label>
            <label className="checkbox-label"><input name="paidInCash" type="checkbox" /> Paiement en liquide</label>
            <label>Note<input name="note" maxLength={1000} /></label>
            <button disabled={saving}>{saving ? "Enregistrement…" : "Ajouter le mouvement"}</button>
          </form>
        </section>}

        <section className="ledger-panel" aria-labelledby="project-invoices-title">
          <h2 id="project-invoices-title">Factures ({detail.invoices.length})</h2>
          {detail.invoices.length ? <div className="ledger-table"><table><thead><tr><th>Fournisseur</th><th>Référence</th><th>Date</th><th>Total</th><th>Facture</th></tr></thead><tbody>{detail.invoices.map((invoice) => <tr key={invoice.id}>
            <td>{invoice.supplierName}</td><td>{invoice.invoiceNumber || "—"}</td><td>{invoice.invoiceDate || "—"}</td><td>{formatEuroCents(invoice.totalCents)}</td>
            <td><a href={`/api/documents/${encodeURIComponent(invoice.documentId)}`} target="_blank" rel="noreferrer">Aperçu PDF/image</a> · À vérifier</td>
          </tr>)}</tbody></table></div> : <p>Aucune facture enregistrée pour ce chantier.</p>}
        </section>

        <section className="ledger-panel" aria-labelledby="movements-title">
          <h2 id="movements-title">Mouvements ({detail.movements.length})</h2>
          {detail.movements.length ? <div className="ledger-table"><table><thead><tr><th>Date</th><th>Mouvement</th><th>Montant</th><th>Facture / justificatif</th><th>Note</th></tr></thead><tbody>{detail.movements.map((movement) => <tr key={movement.id}>
            <td>{movement.occurredOn}</td><td>{movementLabel(movement.movementType)}{movement.paidInCash ? " · liquide" : ""}</td><td>{formatEuroCents(movement.amountCents)}</td>
            <td>{movement.invoiceId ? `${movement.supplierName ?? "Facture"}${movement.invoiceNumber ? ` · ${movement.invoiceNumber}` : ""}` : "Sans facture liée"}{movement.evidenceDocumentId && <> · <a href={`/api/documents/${encodeURIComponent(movement.evidenceDocumentId)}`} target="_blank" rel="noreferrer">Justificatif</a></>}{movement.invoiceDocumentId && <> · <a href={`/api/documents/${encodeURIComponent(movement.invoiceDocumentId)}`} target="_blank" rel="noreferrer">Facture</a></>}</td>
            <td>{movement.note || "—"}</td>
          </tr>)}</tbody></table></div> : <p>Aucun mouvement enregistré pour ce chantier.</p>}
        </section>
      </>}
      {projects.length === 0 && !loading && <p>Aucun chantier. Un propriétaire peut en créer un ci-dessus.</p>}
    </>
  );
}
