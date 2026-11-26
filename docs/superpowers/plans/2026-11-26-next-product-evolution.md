# Plan d’évolution — mandats, factures et recherche documentaire

**Statut :** proposition, prête à découper en lots après validation de la règle comptable des factures.
**Base examinée :** `main` au commit `3abec11`.

## Objectif

Faire des biens, factures et chantiers une chaîne cohérente : les informations déjà connues préremplissent les mandats, une facture est saisie une fois et retrouvée dans les vues comptables et chantier appropriées, et la recherche retrouve aussi son texte OCRisé. Les données proposées par OCR restent à vérifier et aucune catégorie ni déductibilité fiscale n’est confirmée automatiquement.

## État existant à conserver

- La fiche de compte possède un nom affiché et un e-mail vérifié par Cloudflare Access; l’espace possède un nom. Les adresses et lots se gèrent après la configuration initiale.
- La comptabilité annuelle permet les écritures manuelles, les pièces jointes et l’import/export CSV.
- Le chantier a ses factures, son OCR local de PDF et images, ses lignes éditables/revisables, ses paiements et son rapprochement de débours.
- Une recherche limitée au chantier couvre le fournisseur, la référence et les descriptions des lignes OCRisées, avec filtres de montant.
- Les mandats ont brouillon, signature liée au compte, verrouillage à la première signature et PDF versionné. Les signatures déjà enregistrées doivent rester vérifiables.

## Écarts constatés

1. Le formulaire de mandat ne contient pas de SIRET ni d’indication structurée sur le statut professionnel. L’adresse du chantier, les noms, e-mails et adresses des parties sont saisis à nouveau sans préremplissage depuis le chantier, le compte ou un profil.
2. Le formulaire imprimé dans le navigateur et le PDF serveur sont rudimentaires : présentation linéaire, typographie et pagination limitées, coupures de paragraphes et blocs de signature peu soignés.
3. Une facture ajoutée au chantier est stockée dans `supplier_invoice`; une écriture du registre annuel est stockée séparément dans `financial_entry`. Le champ facultatif `supplier_invoice.entry_id` n’est pas renseigné par la création de facture. Le téléversement en comptabilité attache un document à une écriture déjà créée; il ne crée pas une facture comptable ni son OCR.
4. Le texte intégral `recognized_text` est enregistré pour les factures OCRisées, mais la recherche actuelle ne l’interroge pas. Ses index couvrent les fournisseurs/références et descriptions des lignes. La recherche est limitée au chantier sélectionné.
5. Les biens peuvent être ajoutés, mais pas encore modifiés ni archivés depuis l’interface. La création d’espaces de travail supplémentaires manque aussi, si plusieurs espaces par propriétaire sont nécessaires.
6. Le plan d’architecture contient encore des états antérieurs au déploiement et à la gestion des biens; il faut le synchroniser avec les capacités réellement livrées.
7. Le schéma a déjà `app.category`, `app.tax_profile` et des états de revue pour les écritures, mais l’interface ne propose ni classement par catégorie, ni profil fiscal par bien/lot/année, ni transition de revue. Le formulaire comptable ne montre pas le statut de revue et les écritures sont enregistrées en `needs_review`.
8. Les pages métier renvoient vers l’accueil sans navigation commune ni sélection d’espace partagée; l’accueil reste une page générique indiquant que l’espace est « en construction ». Les erreurs serveur sont parfois ramenées à un message générique sans référence de diagnostic.
9. La suppression d’une écriture comptable est déclenchée directement depuis la ligne. L’historique financier doit être protégé contre les suppressions accidentelles.

## Contraintes fixes

- Une facture et son justificatif doivent rester une seule pièce métier, avec un lien stable vers son écriture comptable et, si applicable, son chantier.
- Un ajout depuis l’un ou l’autre écran ne doit jamais créer de doublon. Les mises à jour doivent apparaître dans les deux vues.
- OCR, fournisseur, lignes, catégories, dates et montants extraits sont des propositions révisables. Aucun code ne décide seul de l’éligibilité fiscale.
- Les pièces, OCR et résultats de recherche restent privés, limités à l’espace et au chantier auxquels l’utilisateur a accès, et servis sans cache partagé.
- Un mandat signé conserve exactement son contenu et son empreinte. Les changements de formulaire ou de modèle ne réécrivent pas les anciens mandats.
- Les informations d’identité et de l’entreprise sont modifiables par l’utilisateur; l’e-mail de connexion reste celui vérifié par Access.

