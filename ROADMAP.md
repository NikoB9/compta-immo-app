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

Le plan d’origine est maintenant réintégré dans [`docs/superpowers/plans/2026-11-21-web-foundation.md`](docs/superpowers/plans/2026-11-21-web-foundation.md). Il couvre aussi le registre annuel, le modèle d’accès, les débours, les mandats/signatures, les intégrations de stockage, les contrôles fiscaux et le déploiement.

L’OCR doit extraire toutes les lignes détectées (désignation, quantité, unité, prix unitaire, taux de taxe et total de ligne lorsque présents), garder les propositions modifiables avec leur provenance/confiance, puis permettre la recherche et le filtrage des factures et lignes par texte et montant. Aucune donnée absente ne doit être inventée; l’OCR ne confirme ni la facture ni son traitement fiscal.

Un export ZIP de chantier est maintenant disponible pour les propriétaires et les invités affectés : index JSON, registre CSV des factures et mouvements, données de mandat/signature et pièces justificatives vérifiées par taille et SHA-256. Les limites sont de 100 pièces et 100 Mio par archive. Les prochaines briques sont le cycle de vie des preuves de paiement, la génération versionnée de PDF de mandat, la synchronisation de fournisseurs et le déploiement Proxmox.
