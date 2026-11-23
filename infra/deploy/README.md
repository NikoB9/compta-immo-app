# Déploiement autonome

Cette configuration lance PostgreSQL, ClamAV et l’application web dans trois conteneurs. Elle convient à un hôte Docker, y compris une VM Proxmox. PostgreSQL et ClamAV restent sur un réseau privé Docker ; seul le port HTTP de l’application est publié sur `127.0.0.1:3000` pour un tunnel ou un proxy inverse local. ClamAV analyse chaque pièce avant son écriture privée ; l’application refuse les fichiers si le scanner est absent ou ne peut pas répondre.

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

Au premier démarrage, ClamAV initialise puis met à jour sa base de signatures ; l’application attend que le scanner soit sain. La durée dépend de l’hôte et du téléchargement. La base est gardée dans le volume `clamav_signatures`. Le protocole TCP du scanner n’est ni chiffré ni authentifié ; gardez son port 3310 dans le réseau privé Compose et ne le publiez jamais sur l’hôte.

Configurez le tunnel Cloudflare ou votre proxy inverse pour joindre `http://127.0.0.1:3000`. N’exposez pas les ports PostgreSQL ou ClamAV. Le contrôle de santé HTTP attend la réponse `401` de l’application lorsqu’aucun JWT Cloudflare Access n’est fourni.

## Exploitation

- À chaque mise à jour, construisez d’abord l’image avec `docker compose --env-file infra/deploy/.env build app`, appliquez ensuite les migrations avec `docker compose --env-file infra/deploy/.env --profile ops run --rm migrate`, puis démarrez l’application avec `docker compose --env-file infra/deploy/.env up -d app`.
- La sauvegarde exige Docker Compose, `tar` et `sha256sum` sur l’hôte ; exécutez-la depuis la racine du dépôt ou appelez le script par son chemin.
- Sauvegardez PostgreSQL **et** le volume `private_documents` avec `sh infra/deploy/backup.sh`. Le script arrête brièvement l’application pour prendre les deux copies sans écritures applicatives concurrentes, valide les formats et empreintes, protège les fichiers avec les permissions du compte qui l’exécute, puis redémarre l’application. Le dossier de sauvegarde par défaut est `backups/` ; définissez `BACKUP_DIR=/chemin/hors-du-dépôt` pour choisir un volume de sauvegarde externe. Les sauvegardes contiennent des pièces et des données comptables : protégez aussi le volume de sauvegarde, chiffrez-le au repos et stockez-en une copie hors de la machine.
- Pour préparer une restauration sans remplacer la base ou le volume actifs, lancez `sh infra/deploy/restore-staging.sh /chemin/vers/compta-immo-<horodatage>`. Le script vérifie les empreintes, les chemins UUID et les types de fichiers de l’archive, crée une base neuve `restore_*` et un volume Docker `compta_restore_documents_*`, restaure les données et réapplique les droits runtime. Il supprime ses deux ressources s’il échoue, et les conserve si elles sont créées avec succès afin de permettre la vérification. Les noms exacts sont affichés à la fin. Les SHA-256 détectent une corruption accidentelle ; ils ne prouvent pas l’origine ni l’intégrité contre une modification malveillante. Ne restaurez que vos propres archives de confiance.
- Cette restauration de staging exige le service PostgreSQL actif. Les rôles PostgreSQL sont partagés par le cluster et ne figurent pas dans le dump d’une seule base ; sur un nouveau cluster, créez aussi le rôle LOGIN runtime comme indiqué plus haut, puis accordez-lui `app_runtime`. Cette étape restaure les archives, mais l’essai de bout en bout via l’application et les parcours propriétaire/invité reste à réaliser avant livraison.
- Tester la détection avec le fichier de test EICAR dans un environnement isolé, puis vérifier que les mises à jour de signatures restent saines. ClamAV réduit le risque sans garantir qu’un document est inoffensif ; la configuration Cloudflare Access, la copie chiffrée/hors site des sauvegardes, la rétention et les parcours propriétaire/invité restent à valider avant une mise en production réelle.
- Pour les mises à jour PostgreSQL majeures, suivez la procédure officielle `pg_upgrade` ; changer simplement le tag de l’image ne migre pas le répertoire de données.

Cette configuration n’installe ni ne configure Proxmox, Cloudflare Access, la planification et le chiffrement des sauvegardes, ni la politique de rétention. Vérifiez le scanner, la politique d’accès et la restauration avant d’y placer des documents comptables.

Références techniques : [image Docker officielle ClamAV](https://docs.clamav.net/manual/Installing/Docker.html), [protocole ClamD INSTREAM](https://docs.clamav.net/manual/Usage/ClamdProtocol.html). Le scanner TCP n’a pas de chiffrement ni d’authentification et doit rester sur un réseau privé.