## Tranche 1 — profil et préremplissage du mandat

### Capacités

- Créer un profil réutilisable attaché au compte : nom affiché, e-mail vérifié, adresse de correspondance, statut particulier/professionnel, raison sociale et SIRET lorsque pertinent.
- Depuis un chantier, charger l’adresse du bien lié et proposer cette adresse comme adresse du chantier. Préremplir les champs des parties à partir du compte et des profils enregistrés; toute valeur reste modifiable avant la création du brouillon.
- Ajouter au mandat le SIRET de la partie professionnelle avec validation de format et indication lisible. Les données copiées dans un mandat deviennent un instantané modifiable tant que le brouillon n’a pas été signé.

### Critères d’acceptation

- Un propriétaire ayant renseigné son profil voit les données connues proposées dans le formulaire; une donnée absente peut être saisie et enregistrée au profil.
- L’adresse de chantier correspond par défaut au bien du chantier sélectionné, sans être une valeur figée.
- Le SIRET apparaît dans le brouillon et le PDF pour la partie déclarée professionnelle; sa modification après signature est impossible.
- Un invité ne peut ni lire ni modifier le profil propriétaire.

## Tranche 2 — modèle de mandat et rendu imprimable

### Capacités

- Remplacer le PDF texte minimal par un rendu A4 structuré : parties et identifiants, chantier, plafond, achats autorisés, conditions, période, signatures, pagination et pied de page avec version/empreinte.
- Utiliser un moteur de génération et une police qui gèrent correctement les accents, retours de ligne, listes et paragraphes longs. Garder le PDF serveur comme document de référence; faire pointer l’impression navigateur vers le même rendu.
- Incrémenter la version du modèle. Ne pas modifier le PDF ou les données des mandats déjà signés; vérifier le nouveau contenu avec le modèle de référence disponible.

### Critères d’acceptation

- Le PDF s’imprime en A4, conserve les accents et n’a ni texte coupé ni champs séparés de leur valeur; les mandats longs passent proprement sur plusieurs pages.
- Les deux parties, le SIRET professionnel lorsqu’applicable, l’adresse complète du chantier, les conditions, les dates, les signatures et l’empreinte sont présents.
- Le PDF téléchargé et l’option imprimer/enregistrer produisent le même contenu versionné.

## Tranche 3 — facture unique reliée au registre annuel et au chantier

### Capacités

- Proposer une création de facture depuis la comptabilité et depuis un chantier, avec un seul dossier de facture, un justificatif, des champs OCR et une écriture comptable liée.
- À l’ajout, enregistrer le total de facture dans le dossier du chantier et l’afficher en comptabilité comme facture en attente de règlement. Les dépenses annuelles payées sont générées à partir des paiements réels, datés et liés à cette facture.
- Depuis la comptabilité, permettre de rattacher la facture à un chantier, sans recopier ni remplacer la même pièce.
- Montrer le même statut de contrôle, la même référence, le même montant et des liens vers la facture dans les deux vues. Les catégories comptables et toute qualification fiscale nécessitent validation humaine.
- À la clôture du chantier, présenter le total des factures, des paiements, des remboursements et du solde restant sans créer une seconde écriture annuelle pour le total du chantier.
- Gérer les imports, réessais réseau et mises à jour de façon idempotente; protéger les écritures existantes et les factures avec paiements partiels.

### Critères d’acceptation

- Ajouter une facture au chantier crée une seule facture en attente, visible dans les vues chantier et comptabilité, sans l’inclure par erreur dans les dépenses payées de l’année.
- Chaque acompte ou paiement réel crée une dépense liée, datée du paiement et affectée à l’année correspondante; des paiements partiels répartis sur plusieurs années ne sont pas regroupés à la date de clôture du chantier.
- Le récapitulatif de clôture du chantier montre le total engagé et payé, mais ne duplique pas les dépenses déjà portées au registre annuel.
- Ajouter une facture depuis la comptabilité permet de l’associer à un chantier; le document, l’OCR et les modifications restent communs.
- Réessayer la même opération ou rafraîchir l’écran ne crée ni doublon de facture ni doublon comptable.
- Les lignes sont créées en « à vérifier » et la catégorie reste à attribuer/confirmer; aucun statut fiscal n’est attribué par OCR.
- Les remboursements, avoirs et paiements partiels ne doublent pas le montant de la facture dans le registre.

