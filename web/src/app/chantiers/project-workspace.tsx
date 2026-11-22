"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { formatEuroCents, parseEuroToCents } from "../../../../packages/domain/src/money.js";
import { extractInvoiceLocally, type InvoiceOcrResult } from "./invoice-ocr";

type Session = {
  workspaces: Array<{ workspace_id: string; workspace_name: string; role: "owner" | "administrator" }>;
  projects: Array<{ project_id: string; project_name: string; status: string }>;
  buildings: Array<{ workspace_id: string; building_id: string; building_label: string; address_line1: string; postal_code: string; locality: string }>;
};
type Project = { id: string; workspace_id: string; building_id: string; name: string; status: string; can_edit: boolean };
type InvoiceLine = { id: string; lineNumber: number; description: string; quantity: string | null; unit: string | null; unitPriceCents: number | null; amountBasis: "before_tax" | "after_tax" | "unknown"; taxRateBasisPoints: number | null; taxAmountCents: number | null; lineTotalCents: number | null; sourcePage: number | null; confidence: string | null; source: "native_pdf_text" | "local_ocr" | null; reviewStatus: "needs_review" | "confirmed" | "excluded" };
type Invoice = { id: string; supplierName: string; invoiceNumber: string | null; invoiceDate: string | null; totalCents: number; documentId: string; extractionStatus: string; lineItems: InvoiceLine[] };
type Movement = {
  id: string; movementType: string; occurredOn: string; amountCents: number; invoiceId: string | null;
  evidenceDocumentId: string | null; paidInCash: boolean; note: string | null; supplierName: string | null;
  invoiceNumber: string | null; invoiceTotalCents: number | null; invoiceDocumentId: string | null;
};
type ProjectInvitation = { id: string; email: string; expiresAt: string; acceptedAt: string | null; createdAt: string; userId: string | null };
type Detail = {
  project: Project;
  invoices: Invoice[];
  invoiceCount: number;
  movements: Movement[];
  summary: Record<string, number>;
};

function projectDetailUrl(projectId: string, search: string, min: string, max: string) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("q", search.trim());
  if (min.trim()) params.set("min", min.trim());
  if (max.trim()) params.set("max", max.trim());
  const suffix = params.toString();
  return `/api/projects/${encodeURIComponent(projectId)}/debours${suffix ? `?${suffix}` : ""}`;
}

async function jsonRequest(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "La requête n’a pas abouti.");
  return result;
}

function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function centsInput(value: number | null) {
  return value === null ? "" : `${Math.floor(value / 100)},${String(value % 100).padStart(2, "0")}`;
}

