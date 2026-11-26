# Compta Immo — application web

Application Next.js auto-hébergée pour le suivi comptable immobilier, les justificatifs et les chantiers. Les données personnelles, adresses, pièces, signatures, secrets et sauvegardes restent dans l’environnement privé de déploiement et ne doivent jamais être ajoutés au dépôt.

## Configuration initiale

Après création de la base, des rôles runtime et du service web, configurez `INITIAL_OWNER_EMAIL` dans l’environnement privé avec l’adresse vérifiée par Cloudflare Access. La personne correspondante ouvre `/configuration-initiale` pour créer le compte propriétaire et son espace de travail. La route ne fonctionne que si aucun compte ni espace n’existe encore. Elle refuse les requêtes d’une autre identité Access et les requêtes cross-origin. Les adresses et lots se gèrent ensuite librement depuis `/biens`; ils ne sont pas limités à une configuration initiale.

Les migrations sont dans `../infra/postgres/migrations/`; les rôles et droits de déploiement sont documentés dans `../infra/deploy/README.md`. Les données saisies à l’écran ne sont pas enregistrées dans Git.

## Développement local

La cible prévue est Node.js 24 LTS. Depuis `web/`, installez les dépendances avec `npm ci`, puis lancez `npm run dev`. Les routes métier nécessitent PostgreSQL, les migrations et les variables serveur décrites dans `.env.example`. Le mode local peut contourner le proxy Cloudflare, mais il ne crée pas d’identité utilisateur vérifiée pour les API ; utilisez des données fictives et ne connectez pas une base réelle.

## Fonctionnalités disponibles

- Authentification via Cloudflare Access et résolution d’un compte applicatif à partir de l’identité vérifiée.
- Registre annuel persistant, import CSV atomique, export et gestion des justificatifs.
- Suivi des chantiers, factures, débours, invitations et mandats avec traces d’accord/signature.
- Export privé de projet et analyse antivirus des pièces par ClamAV.

Le déploiement, la restauration, les contrôles de sécurité opérationnels et les parcours réels propriétaire/invité doivent encore être validés avant usage comptable courant.
