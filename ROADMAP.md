# Plan de travail — compta-immo-app

> Le dépôt vient d’être créé et ne contenait pas de plan antérieur. Ce document consigne les décisions fonctionnelles récupérables dans le projet ; il ne prétend pas reconstituer les étapes détaillées qui ne sont pas disponibles ici. Les étapes antérieures du plan d’origine restent à réintégrer lorsqu’elles seront accessibles.

## Périmètre confirmé

- Construire une application web progressive (PWA) de gestion comptable immobilière, modulaire pour plusieurs biens.
- Utiliser Saint-Flo comme premier cas d’usage, sans limiter l’application à ce bien.
- Garder les factures et les données de la base sur les serveurs de l’application. Le dépôt GitHub public ne doit contenir que le code et la documentation, jamais de factures ni de données personnelles ou comptables.

## Étapes fonctionnelles connues

1. **Socle de l’application** — définir l’architecture PWA modulaire et le périmètre multi-biens.
2. **Factures et OCR** — permettre l’intégration des factures et l’extraction de leurs données par OCR.
3. **Lignes de produits et recherche filtrée — étape ajoutée** — pendant l’OCR, extraire toutes les lignes de produits présentes sur la facture et conserver chaque ligne liée à sa facture. Présenter ce détail dans le tableau des factures ou dans son détail. Ajouter une recherche filtrée qui permet de retrouver rapidement une facture ou un montant, notamment à partir d’un produit et des informations de facture disponibles. Les données absentes du document ne doivent pas être inventées.

## À compléter

Réintégrer les autres étapes du plan d’origine dès que sa version détaillée sera disponible, sans supprimer les exigences consignées ci-dessus.