### Règle métier retenue pour le périmètre actuel

Pour la location nue relevant du régime réel des revenus fonciers, le BOFiP rattache en principe les dépenses à l’année où elles sont effectivement acquittées, quelle que soit la date de facture, d’échéance ou d’exécution des travaux. Les acomptes de travaux suivent l’année de leur versement, même si les travaux ont lieu plus tard. Ainsi, le total du chantier reste une synthèse à sa clôture; le registre annuel suit les paiements à leurs dates. Cette règle ne confirme pas à elle seule qu’une dépense est fiscalement déductible : sa nature et les autres conditions restent à vérifier. Pour les paiements effectués par un mandataire, le parcours devra conserver la preuve du paiement, l’origine des fonds et le rapprochement du mandat; le cas concret devra être confirmé avec le conseil comptable du propriétaire.

## Tranche 4 — classement annuel et validation humaine

### Capacités

- Exposer le profil fiscal déjà prévu par le schéma pour chaque bien/lot et année : type de location, régime et état brouillon/à vérifier/confirmé. Garder les profils datés afin qu’un changement de régime ne réécrive pas les années passées.
- Donner à chaque écriture une catégorie de recette/dépense et un état de revue visible. Permettre au propriétaire de confirmer, corriger ou exclure une écriture, avec date, acteur et journal d’audit.
- Définir avec le propriétaire/conseil la liste des catégories et leur correspondance éventuelle aux lignes des formulaires fiscaux; versionner le mapping par année. Ne pas générer d’export fiscal qualifié avant validation de ce mapping.
- Les imports CSV, factures OCR et paiements automatiques arrivent en brouillon/à vérifier. Une facture payée n’est pas automatiquement une charge déductible.

### Critères d’acceptation

- Le registre affiche la catégorie et le statut de revue; les écritures sont filtrables par état et catégorie.
- Une écriture importée ou issue d’une facture ne peut entrer dans un export fiscal qu’après une revue explicite et une catégorie confirmée.
- Les actions de confirmation, exclusion et correction sont auditées et soumises aux règles d’accès du propriétaire.
- Le changement de profil fiscal pour une nouvelle année ne modifie pas les profils historiques.
- Aucun mapping vers formulaire n’est livré sans validation de sa version annuelle et des catégories correspondantes.

## Tranche 5 — recherche globale dans les factures et leur OCR

### Capacités

- Étendre la recherche à l’espace sélectionné, avec accès aux écritures, factures comptables, factures chantier et lignes OCRisées.
- Rechercher dans `recognized_text` intégral, fournisseur, numéro, descriptions/lignes, adresse, lot, chantier et montant/date. Ajouter des index PostgreSQL adaptés et sélectionner la dernière extraction utilisable d’un document.
- Présenter des résultats navigables : extrait correspondant, statut OCR/relecture, pièce PDF ouvrable, bien/lot/chantier, montant et liens vers les deux vues concernées.
- Conserver le périmètre RLS pour chaque résultat; ne pas révéler l’existence ni le texte d’un document d’un autre espace ou d’un chantier non partagé.

### Critères d’acceptation

- Une recherche d’un terme visible uniquement dans le corps OCRisé d’un PDF retrouve cette facture et son extrait.
- Les résultats couvrent les documents attachés depuis la comptabilité et ceux ajoutés au chantier; les filtres ne changent pas les totaux de rapprochement du chantier.
- L’ouverture d’un résultat revérifie l’autorisation du document; recherches et réponses sont privées et non mises en cache.
- Les accents, variantes courantes et plusieurs mots donnent des résultats cohérents en français; les recherches vides ou trop larges sont bornées.

## Tranche 6 — accueil, navigation et profil réutilisable

- Remplacer l’accueil marketing/générique par un tableau de bord privé après authentification : accès rapides à Comptabilité, Biens et Chantiers, factures en attente, OCR à vérifier, mandats à signer et soldes de chantiers. N’afficher que les actions utiles, et ne pas calculer de conclusion fiscale.
- Créer une navigation commune cohérente avec la page active, retour au tableau de bord et accès au profil. Conserver la même sélection d’espace entre les modules et éviter de présenter des données provenant de deux espaces différents sans indication claire.
- Ajouter une page Profil pour maintenir une seule identité de compte (nom affiché et e-mail vérifié) et les renseignements d’entreprise réutilisables des mandats (adresse, statut professionnel, SIRET selon le cas). Le nom de plateforme reste fixe; un espace principal porte un seul nom dans ce périmètre.
- Afficher des messages d’erreur compréhensibles avec une référence de diagnostic non sensible; fournir une marche à suivre sans exposer les détails techniques ni données privées.

