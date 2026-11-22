# Compta Immo — application web

Première coquille publique Next.js avec manifeste installable. Cette version ne contient ni connexion, ni base de données, ni import de pièces comptables. Les données réelles ne doivent jamais être ajoutées au dépôt.

## Développement local

```powershell
npm ci
npm run dev
```

Ouvrir ensuite http://localhost:3000. La cible prévue est Node.js 24 LTS. Les documents et données privés seront ajoutés ultérieurement aux services privés, jamais au dépôt Git.

## État actuel

- Page d’accueil responsive et générique.
- Manifeste PWA et icônes SVG.
- Pas de service worker ni de cache de données privées.
- Règles de montants, rapprochement des débours et CSV annuel versionné testés sans dépendance externe.
- Registre annuel temporaire dans `/comptabilite`, avec saisie, modification, aperçu des imports CSV et export. Pour les essais, utilisez des données fictives. L'onglet conserve les écritures en mémoire jusqu'au départ de la page ou au rechargement.
- Le rapprochement métier n’est pas encore relié à une base de données ou à l’interface.

Exécuter les tests métier avec `npm test` depuis `web/`.
