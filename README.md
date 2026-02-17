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
3) Activer l’auth email (OTP) dans Supabase
4) Sur Vercel, ajouter les env vars :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (clé **anon/public**, pas la clé **service_role/secret**)

Ensuite, dans l’app, section **Cloud Sync** :
- entrer ton email → bouton `Lien`
- cliquer le lien reçu par email → la session s’active et la sync démarre

Option CLI (si tu préfères) :

```sh
npm i -g vercel
vercel
```
