# Tax guardrails for the project and rental ledger

Checked against official French sources on 2026-11-22. This is a product-design note, not a tax opinion or a conclusion about the user's individual invoices.

## Debours and rental-income charges are separate questions

The debours screen reconciles amounts advanced, reimbursed, paid to suppliers, refunded, or returned. That cash position alone does not decide whether an expense is deductible from property income.

For the French real property-income regime, the administration describes general requirements that charges relate to property taxed as property income, be incurred to acquire or preserve that income, actually borne by the owner, paid in the relevant tax year, and supported by evidence. The application should therefore retain the underlying invoice, mandate or other authority, payment evidence, and a clear reconciliation rather than infer a tax category from the movement type.

Official reference: [BOFiP BOI-RFPI-DECLA-20, especially paragraphs 120 and 180](https://bofip.impots.gouv.fr/bofip/3974-PGP.html/identifiant=BOI-RFPI-DECLA-20-20191113).

## Property not rented yet

The official tax service says that some costs paid before a dwelling is first let may be reported when the owner clearly states the intention to rent it unfurnished after the work, lets it after completion or can evidence steps taken to find a tenant, and accepts that an absence of actual letting may later call the deficit into question. This is a fact-sensitive exception, not a blanket approval of all pre-letting renovation costs.

Official reference: [Impots.gouv.fr, work in a dwelling not yet rented, updated 10 July 2026](https://www.impots.gouv.fr/particulier/questions/puis-je-deduire-les-travaux-effectues-dans-un-logement-qui-nest-pas-encore-en).

The official guidance also distinguishes repair and maintenance, residential improvement, and construction/reconstruction/extension work; the latter are generally not deductible from property income under the ordinary rules. Classification depends on the actual work and evidence, not the contractor label alone.

Official reference: [Impots.gouv.fr, deductible property work](https://www.impots.gouv.fr/particulier/questions/quels-travaux-puis-je-deduire-de-mes-revenus-fonciers).

## TVA meaning of “débours”

The VAT exclusion for reimbursements to intermediaries is narrower and separate. BOFiP describes cumulative conditions: the intermediary acts under a prior explicit mandate in the name and for the account of the principal, gives an exact account, records the amounts in transit accounts, and can justify the nature and exact amount. A generic project balance or the existence of a signed mandate alone does not establish that every supplier expense qualifies.

Official references: [CGI Article 267, II, 2°](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006309428/) and [BOFiP BOI-TVA-BASE-10-20-40-30, updated 9 October 2024](https://bofip.impots.gouv.fr/bofip/1476-PGP.html/identifiant=BOI-TVA-BASE-10-20-40-30-20241009).

## Product behavior

- Keep cash movement types operational; never set `deductible=true` based only on a debours movement.
- Capture invoice, invoice date and amount, the payer and payment date, evidence or an explicit cash-paid flag, the mandate, and owner/mataire settlements as separate records.
- Mark extracted and manually entered invoice details for human review until confirmed.
- For common-area or address-wide work, keep address-level allocation possible; do not assume an apartment split. A later tax workflow should record allocation basis and supporting documents.
- Keep a dated source list and have tax classification and declaration exports reviewed before production use.
