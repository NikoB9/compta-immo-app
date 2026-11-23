# Déploiement autonome

Cette configuration lance PostgreSQL et l’application web dans deux conteneurs. Elle convient à un hôte Docker, y compris une VM Proxmox. PostgreSQL reste sur un réseau privé Docker ; seul le port HTTP de l’application est publié sur `127.0.0.1:3000` pour un tunnel ou un proxy inverse local.

## Préparer les secrets

Depuis la racine du dépôt :

```sh
cp infra/deploy/.env.example infra/deploy/.env
chmod 600 infra/deploy/.env
openssl rand -hex 32
```

Générez deux mots de passe différents avec `openssl rand -hex 32`. Remplacez les valeurs de `POSTGRES_ADMIN_PASSWORD` et `DATABASE_URL`. Le mot de passe de l’URL `MIGRATION_DATABASE_URL` doit être celui de `POSTGRES_ADMIN_PASSWORD`. Les mots de passe hexadécimaux évitent les caractères qui nécessiteraient un encodage spécial dans une URL PostgreSQL. Le fichier `.env` ne doit pas être ajouté au dépôt.

Renseignez le domaine d’équipe, l’audience de l’application Cloudflare Access et l’origine HTTPS publique exacte. Configurez dans Cloudflare Access une politique qui protège ce nom d’hôte et autorise les personnes prévues avant d’exposer le tunnel.

## Initialiser la base

Les commandes Compose ci-dessous supposent que le fichier secret est `infra/deploy/.env` :

```sh
docker compose --env-file infra/deploy/.env up -d database
docker compose --env-file infra/deploy/.env --profile ops run --rm migrate
```

Les migrations sont appliquées dans l’ordre des noms de fichiers. Un registre `app_ops.schema_migration` conserve le SHA-256 de chaque migration ; une migration déjà appliquée est ignorée et une modification ultérieure de son contenu fait échouer l’opération.

Créez ensuite le rôle runtime et appliquez les droits en tant qu’administrateur PostgreSQL :

```sh
docker compose --env-file infra/deploy/.env exec database psql -U compta_admin -d compta
```

Dans `psql`, exécutez :

```sql
\i /infra/postgres/ops/grant_runtime_session_access.sql
\i /infra/postgres/ops/grant_runtime_ledger_access.sql
CREATE ROLE compta_app LOGIN;
\password compta_app
GRANT app_runtime TO compta_app;
```

Les scripts SQL sont montés en lecture seule dans le conteneur PostgreSQL. La commande `\password` évite d’écrire le mot de passe en clair dans l’historique SQL. Utilisez pour `DATABASE_URL` le mot de passe que vous avez défini.

Initialisez le propriétaire et les trois lots initiaux avec le script existant. Saisissez les valeurs dans une session interactive :

```sql
\prompt 'Email du propriétaire: ' owner_email
\prompt 'Nom affiché: ' owner_display_name
\prompt 'Nom de l’espace: ' workspace_name
\prompt 'Libellé du bâtiment: ' building_label
\prompt 'Adresse: ' address_line1
\prompt 'Complément (vide si aucun): ' address_line2
\prompt 'Code postal: ' postal_code
\prompt 'Commune: ' locality
\prompt 'Référence lot 1: ' unit_ref_1
\prompt 'Référence lot 2: ' unit_ref_2
\prompt 'Référence lot 3: ' unit_ref_3
\i /infra/postgres/ops/bootstrap_owner.sql
```

## Démarrer l’application

```sh
docker compose --env-file infra/deploy/.env build app
docker compose --env-file infra/deploy/.env --profile ops run --rm migrate
docker compose --env-file infra/deploy/.env up -d app
docker compose --env-file infra/deploy/.env ps
```

Le service conserve les justificatifs dans le volume `private_documents`, monté au chemin privé configuré dans l’image. Les octets ne sont pas placés dans PostgreSQL. Montez ou sauvegardez ce volume avec des permissions accessibles à l’UID 1001 du conteneur. L’image Next.js est construite en mode autonome et démarre avec l’utilisateur non privilégié `nextjs`.

Configurez le tunnel Cloudflare ou votre proxy inverse pour joindre `http://127.0.0.1:3000`. N’exposez pas le port PostgreSQL. Le contrôle de santé HTTP attend la réponse `401` de l’application lorsqu’aucun JWT Cloudflare Access n’est fourni.

## Exploitation

- À chaque mise à jour, construisez d’abord l’image avec `docker compose --env-file infra/deploy/.env build app`, appliquez ensuite les migrations avec `docker compose --env-file infra/deploy/.env --profile ops run --rm migrate`, puis démarrez l’application avec `docker compose --env-file infra/deploy/.env up -d app`.
- Sauvegardez PostgreSQL **et** le volume `private_documents`, puis testez régulièrement une restauration.
- Les sauvegardes, l’analyse antivirus, la configuration Cloudflare Access et le test des parcours propriétaire/invité restent à organiser avant une mise en production réelle.
- Pour les mises à jour PostgreSQL majeures, suivez la procédure officielle `pg_upgrade` ; changer simplement le tag de l’image ne migre pas le répertoire de données.

Cette configuration n’installe ni ne configure Proxmox, Cloudflare Access, les sauvegardes ou l’analyse antivirus. Vérifiez la politique d’accès et la restauration avant d’y placer des documents comptables.
