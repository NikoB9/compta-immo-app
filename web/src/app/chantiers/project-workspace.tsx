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
type InvoiceLine = { id: string; lineNumber: number; description: string; quantity: string | null; unit: string | null; unitPriceCents: number | null; amountBasis: "before_tax" | "after_tax" | "unknown"; taxRateBasisPoints: number | null; taxAmountCents: number | null; lineTotalCents: number | null; sourcePage: number | null; confidence: string | null; reviewStatus: "needs_review" | "confirmed" | "excluded" };
type Invoice = { id: string; supplierName: string; invoiceNumber: string | null; invoiceDate: string | null; totalCents: number; documentId: string; extractionStatus: string; lineItems: InvoiceLine[] };
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
  if (!response.ok) throw new Error(result.error || "La requ�te n'a pas abouti.");
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
    return: "Restitution au propri�taire",
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
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceMin, setInvoiceMin] = useState("");
  const [invoiceMax, setInvoiceMax] = useState("");
  const workspaceBuildings = session?.buildings.filter((building) => building.workspace_id === workspaceId) ?? [];
  const selectedProject = projects.find((project) => project.id === projectId);
  const visibleInvoices = (detail?.invoices ?? []).filter((invoice) => {
    const query = invoiceSearch.trim().toLocaleLowerCase("fr");
    const text = [invoice.supplierName, invoice.invoiceNumber ?? "", ...invoice.lineItems.map((line) => line.description)].join(" ").toLocaleLowerCase("fr");
    const min = invoiceMin.trim() ? Number(invoiceMin.replace(",", ".")) * 100 : null;
    const max = invoiceMax.trim() ? Number(invoiceMax.replace(",", ".")) * 100 : null;
    const hasAmountFilter = min !== null || max !== null;
    const inRange = (amount: number) => (min === null || amount >= min) && (max === null || amount <= max);
    const amountMatches = !hasAmountFilter || inRange(invoice.totalCents)
      || invoice.lineItems.some((line) => line.lineTotalCents !== null && inRange(line.lineTotalCents));
    return (!query || text.includes(query)) && amountMatches;
  });

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
      if (active) setError(cause instanceof Error ? cause.message : "D�bours indisponibles.");
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
      setMessage("Chantier cr��.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Cr�ation impossible."); }
    finally { setSaving(false); }
  }

  async function uploadToProject(file: File) {
    if (!selectedProject || !workspaceId) throw new Error("S�lectionnez un chantier.");
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
    if (!response.ok) throw new Error(result.error || "Le document n'a pas �t� ajout�.");
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
    catch { setError("Saisissez le montant positif de la facture, avec deux d�cimales au maximum."); return; }
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
      setMessage("Facture enregistr�e pour v�rification. Le montant est saisi manuellement � ce stade.");
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
    catch { setError("Saisissez un montant positif, avec deux d�cimales au maximum."); return; }
    const file = data.get("proof");
    const paidInCash = data.get("paidInCash") === "on";
    if (paidInCash && file instanceof File && file.size) { setError("Ne joignez pas une preuve de virement � un paiement liquide."); return; }
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
      setMessage("Mouvement de d�bours enregistr�.");
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
      </div> : session?.projects.length ? <p>Projets auxquels ce compte a acc�s :</p> : <p>Aucun espace ou chantier n'est associ� � ce compte.</p>}
      {!session?.workspaces.length && projects.length > 0 && <label>Chantier<select value={projectId} disabled={saving} onChange={(event) => setProjectId(event.target.value)}>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>}

      {session?.workspaces.some((workspace) => workspace.workspace_id === workspaceId && workspace.role === "owner") && workspaceBuildings.length > 0 && <section className="ledger-panel" aria-labelledby="create-project-title">
        <h2 id="create-project-title">Cr�er un chantier</h2>
        <form className="ledger-bar" onSubmit={createProject}>
          <label>Adresse<select name="buildingId" required>{workspaceBuildings.map((building) => <option key={building.building_id} value={building.building_id}>{building.building_label} - {building.address_line1}, {building.postal_code} {building.locality}</option>)}</select></label>
          <label>Nom du chantier<input name="name" required maxLength={200} placeholder="Travaux appartement" /></label>
          <button disabled={saving}>{saving ? "Enregistrement." : "Cr�er le chantier"}</button>
        </form>
      </section>}

      {selectedProject && detail && <>
        <section className="ledger-panel" aria-labelledby="debours-balance-title">
          <h2 id="debours-balance-title">Situation du pot de d�bours - {selectedProject.name}</h2>
          <div className="ledger-bar" aria-live="polite">
            <p><strong>� restituer au propri�taire :</strong> {formatEuroCents(detail.summary.mandataryOwesOwnerCents)}</p>
            <p><strong>� rembourser au mandataire :</strong> {formatEuroCents(detail.summary.ownerOwesMandataryCents)}</p>
            <p><strong>Avances sans facture :</strong> {formatEuroCents(detail.summary.advanceAwaitingInvoiceCents)}</p>
            <p><strong>Paiements sans facture :</strong> {formatEuroCents(detail.summary.paymentsAwaitingInvoiceCents)}</p>
            <p><strong>Solde de tr�sorerie du pot :</strong> {formatEuroCents(detail.summary.cashHeldCents)}</p>
          </div>
          {!selectedProject.can_edit && <p role="note">Acc�s invit� en lecture seule.</p>}
        </section>

        <details className="ledger-panel">
          <summary>Rep�res fiscaux officiels - chaque facture reste � qualifier</summary>
          <ul>
            <li>En r�gime r�el, les charges d�duites doivent notamment se rapporter � un bien relevant des revenus fonciers, �tre engag�es pour acqu�rir ou conserver le revenu, effectivement support�es par le propri�taire, pay�es pendant l'ann�e concern�e et justifi�es. Conserver mandat, facture fournisseur, preuve de paiement et rapprochement du pot.</li>
            <li>Pour un logement qui n'est pas encore lou�, l'administration indique que les d�penses pay�es avant la location peuvent �tre d�clar�es sous conditions : annoncer clairement l'intention de location nue apr�s travaux, louer apr�s ach�vement ou pouvoir prouver les d�marches de recherche. Une absence de location effective peut entra�ner une remise en cause ult�rieure.</li>
            <li>Les remboursements de d�penses engag�es par un mandataire sont un sujet distinct de d�ductibilit� des revenus fonciers. L'exclusion de la base TVA pour les d�bours d�pend notamment du mandat pr�alable, de l'action au nom et pour le compte du mandant, de la reddition de compte pr�cise, de comptes de passage et des justificatifs exacts. La pr�sence d'un mandat ne suffit donc pas � qualifier chaque d�pense.</li>
          </ul>
          <p>Le registre de d�bours rapproche les flux et n'attribue aucun statut fiscal automatique.</p>
          <p><a href="https://www.impots.gouv.fr/particulier/questions/puis-je-deduire-les-travaux-effectues-dans-un-logement-qui-nest-pas-encore-en" target="_blank" rel="noreferrer">Impots.gouv.fr - travaux avant location</a> � <a href="https://bofip.impots.gouv.fr/bofip/3974-PGP.html/identifiant%3DBOI-RFPI-DECLA-20-20191113" target="_blank" rel="noreferrer">BOFiP - conditions des charges au r�gime r�el</a> � <a href="https://bofip.impots.gouv.fr/bofip/1476-PGP.html/identifiant%3DBOI-TVA-BASE-10-20-40-30-20241009" target="_blank" rel="noreferrer">BOFiP - conditions TVA des d�bours</a></p>
        </details>

        {selectedProject.can_edit && <section className="ledger-panel" aria-labelledby="add-invoice-title">
          <h2 id="add-invoice-title">Ajouter une facture au chantier</h2>
          <form className="ledger-bar" onSubmit={createInvoice}>
            <label>Fournisseur<input name="supplier" required maxLength={300} /></label>
            <label>Num�ro de facture<input name="invoiceNumber" maxLength={120} /></label>
            <label>Date de facture<input name="invoiceDate" type="date" /></label>
            <label>Total de la facture<input name="total" inputMode="decimal" required /></label>
            <label>Fichier facture<input name="invoiceFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /></label>
            <button disabled={saving}>{saving ? "Enregistrement." : "Enregistrer la facture"}</button>
          </form>
          <p>Le montant est saisi et reste � v�rifier. Aucune lecture automatique n'est encore activ�e.</p>
        </section>}

        {selectedProject.can_edit && <section className="ledger-panel" aria-labelledby="add-movement-title">
          <h2 id="add-movement-title">Ajouter un mouvement</h2>
          <form className="ledger-bar" onSubmit={addMovement}>
            <label>Type<select name="type" defaultValue="advance">
              <option value="advance">Avance vers le mandataire</option><option value="reimbursement">Remboursement au mandataire</option>
              <option value="supplier_payment">Paiement fournisseur</option><option value="supplier_refund">Remboursement fournisseur</option>
              <option value="return">Restitution au propri�taire</option>
            </select></label>
            <label>Date<input name="occurredOn" type="date" defaultValue={localToday()} required /></label>
            <label>Montant<input name="amount" inputMode="decimal" required /></label>
            <label>Facture li�e<select name="invoiceId" defaultValue=""><option value="">Aucune facture li�e</option>{detail.invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.supplierName} - {formatEuroCents(invoice.totalCents)}</option>)}</select></label>
            <label>Preuve de virement ou justificatif<input name="proof" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" /></label>
            <label className="checkbox-label"><input name="paidInCash" type="checkbox" /> Paiement en liquide</label>
            <label>Note<input name="note" maxLength={1000} /></label>
            <button disabled={saving}>{saving ? "Enregistrement." : "Ajouter le mouvement"}</button>
          </form>
        </section>}

        <section className="ledger-panel" aria-labelledby="project-invoices-title">
          <h2 id="project-invoices-title">Factures ({visibleInvoices.length}{visibleInvoices.length !== detail.invoices.length ? ` / ${detail.invoices.length}` : ""})</h2>
          <div className="ledger-bar" role="search" aria-label="Rechercher une facture ou une ligne">
            <label>Fournisseur, r�f�rence ou produit<input value={invoiceSearch} onChange={(event) => setInvoiceSearch(event.target.value)} placeholder="Ex. peinture, fournisseur, r�f�rence" /></label>
            <label>Montant min. (?)<input inputMode="decimal" value={invoiceMin} onChange={(event) => setInvoiceMin(event.target.value)} /></label>
            <label>Montant max. (?)<input inputMode="decimal" value={invoiceMax} onChange={(event) => setInvoiceMax(event.target.value)} /></label>
          </div>
          {visibleInvoices.length ? <div className="ledger-table"><table><thead><tr><th>Fournisseur</th><th>R�f�rence</th><th>Date</th><th>Total</th><th>Document</th><th>Lignes reconnues</th></tr></thead><tbody>{visibleInvoices.map((invoice) => <tr key={invoice.id}>
            <td>{invoice.supplierName}</td><td>{invoice.invoiceNumber || "-"}</td><td>{invoice.invoiceDate || "-"}</td><td>{formatEuroCents(invoice.totalCents)}</td>
            <td><a href={`/api/documents/${encodeURIComponent(invoice.documentId)}`} target="_blank" rel="noreferrer">Pr�visualiser</a> � � v�rifier</td>
            <td><details><summary>{invoice.lineItems.length} ligne(s)</summary>
              {invoice.lineItems.length ? <div className="ledger-table"><table><thead><tr><th>Ligne</th><th>D�signation</th><th>Quantit�</th><th>Prix unitaire</th><th>Total ligne</th><th>Base</th><th>Revue</th></tr></thead><tbody>{invoice.lineItems.map((line) => <tr key={line.id}>
                <td>{line.lineNumber}{line.sourcePage ? ` � p. ${line.sourcePage}` : ""}</td><td>{line.description}</td>
                <td>{line.quantity ? `${line.quantity}${line.unit ? ` ${line.unit}` : ""}` : "-"}</td>
                <td>{line.unitPriceCents === null ? "-" : formatEuroCents(line.unitPriceCents)}</td>
                <td>{line.lineTotalCents === null ? "-" : formatEuroCents(line.lineTotalCents)}</td>
                <td>{line.amountBasis === "before_tax" ? "HT" : line.amountBasis === "after_tax" ? "TTC" : "� pr�ciser"}</td>
                <td>{line.reviewStatus === "confirmed" ? "Confirm�e" : line.reviewStatus === "excluded" ? "Exclue" : "� v�rifier"}</td>
              </tr>)}</tbody></table></div> : <p>Aucune ligne extraite pour le moment.</p>}
            </details></td>
          </tr>)}</tbody></table></div> : <p>{detail.invoices.length ? "Aucune facture ne correspond � ces filtres." : "Aucune facture enregistr�e pour ce chantier."}</p>}
        </section>
        <section className="ledger-panel" aria-labelledby="movements-title">
          <h2 id="movements-title">Mouvements ({detail.movements.length})</h2>
          {detail.movements.length ? <div className="ledger-table"><table><thead><tr><th>Date</th><th>Mouvement</th><th>Montant</th><th>Facture / justificatif</th><th>Note</th></tr></thead><tbody>{detail.movements.map((movement) => <tr key={movement.id}>
            <td>{movement.occurredOn}</td><td>{movementLabel(movement.movementType)}{movement.paidInCash ? " � liquide" : ""}</td><td>{formatEuroCents(movement.amountCents)}</td>
            <td>{movement.invoiceId ? `${movement.supplierName ?? "Facture"}${movement.invoiceNumber ? ` � ${movement.invoiceNumber}` : ""}` : "Sans facture li�e"}{movement.evidenceDocumentId && <> � <a href={`/api/documents/${encodeURIComponent(movement.evidenceDocumentId)}`} target="_blank" rel="noreferrer">Justificatif</a></>}{movement.invoiceDocumentId && <> � <a href={`/api/documents/${encodeURIComponent(movement.invoiceDocumentId)}`} target="_blank" rel="noreferrer">Facture</a></>}</td>
            <td>{movement.note || "-"}</td>
          </tr>)}</tbody></table></div> : <p>Aucun mouvement enregistr� pour ce chantier.</p>}
        </section>
      </>}
      {projects.length === 0 && !loading && <p>Aucun chantier. Un propri�taire peut en cr�er un ci-dessus.</p>}
    </>
  );
}