function optionalEuroInput(value: string) {
  return value.trim() ? parseEuroToCents(value) : null;
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
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceMin, setInvoiceMin] = useState("");
  const [invoiceMax, setInvoiceMax] = useState("");
  const [invoiceOcr, setInvoiceOcr] = useState<InvoiceOcrResult | null>(null);
  const [ocrProgress, setOcrProgress] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [invoiceFields, setInvoiceFields] = useState({ supplier: "", invoiceNumber: "", invoiceDate: "", total: "" });
  const [projectInvitations, setProjectInvitations] = useState<ProjectInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [createdInvitationUrl, setCreatedInvitationUrl] = useState("");
  const [createdInvitationEmail, setCreatedInvitationEmail] = useState("");
  const workspaceBuildings = session?.buildings.filter((building) => building.workspace_id === workspaceId) ?? [];
  const selectedProject = projects.find((project) => project.id === projectId);
  const visibleInvoices = detail?.invoices ?? [];

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
    if (!workspaceId && !session?.projects.length) return;
    let active = true;
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
    if (!projectId) return;
    let active = true;
    const timer = setTimeout(() => {
      jsonRequest(projectDetailUrl(projectId, invoiceSearch, invoiceMin, invoiceMax)).then((result: Detail) => {
        if (active) { setDetail(result); setError(""); }
      }).catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Débours indisponibles.");
      });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [projectId, invoiceSearch, invoiceMin, invoiceMax]);

  useEffect(() => {
    if (!projectId || !selectedProject?.can_edit) { setProjectInvitations([]); return; }
    let active = true;
    jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/invitations`).then((result: { invitations: ProjectInvitation[] }) => {
      if (active) setProjectInvitations(result.invitations);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Invitations indisponibles.");
    });
    return () => { active = false; };
  }, [projectId, selectedProject?.can_edit]);

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
    if (!response.ok) throw new Error(result.error || "Le document n’a pas été ajouté.");
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
      const invoice = await jsonRequest(`/api/projects/${encodeURIComponent(selectedProject.id)}/invoices`, "POST", {
        supplierName: invoiceFields.supplier,
        invoiceNumber: invoiceFields.invoiceNumber,
        invoiceDate: invoiceFields.invoiceDate,
        totalCents,
        documentId,
      }) as { id: string };
      if (invoiceOcr) {
        await jsonRequest(`/api/projects/${encodeURIComponent(selectedProject.id)}/invoices/${encodeURIComponent(invoice.id)}/ocr`, "POST", {
          recognizedText: invoiceOcr.recognizedText,
          pageCount: invoiceOcr.pages.length,
          lines: invoiceOcr.lines.slice(0, 200),
          extractedFields: {
            supplierName: invoiceOcr.supplierName,
            invoiceNumber: invoiceOcr.invoiceNumber,
            invoiceDate: invoiceOcr.invoiceDate,
            totalCents: invoiceOcr.totalCents,
          },
          reviewedFields: {
            supplierName: invoiceFields.supplier,
            invoiceNumber: invoiceFields.invoiceNumber,
            invoiceDate: invoiceFields.invoiceDate,
            totalCents,
          },
        });
      }
      setDetail(await jsonRequest(projectDetailUrl(selectedProject.id, invoiceSearch, invoiceMin, invoiceMax)));
      form.reset();
      setInvoiceFields({ supplier: "", invoiceNumber: "", invoiceDate: "", total: "" });
      setInvoiceOcr(null);
      setMessage("Facture enregistree. Verifiez les donnees et les lignes proposees avant de les confirmer.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement de la facture impossible."); }
    finally { setSaving(false); }
  }

  async function readInvoiceFile(file: File | null) {
    setInvoiceOcr(null);
    if (!file) return;
    setOcrBusy(true); setError(""); setMessage(""); setOcrProgress("Préparation de l’OCR local…");
    try {
      const result = await extractInvoiceLocally(file, setOcrProgress);
      setInvoiceOcr(result);
      setInvoiceFields((current) => ({
        supplier: current.supplier || result.supplierName,
        invoiceNumber: current.invoiceNumber || result.invoiceNumber,
        invoiceDate: current.invoiceDate || result.invoiceDate,
        total: current.total || (result.totalCents === null ? "" : `${Math.floor(result.totalCents / 100)},${String(result.totalCents % 100).padStart(2, "0")}`),
      }));
      setMessage(`OCR exécuté sur cet appareil. ${result.lines.length} ligne(s) produit/prestation détectée(s), à contrôler.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L’OCR local n’a pas pu lire ce fichier.");
    } finally { setOcrBusy(false); setOcrProgress(""); }
  }

  async function saveInvoiceLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const amountBasis = String(data.get("amountBasis"));
    const status = String(data.get("reviewStatus"));
    setSaving(true); setError(""); setMessage("");
    try {
      await jsonRequest(`/api/projects/${encodeURIComponent(selectedProject.id)}/invoices/${encodeURIComponent(String(data.get("invoiceId")))}/lines/${encodeURIComponent(String(data.get("lineId")))}`, "PATCH", {
        description: String(data.get("description")),
        quantity: String(data.get("quantity")) || null,
        unit: String(data.get("unit")) || null,
        unitPriceCents: optionalEuroInput(String(data.get("unitPrice"))),
        amountBasis,
        taxRateBasisPoints: String(data.get("taxRate")) === "" ? null : Math.round(Number(data.get("taxRate")) * 100),
        taxAmountCents: optionalEuroInput(String(data.get("taxAmount"))),
        lineTotalCents: optionalEuroInput(String(data.get("lineTotal"))),
        reviewStatus: status,
      });
      setDetail(await jsonRequest(projectDetailUrl(selectedProject.id, invoiceSearch, invoiceMin, invoiceMax)));
      setMessage("Ligne mise à jour; le statut de revue est enregistré.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "La correction de la ligne a échoué."); }
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
      setDetail(await jsonRequest(projectDetailUrl(selectedProject.id, invoiceSearch, invoiceMin, invoiceMax)));
      form.reset();
      setMessage("Mouvement de débours enregistré.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }

  async function inviteToProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) return;
    setSaving(true); setError(""); setMessage(""); setCreatedInvitationUrl("");
    try {
      const result = await jsonRequest(`/api/projects/${encodeURIComponent(selectedProject.id)}/invitations`, "POST", { email: inviteEmail }) as {
        id: string; email: string; expiresAt: string; invitationUrl: string;
      };
      setProjectInvitations((current) => [{ id: result.id, email: result.email, expiresAt: result.expiresAt, acceptedAt: null, createdAt: new Date().toISOString(), userId: null }, ...current]);
      setCreatedInvitationUrl(result.invitationUrl);
      setCreatedInvitationEmail(result.email);
      setInviteEmail("");
      setMessage("Invitation créée. Transmettez le lien uniquement à l’adresse invitée.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Création de l’invitation impossible."); }
    finally { setSaving(false); }
  }

  async function revokeProjectInvitation(invitationId: string) {
    if (!selectedProject) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await jsonRequest(`/api/projects/${encodeURIComponent(selectedProject.id)}/invitations/${encodeURIComponent(invitationId)}`, "DELETE");
      setProjectInvitations((current) => current.filter((invitation) => invitation.id !== invitationId));
      setMessage("Invitation en attente révoquée.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Révocation impossible."); }
    finally { setSaving(false); }
  }

  async function revokeProjectMember(userId: string) {
    if (!selectedProject) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await jsonRequest(`/api/projects/${encodeURIComponent(selectedProject.id)}/members/${encodeURIComponent(userId)}`, "DELETE");
      setProjectInvitations((current) => current.map((invitation) => invitation.userId === userId ? { ...invitation, userId: null } : invitation));
      setMessage("Accès retiré de ce chantier.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Retrait de l'accès impossible."); }
    finally { setSaving(false); }
  }

  async function copyInvitationLink() {
    if (!createdInvitationUrl) return;
    try {
      await navigator.clipboard.writeText(createdInvitationUrl);
      setMessage("Lien copié.");
    } catch {
      setError("Copie impossible. Sélectionnez le lien et copiez-le manuellement.");
    }
  }

  if (loading && !session) return <p role="status">Chargement des chantiers.</p>;
  return (
    <>
      {error && <p role="alert" className="ledger-error">{error}</p>}
      {message && <p role="status">{message}</p>}
      {session?.workspaces.length ? <div className="ledger-bar">
        <label>Espace de travail<select value={workspaceId} disabled={saving} onChange={(event) => { setLoading(true); setWorkspaceId(event.target.value); setDetail(null); }}>
          {session.workspaces.map((workspace) => <option key={workspace.workspace_id} value={workspace.workspace_id}>{workspace.workspace_name}</option>)}
        </select></label>
        {projects.length > 0 && <label>Chantier<select value={projectId} disabled={saving} onChange={(event) => { setDetail(null); setProjectId(event.target.value); }}>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>}
      </div> : session?.projects.length ? <p>Projets auxquels ce compte a accès :</p> : <p>Aucun espace ou chantier n&apos;est associé à ce compte.</p>}
      {!session?.workspaces.length && projects.length > 0 && <label>Chantier<select value={projectId} disabled={saving} onChange={(event) => { setDetail(null); setProjectId(event.target.value); }}>
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

        {selectedProject.can_edit && <section className="ledger-panel" aria-labelledby="project-invitations-title">
          <h2 id="project-invitations-title">Accès invités à ce chantier</h2>
          <form className="ledger-bar" onSubmit={inviteToProject}>
            <label>Adresse e-mail<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required maxLength={320} /></label>
            <button disabled={saving || !inviteEmail.trim()}>{saving ? "Création…" : "Créer une invitation"}</button>
          </form>
          <p role="note">L’adresse doit aussi être autorisée dans la politique Cloudflare Access du site. L’invité ne verra que ce chantier et y disposera d’un accès en lecture seule.</p>
          {createdInvitationUrl && <div className="ledger-bar">
            <label>Lien à transmettre<input readOnly value={createdInvitationUrl} onFocus={(event) => event.currentTarget.select()} /></label>
            <button type="button" onClick={() => void copyInvitationLink()}>Copier le lien</button>
            <a href={`mailto:${encodeURIComponent(createdInvitationEmail)}?subject=${encodeURIComponent(`Invitation au chantier ${selectedProject.name}`)}&body=${encodeURIComponent(`Acceptez l'invitation avec ce lien : ${createdInvitationUrl}`)}`}>Préparer un e-mail</a>
          </div>}
          {projectInvitations.length ? <ul>{projectInvitations.map((invitation) => <li key={invitation.id}>
            {invitation.email} — {invitation.acceptedAt ? invitation.userId ? "Acceptée" : "Accès retiré" : new Date(invitation.expiresAt) <= new Date() ? "Expirée" : "En attente"}
            {!invitation.acceptedAt && <button type="button" disabled={saving} onClick={() => void revokeProjectInvitation(invitation.id)}>Révoquer</button>}
            {invitation.acceptedAt && invitation.userId && <button type="button" disabled={saving} onClick={() => void revokeProjectMember(invitation.userId!)}>Retirer l'accès</button>}
          </li>)}</ul> : <p>Aucune invitation créée pour ce chantier.</p>}
        </section>}

        <details className="ledger-panel">
          <summary>Repères fiscaux officiels — chaque facture reste à qualifier</summary>
          <ul>
            <li>En régime réel, les charges déduites doivent notamment se rapporter à un bien relevant des revenus fonciers, être engagées pour acquérir ou conserver le revenu, effectivement supportées par le propriétaire, payées pendant l&apos;année concernée et justifiées. Conserver mandat, facture fournisseur, preuve de paiement et rapprochement du pot.</li>
            <li>Pour un logement qui n&apos;est pas encore loué, l&apos;administration indique que les dépenses payées avant la location peuvent être déclarées sous conditions : annoncer clairement l&apos;intention de location nue après travaux, louer après achèvement ou pouvoir prouver les démarches de recherche. Une absence de location effective peut entraîner une remise en cause ultérieure</li>
            <li>Les remboursements de dépenses engagées par un mandataire sont un sujet distinct de déductibilité des revenus fonciers. L&apos;exclusion de la base TVA pour les débours dépend notamment du mandat préalable, de l&apos;action au nom et pour le compte du mandant, de la reddition de compte précise, de comptes de passage et des justificatifs exacts. La présence d&apos;un mandat ne suffit donc pas à qualifier chaque dépense</li>
          </ul>
          <p>Le registre de débours rapproche les flux et n&apos;attribue aucun statut fiscal automatique.</p>
          <p><a href="https://www.impots.gouv.fr/particulier/questions/puis-je-deduire-les-travaux-effectues-dans-un-logement-qui-nest-pas-encore-en" target="_blank" rel="noreferrer">Impots.gouv.fr — travaux avant location</a> · <a href="https://bofip.impots.gouv.fr/bofip/3974-PGP.html/identifiant%3DBOI-RFPI-DECLA-20-20191113" target="_blank" rel="noreferrer">BOFiP — conditions des charges au régime réel</a> · <a href="https://bofip.impots.gouv.fr/bofip/1476-PGP.html/identifiant%3DBOI-TVA-BASE-10-20-40-30-20241009" target="_blank" rel="noreferrer">BOFiP — conditions TVA des débours</a></p>
        </details>

        {selectedProject.can_edit && <section className="ledger-panel" aria-labelledby="add-invoice-title">
          <h2 id="add-invoice-title">Ajouter une facture au chantier</h2>
          <form className="ledger-bar" onSubmit={createInvoice}>
            <label>Fournisseur<input name="supplier" value={invoiceFields.supplier} onChange={(event) => setInvoiceFields((current) => ({ ...current, supplier: event.target.value }))} required maxLength={300} /></label>
            <label>Numéro de facture<input name="invoiceNumber" value={invoiceFields.invoiceNumber} onChange={(event) => setInvoiceFields((current) => ({ ...current, invoiceNumber: event.target.value }))} maxLength={120} /></label>
            <label>Date de facture<input name="invoiceDate" type="date" value={invoiceFields.invoiceDate} onChange={(event) => setInvoiceFields((current) => ({ ...current, invoiceDate: event.target.value }))} /></label>
            <label>Total de la facture<input name="total" inputMode="decimal" value={invoiceFields.total} onChange={(event) => setInvoiceFields((current) => ({ ...current, total: event.target.value }))} required /></label>
            <label>Fichier facture<input name="invoiceFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { void readInvoiceFile(event.currentTarget.files?.[0] ?? null); }} required /></label>
            <button disabled={saving || ocrBusy}>{saving ? "Enregistrement…" : ocrBusy ? "Lecture OCR en cours…" : "Enregistrer la facture"}</button>
          </form>
          {ocrProgress && <p role="status">{ocrProgress}</p>}
          <p>OCR dans le navigateur. Contrôlez et corrigez les champs avant la sauvegarde; les valeurs reconnues restent à confirmer.</p>
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
          <h2 id="project-invoices-title">Factures ({visibleInvoices.length}{visibleInvoices.length !== detail.invoiceCount ? ` / ${detail.invoiceCount}` : ""})</h2>
          <div className="ledger-bar" role="search" aria-label="Rechercher une facture ou une ligne">
            <label>Fournisseur, référence ou produit<input value={invoiceSearch} onChange={(event) => setInvoiceSearch(event.target.value)} placeholder="Ex. peinture, fournisseur, référence" /></label>
            <label>Montant min. (€)<input inputMode="decimal" value={invoiceMin} onChange={(event) => setInvoiceMin(event.target.value)} /></label>
            <label>Montant max. (€)<input inputMode="decimal" value={invoiceMax} onChange={(event) => setInvoiceMax(event.target.value)} /></label>
          </div>
          {visibleInvoices.length ? <div className="ledger-table"><table><thead><tr><th>Fournisseur</th><th>Référence</th><th>Date</th><th>Total</th><th>Document</th><th>Lignes reconnues</th></tr></thead><tbody>{visibleInvoices.map((invoice) => <tr key={invoice.id}>
            <td>{invoice.supplierName}</td><td>{invoice.invoiceNumber || "-"}</td><td>{invoice.invoiceDate || "-"}</td><td>{formatEuroCents(invoice.totalCents)}</td>
            <td><a href={`/api/documents/${encodeURIComponent(invoice.documentId)}`} target="_blank" rel="noreferrer">Prévisualiser</a> · à vérifier</td>
            <td><details><summary>{invoice.lineItems.length} ligne(s)</summary>
              {invoice.lineItems.length ? <div className="ledger-table"><table><thead><tr><th>Ligne</th><th>Désignation</th><th>Quantité</th><th>Prix unitaire</th><th>Total ligne</th><th>Base</th><th>Origine / confiance</th><th>Revue</th><th>Action</th></tr></thead><tbody>{invoice.lineItems.map((line) => <tr key={line.id}>
                <td>{line.lineNumber}{line.sourcePage ? ` · p. ${line.sourcePage}` : ""}</td><td>{line.description}</td>
                <td>{line.quantity ? `${line.quantity}${line.unit ? ` ${line.unit}` : ""}` : "-"}</td>
                <td>{line.unitPriceCents === null ? "-" : formatEuroCents(line.unitPriceCents)}</td>
                <td>{line.lineTotalCents === null ? "-" : formatEuroCents(line.lineTotalCents)}</td>
                <td>{line.amountBasis === "before_tax" ? "HT" : line.amountBasis === "after_tax" ? "TTC" : "à préciser"}</td>
                <td>{line.source === "native_pdf_text" ? "Texte PDF" : line.source === "local_ocr" ? "OCR local" : "Inconnu"}{line.confidence !== null ? ` · ${Math.round(Number(line.confidence) * 100)} %` : ""}</td>
                <td>{line.reviewStatus === "confirmed" ? "Confirmée" : line.reviewStatus === "excluded" ? "Exclue" : "À vérifier"}</td>
<td>{selectedProject.can_edit && <details><summary>Corriger</summary><form className="ledger-bar" onSubmit={saveInvoiceLine}>
<input type="hidden" name="invoiceId" value={invoice.id} /><input type="hidden" name="lineId" value={line.id} />
<label>Désignation<input name="description" defaultValue={line.description} required maxLength={500} /></label>
<label>Quantité<input name="quantity" inputMode="decimal" defaultValue={line.quantity ?? ""} /></label>
<label>Unité<input name="unit" defaultValue={line.unit ?? ""} maxLength={50} /></label>
<label>Prix unitaire (€)<input name="unitPrice" inputMode="decimal" defaultValue={centsInput(line.unitPriceCents)} /></label>
<label>Total ligne (€)<input name="lineTotal" inputMode="decimal" defaultValue={centsInput(line.lineTotalCents)} /></label>
<label>Base<select name="amountBasis" defaultValue={line.amountBasis}><option value="unknown">À préciser</option><option value="before_tax">HT</option><option value="after_tax">TTC</option></select></label>
<label>Taxe (%)<input name="taxRate" inputMode="decimal" defaultValue={line.taxRateBasisPoints === null ? "" : String(line.taxRateBasisPoints / 100)} /></label>
<label>Montant taxe (€)<input name="taxAmount" inputMode="decimal" defaultValue={centsInput(line.taxAmountCents)} /></label>
<label>Revue<select name="reviewStatus" defaultValue={line.reviewStatus}><option value="needs_review">À vérifier</option><option value="confirmed">Confirmer</option><option value="excluded">Exclure</option></select></label>
<button disabled={saving}>Enregistrer</button></form></details>}</td>
              </tr>)}</tbody></table></div> : <p>Aucune ligne extraite pour le moment.</p>}
            </details></td>
          </tr>)}</tbody></table></div> : <p>{detail.invoices.length ? "Aucune facture ne correspond à ces filtres." : "Aucune facture enregistrée pour ce chantier."}</p>}
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
