# 05 · Banc visuel

Le banc visuel capture chaque écran de Konekt dans l'application connectée, avec des données de démo, en quatre variantes : sombre et clair, ordinateur (1440 × 900) et téléphone (390 × 844). Il sert à voir un lot avant et après, et à le faire relire par une autre IA sans qu'elle ait besoin d'un compte.

Tout tourne en local. Les scripts refusent une base distante, la production comprise.

## Mise en route

1. Base locale, depuis la racine du dépôt (Docker requis, voir `e2e/README.md`) :

   ```bash
   supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,realtime,storage-api,mailpit
   supabase status -o env      # API_URL, ANON_KEY, SERVICE_ROLE_KEY
   ```

   Dans un conteneur sans IPv6, le service temps réel ne démarre pas : désactiver `[realtime]` dans une copie de `supabase/config.toml` (option `--workdir`) plutôt que dans le fichier du dépôt.

2. Données de démo :

   ```bash
   SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> node scripts/design/seed-demo.mjs
   ```

   Un cabinet fictif (« Cabinet Horizon »), quatre missions, 28 candidats à tous les stades, deux séquences, des tâches, des entretiens et des notifications. Plus un compte indépendant vide, pour les états vides. Le script se rejoue : il efface et réécrit ses propres lignes.

   Compte de démo : `camille.martin@demo.konekt.test`, mot de passe `Demo!Konekt2026`.

3. Application branchée sur la base locale :

   ```bash
   VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY> \
     npx vite --port 8080 --host 127.0.0.1
   ```

4. Captures :

   ```bash
   node scripts/design/capture.mjs captures/avant            # les 36 écrans, 4 variantes
   VARIANTS=dark-desktop node scripts/design/capture.mjs captures/apres dashboard
   ```

   Le dossier `captures/` est ignoré par git. `CHROMIUM_PATH` indique un navigateur si Playwright ne trouve pas le sien.

## Ce que le banc ne montre pas

- Les fonctions edge ne tournent pas en local. Leurs appels reçoivent une réponse figée : un compte LinkedIn connecté, des crédits IA. La messagerie reste donc vide, et la recherche LinkedIn ne renvoie aucun profil.
- Le temps réel est coupé : les compteurs ne bougent pas pendant la capture.
- Les captures sont prises avec le mouvement réduit : les animations d'entrée n'apparaissent pas.

## Pendant un lot

1. Capturer les écrans du lot avant de toucher au code (`captures/avant-<lot>`).
2. Coder, puis capturer à l'identique (`captures/apres-<lot>`).
3. Comparer côte à côte, dans les deux thèmes et sur téléphone.
4. Joindre les paires avant/après à la demande de contre-revue (`04-contre-revue.md`).
