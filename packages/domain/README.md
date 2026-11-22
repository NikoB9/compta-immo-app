# Règles métier partagées

Ce paquet contient des calculs purs, séparés de l'interface et du stockage.

## CSV annuel

Le format `ledger-v2` transporte des lignes génériques de revenus et dépenses en centimes, avec les parts administrative et interne, l'année, les références de bâtiment/lot/pièce et le statut de revue source. L'import conserve aussi la compatibilité avec `ledger-v1`, dont le montant complet devient la part administrative. L'export filtre sur l'année sélectionnée et n'embarque jamais de fichier justificatif. L'import accepte les délimiteurs `;` et `,`, gère les champs entre guillemets, signale les lignes invalides et les doublons, puis remet le statut applicatif à `needs_review`. C'est un import à prévisualiser : aucune écriture de base de données ou mise à jour automatique n'est réalisée ici.

## Montants

Les montants sont conservés en centimes entiers. La saisie accepte les décimales françaises ou les montants avec espaces de groupement. Une précision supérieure à deux décimales, une valeur négative ou un groupement ambigu est rejeté ; aucune valeur n'est arrondie silencieusement.

## Rapprochement du mandat de débours

Le rapprochement distingue :

- avances et remboursements reçus par le mandataire ;
- paiements fournisseur effectués par le mandataire, liés à une facture ou en attente de facture ;
- remboursements fournisseur reçus par le mandataire ;
- sommes rendues au mandant.

Le solde net compare les fonds reçus et rendus aux paiements fournisseur réellement saisis. Un solde positif indique des fonds à restituer au mandant ; un solde négatif indique que le mandant reste redevable au mandataire. Le montant « en attente de facture » correspond aux fonds non justifiés par des paiements liés à une facture enregistrée. Les paiements sans facture sont signalés séparément.

Ces résultats servent au suivi opérationnel. Ils ne qualifient pas fiscalement une dépense et ne remplacent pas les justificatifs ni la vérification des règles applicables.