## Tranche 7 — gestion des biens, protection des données et accessibilité

- Ajouter modification et archivage d’une adresse ou d’un lot; préserver l’historique et refuser la suppression définitive lorsqu’il existe des écritures, pièces ou chantiers liés.
- Remplacer la suppression immédiate des écritures par une confirmation avec le bien, la date et le montant visibles, et privilégier l’annulation/archivage audité quand une écriture a déjà des pièces ou paiements liés.
- Compléter les états vides avec une prochaine action claire et des liens cohérents entre Biens, Comptabilité, Factures et Chantiers.
- Faire une revue WCAG 2.2 AA des contrastes, focus clavier visible, ordre de tabulation, annonces de succès/erreur, libellés, zoom et reflow mobile; corriger les écarts vérifiés.
- Tester les parcours au clavier et sur petit écran, notamment formulaire de facture, revue OCR, recherche et impression du mandat.
- Le périmètre initial conserve un espace principal par compte. Ne planifier plusieurs espaces que si plusieurs entités/propriétaires deviennent un besoin confirmé.

## Travaux distincts toujours nécessaires avant usage réel

- Tester l’analyse antivirus propre/suspecte et le refus si ClamAV est indisponible; configurer rétention, chiffrement et copie hors site des sauvegardes, puis faire une restauration de bout en bout.
- Tester les parcours propriétaire/invité en environnement protégé, y compris l’isolation des documents et résultats OCR; configurer les autorisations Cloudflare Access des invités.
- Importer et rapprocher le classeur existant, faire valider les catégories et exports fiscaux, et obtenir une revue métier/juridique du mandat et du niveau de signature requis.
- La synchronisation Google/Microsoft/SFTP et la fourniture d’une signature qualifiée restent hors de cette tranche produit.

## Ordre proposé et dépendances

1. Valider la politique d’identité (qui est le mandant/mandataire, quand le SIRET est requis), la situation fiscale du propriétaire et le traitement des règlements via le mandataire; définir le profil et le périmètre fiscal annuel.
2. Implémenter le profil réutilisable et le préremplissage, puis versionner le schéma des mandats.
3. Concevoir puis générer le nouveau PDF à partir du schéma versionné; contrôler les documents signés existants.
4. Exposer les catégories et états de revue avant de générer automatiquement les écritures liées aux factures et paiements.
5. Unifier la création et la liaison facture/écriture en transaction, avec idempotence et réconciliation projet.
6. Indexer et exposer la recherche OCR globale sur le modèle de facture unifié.
7. Remplacer l’accueil générique, unifier la navigation et la sélection d’espace, puis gérer les biens et les protections de suppression.
8. Faire les corrections d’accessibilité/mobile, synchroniser l’architecture et effectuer la recette fonctionnelle puis opérationnelle.

## Sources examinées

- `docs/product-spec.md`
- `docs/architecture.md`
- `docs/superpowers/plans/2026-11-21-web-foundation.md`
- `web/src/app/chantiers/project-workspace.tsx`
- `web/src/app/page.tsx`
- `web/src/app/comptabilite/annual-ledger.tsx`
- `web/src/app/api/accounting/entries/route.ts`
- `web/src/server/mandate-pdf.ts`
- `web/src/app/comptabilite/annual-ledger.tsx`
- `web/src/app/api/projects/[projectId]/invoices/route.ts`
- `web/src/app/api/projects/[projectId]/debours/route.ts`
- `infra/postgres/migrations/0001_initial.sql`, `0005_invoice_line_extraction.sql`, `0007_invoice_search_indexes.sql`
- [BOFiP — régime réel des revenus fonciers, conditions et année de paiement](https://bofip.impots.gouv.fr/bofip/3974-PGP.html/identifiant=BOI-RFPI-DECLA-20-20191113)
- [BOFiP — travaux, acompte et paiement](https://bofip.impots.gouv.fr/bofip/4052-PGP.html/identifiant=BOI-RFPI-BASE-20-30-30-20151228)
- [Impots.gouv.fr — quels travaux peuvent être déduits](https://www.impots.gouv.fr/particulier/questions/quels-travaux-puis-je-deduire-de-mes-revenus-fonciers)
