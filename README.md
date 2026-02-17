# Tracker V9

Petit projet **statique** (Vite) prêt à lancer en local et à déployer sur Vercel.

## Historique (important)

Par défaut l’historique est stocké en `localStorage` : c’est **par appareil / navigateur** (si tu changes de téléphone/PC ou si tu effaces le cache, tu perds / tu ne vois pas l’historique).

Pour un historique multi-appareils, le projet inclut une option **Cloud Sync** via **Supabase (gratuit)**.

## Local

```sh
npm install
npm run dev
```

Optionnel (Cloud Sync) :

- Copier `.env.example` vers `.env`
- Renseigner `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`
- Pour tester aussi les routes `api/*` en local, renseigner aussi les variables serveur (`SUPABASE_*`, `APP_ORIGIN`, `ACCOUNT_CODE_ENC_KEY`)

## Build

```sh
npm run build
npm run preview
```

## Déploiement Vercel

- Importer le repo dans Vercel (GitHub/GitLab/etc.)
- Les commandes par défaut fonctionnent (`npm run build`, output `dist`) via `vercel.json`

### Cloud Sync (Supabase)

1) Créer un projet Supabase
2) Créer la table + policies en exécutant `supabase/schema.sql` dans le SQL editor
3) Activer l’auth email dans Supabase (Authentication → Providers → Email)
4) Sur Vercel, ajouter les env vars **client** :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (clé **anon/public**, pas la clé **service_role/secret**)
5) Sur Vercel, ajouter les env vars **serveur** (routes `api/*`) :
   - `SUPABASE_URL` (même valeur que `VITE_SUPABASE_URL`)
   - `SUPABASE_ANON_KEY` (même valeur que `VITE_SUPABASE_ANON_KEY`)
   - `SUPABASE_SERVICE_ROLE_KEY` (secret)
   - `APP_ORIGIN` (ex: `https://ton-app.vercel.app`)
   - `ACCOUNT_CODE_ENC_KEY` (base64 de 32 bytes, ex généré via `openssl rand -base64 32`)

Notes :
- Ne mets jamais tes clés dans `.env.example` / Git (même si “public”, c’est inutile et ça déclenche souvent la protection GitHub).
- Les variables `VITE_*` sont visibles côté navigateur (c’est OK pour la clé **anon/public**).

Ensuite, dans l’app, section **Cloud Sync** :
- soit entrer ton **code de compte** → `Connexion`
- soit entrer ton **email** → `Envoyer lien` (tu reçois un email avec un lien qui te reconnecte + ton code dans l’URL)

Optionnel : pour afficher explicitement le code dans l’email Supabase, tu peux modifier le template et afficher `{{ .Data.account_code }}`.

Option CLI (si tu préfères) :

```sh
npm i -g vercel
vercel
```
