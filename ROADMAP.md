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

## État du plan avant livraison

### Réalisé sur `main`

- Socle Next.js auto-hébergé, registre annuel et import/export CSV.
- Factures privées, extraction OCR locale, lignes de produits modifiables et recherche par texte/montant.
- Chantiers, rapprochement des débours, justificatifs, invitations invité/propriétaire et export ZIP.
- Mandats, PDF versionnés, signature applicative par partie et image visuelle facultative par signataire.
- Schéma PostgreSQL, migrations, politiques RLS et workflow CI ; configuration Docker Compose et procédure de déploiement générique.
- Sauvegarde cohérente de la base et des justificatifs, restauration dans une base/volume de staging séparés et analyse ClamAV de chaque pièce avant enregistrement. Ces chemins ne sont pas exécutés dans l’environnement actuel ; restauration, verdict EICAR, mise à jour des signatures et panne du scanner restent à valider sur l’hôte cible.

### Bloquants avant un pilote avec les vraies données

1. Exécuter le déploiement sur l’hôte prévu : Cloudflare Access, secrets, migrations, rôles, propriétaire initial et règles d’accès aux invités.
2. Faire un test de bout en bout avec données fictives sur PostgreSQL et le volume privé : propriétaire, invité, OCR, import/export, signatures, export ZIP et pièces.
3. Exécuter la restauration staging sur l’hôte cible et vérifier les données, les documents, les permissions et les parcours dans l’application.
4. Vérifier l’analyse antivirus (détection EICAR, mises à jour, panne en échec fermé), définir la rétention des pièces, chiffrer les sauvegardes, en conserver une copie hors site et surveiller les erreurs.
5. Vérifier l’accessibilité et l’usage mobile ; le manifeste PWA existe, mais aucun fonctionnement hors ligne n’est fourni.
6. Rapprocher le registre du classeur existant et faire valider les traitements et exports fiscaux par une personne compétente avant de s’en servir pour une déclaration.
7. Faire relire le mandat à utiliser et confirmer le niveau de signature requis. L’image signée dans l’application est visuelle ; aucun prestataire de signature qualifiée n’est intégré.

### Extensions prévues, après arbitrage

- Synchronisation de stockage (Microsoft en premier, puis Google Drive/SFTP) : connecteurs, comptes et règles de conflits restent à définir.
- Fournisseur spécialisé de signature : à choisir après validation juridique du besoin.
- Service worker et accès hors ligne : seulement après définition de ce qui peut être disponible hors ligne sans exposer les données privées.

## Éléments fonctionnels détaillés

Le plan fonctionnel détaillé est dans [`docs/superpowers/plans/2026-11-21-web-foundation.md`](docs/superpowers/plans/2026-11-21-web-foundation.md). Il couvre aussi le registre annuel, le modèle d’accès, les débours, les mandats/signatures, les intégrations de stockage, les contrôles fiscaux et le déploiement.

L’OCR doit extraire toutes les lignes détectées (désignation, quantité, unité, prix unitaire, taux de taxe et total de ligne lorsque présents), garder les propositions modifiables avec leur provenance/confiance, puis permettre la recherche et le filtrage des factures et lignes par texte et montant. Aucune donnée absente ne doit être inventée; l’OCR ne confirme ni la facture ni son traitement fiscal.

Les chantiers disposent d’un export ZIP privé avec index JSON, registre CSV des factures et mouvements, PDF versionné de chaque mandat et pièces justificatives vérifiées par taille et SHA-256. La limite est de 100 pièces/mandats combinés et 100 Mio. Les propriétaires peuvent ajouter, remplacer ou retirer le justificatif d’un mouvement après sa saisie ; chaque changement conserve le fichier précédent et une trace d’audit. Chaque signataire peut ajouter sa propre image JPEG, PNG ou WebP à la signature, avec conservation privée et trace d’audit.
