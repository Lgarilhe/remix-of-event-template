# Guide Onboarding — Claude Code sur Konekt AI Platform

**Pour qui** : un développeur (Tiago, Thomas, Guillaume côté tech, ou un nouveau freelance) qui arrive sur le repo Konekt AI Platform et doit être productif avec Claude Code en **un après-midi**.

**Pré-requis** :
- Accès au repo GitHub Konekt AI Platform
- Claude Code installé (`npm i -g @anthropic-ai/claude-code` ou équivalent à jour)
- Node 20+, pnpm, Supabase CLI, Git
- Compte Supabase (accès au projet staging accordé par Laurent)

---

## 1. Setup environnement (30 min)

```bash
# Clone
git clone git@github.com:konekt/<repo>.git
cd <repo>

# Install
pnpm install

# Env local
cp .env.example .env.local
# Remplir avec les credentials Supabase local / staging (demander à Laurent)

# Supabase local
supabase start
supabase db reset   # applique les migrations + seed

# Lancer le front
pnpm dev
```

**Vérif** : [http://localhost:5173](http://localhost:5173) s'ouvre, login avec un compte seed fonctionne.

---

## 2. Lancer Claude Code (5 min)

Dans le repo :

```bash
claude
```

Au premier lancement, Claude Code :
- Lit `CLAUDE.md` (règles du projet, convention, "Laurent n'est pas développeur").
- Lit `.claude/settings.json` (permissions, hooks).
- Charge les skills `skills/*.md`.

**Vérif** : lance `/status`. Tu dois voir la branche courante, les derniers commits, les entries ouvertes du LOGBOOK.

---

## 3. Lire les 5 fichiers essentiels (45 min)

Dans cet ordre :

1. **`CLAUDE.md`** (65 lignes) — les règles du projet. Lire ligne par ligne. La première règle est "Laurent n'est pas développeur" : cela oriente la communication.
2. **`guide-staging-prod.md`** — comment on passe de local à prod. Les pièges connus.
3. **`runbook-rollback.md`** — quoi faire quand ça casse. Ne pas attendre un incident pour le lire.
4. **`routines-guide.md`** — rituels quotidiens et hebdomadaires.
5. **`PROMPTS.md`** — bibliothèque de prompts. Tu utiliseras ceux de "Investigation & Audit" dès la première semaine.

**Parcourir rapidement** :
- `skills/*.md` — survol de chaque skill pour savoir qu'elle existe. Tu retourneras dans chaque au cas par cas.
- `LOGBOOK.md` — lire les 10 dernières entries pour comprendre l'état actuel.

---

## 4. Architecture en 5 minutes

### Stack

- **Frontend** : React + TypeScript + Vite + Tailwind + shadcn/ui. UI générée par Lovable à partir de specs ; logique ajoutée/durcie dans Claude Code.
- **Backend** : Supabase (Postgres + Auth + Storage + Edge Functions Deno). ~40 edge functions.
- **Tests** : Vitest (unit) + Playwright (E2E).
- **MCP** : Unipile (LinkedIn), Aircall, Outlook, n8n — déployés sur VPS Hostinger.

### Structure monolithe modulaire

```
src/
├── modules/
│   ├── sourcing/
│   ├── sequences/
│   ├── scoring/
│   ├── messaging/
│   ├── candidates/
│   ├── companies/
│   ├── config-studio/
│   └── auth/
├── shared/       ← seul dossier partagé entre modules
│   ├── types/
│   ├── ui/
│   ├── utils/
│   └── hooks/
└── app/          ← routing, layout global
```

**Règle absolue** : un module importe depuis `shared/` ou depuis lui-même. **Jamais** d'un autre module. Si tu en as besoin → la dépendance remonte dans `shared/`.

### 3 types d'utilisateurs

1. **Client final** : entreprises qui recrutent. Voit ses missions + hunt mode marketplace.
2. **Cabinet / ESN** : recruteurs intermédiaires. Voit ses missions clients + portail client read-only gratuit.
3. **Freelance** : recruteurs indépendants. Voit missions assignées, portfolio, pas d'autonomie pour créer des missions.

Chaque feature doit être testée pour les user types concernés.

### Multi-tenant

- `tenant_id` dans les claims JWT (app_metadata).
- Toutes les tables ont RLS activé.
- `tenant_id` **jamais** accepté depuis le body de la requête — uniquement depuis le JWT validé.

---

## 5. Premier ticket (2-3h)

**But** : livrer un petit changement de bout en bout.

1. Prendre un ticket "good first issue" dans le backlog (ou demander à Laurent).
2. Créer une branche `feature/<nom-court>`.
3. `/kickoff <titre du ticket>` dans Claude Code → Claude lit le contexte.
4. `/spec` → valider la spec avec Laurent.
5. `/plan` → découpage en sous-tâches.
6. `/build` — Claude implémente, tu relis le diff ligne par ligne avant chaque commit.
7. `/test-first` si pas de test sur la zone touchée.
8. `/qa` sur les flows concernés.
9. `/review` par Claude puis PR GitHub pour review humaine.
10. Après merge : entry `SHIP` dans LOGBOOK.md.

---

## 6. Codes de conduite avec Claude Code

### Ce que tu valides TOUJOURS manuellement

- Chaque diff avant commit.
- Tout `git push`.
- Toute migration Supabase.
- Tout déploiement edge function.

Claude Code n'est **pas** un développeur autonome. C'est un copilote qui produit du code. Tu es responsable de ce qui entre dans `main`.

### Ce que tu ne demandes pas à Claude

- D'inventer des specs sans que Laurent les valide.
- De push sans ton relecture.
- De supprimer des données en prod (jamais).
- De générer des credentials.

### Comment communiquer efficacement avec Claude Code

1. **Un sujet à la fois**. Si tu as 3 sujets → 3 conversations.
2. **Contexte dès le premier message** : branche, ticket, contrainte. Utilise `/kickoff`.
3. **Règle des 3 échanges** : si après 3 échanges tu n'avances pas, arrête, reformule, ou demande à Laurent.
4. **Quand Claude propose** : lis à 100%, ne scanne pas. Beaucoup de bugs viennent d'un `je te laisse faire` trop vite.
5. **Fin de conv** : toujours `/update-docs` avant de fermer. Les décisions se perdent sinon.

---

## 7. Outils & MCP

### Lovable (frontend UI)

- Projet Lovable synced sur GitHub.
- Génère l'UI (JSX + styles) à partir de specs et screenshots (Flowstep/Stitch).
- **Ne jamais** modifier la logique métier dans Lovable → elle est écrasée au prochain generate.
- La logique métier vit dans des hooks / services touchés par Claude Code.

### Unipile MCP

- Utilisé pour LinkedIn Recruiter search + messaging.
- Champ gotcha : `reaction_counter`, pas `reactions_count`.
- Filtres interdits : `seniority`, `spoken_languages`, `profile_language`, `tenure` — silencieusement ignorés par Unipile.
- Toujours `graduation_year` pour valider l'XP réelle.

### Outlook MCP

- Multi-comptes : `l.garilhe@konekt.fr` et `comptabilite@konekt.fr` actuellement.
- **Toujours** formater le corps d'email en HTML (`<br>`, `<p>`). Pas de plain text.

### Aircall MCP

- Utilisé pour transcripts d'appels (<6 mois) dans la qualification candidat.

### n8n

- URL : `https://n8n.srv883112.hstgr.cloud`.
- Workflows d'automatisation (pas de logique métier critique dedans).

---

## 8. Debug & questions

### J'ai un bug sur staging

1. Reproduire en local si possible (`supabase db reset` + seed).
2. `/status` pour vérifier l'état de ta branche.
3. Logs Supabase → dashboard projet staging → Functions → logs.
4. Si bug reproductible : `/hotfix` skill guide la correction + test de régression.

### J'ai un doute sur une règle Konekt

1. Chercher dans `CLAUDE.md` + `LOGBOOK.md`.
2. Si pas trouvé : demander à Laurent en 1 phrase précise. Ne pas deviner.
3. Après réponse : ajouter la règle au fichier concerné.

### Je ne comprends pas un bout de code

1. `/kickoff <fichier ou module>` → Claude te résume l'intention.
2. Lire les tests associés (ils racontent l'usage).
3. Si toujours flou : `git log -p <fichier>` pour voir l'histoire des décisions.

---

## 9. Ce qu'on ne fait pas

- On ne commit pas `.env*`.
- On ne push pas sur `main` directement.
- On ne supprime pas de données prod.
- On n'ajoute pas de dépendance npm sans l'avoir justifiée dans le PR.
- On ne crée pas un 2e module pour faire la même chose qu'un existant (anti-duplication).
- On n'ignore pas un fail de `/qa`.
- On ne ship pas le vendredi après-midi.

---

## 10. Où trouver de l'aide

- **Questions projet** : Laurent (Slack DM).
- **Questions tech backend** : Guillaume Valladier.
- **Questions tech frontend / infra** : Tiago / Thomas selon dispo.
- **Questions Claude Code / skills** : lire `PROMPTS.md` + `routines-guide.md`, puis demander à Laurent.
- **Questions Supabase** : docs officielles + Discord Supabase.
- **Questions Lovable** : Discord Lovable.

---

## Checklist de fin d'onboarding (à remplir par le nouveau dev)

- [ ] Environnement local fonctionne, login OK
- [ ] Claude Code lancé, `/status` produit un résultat propre
- [ ] `CLAUDE.md` lu intégralement
- [ ] 4 autres docs essentiels parcourus
- [ ] Premier ticket livré et mergé
- [ ] Entry `SHIP` créée dans LOGBOOK.md
- [ ] Règle comprise : "Laurent n'est pas développeur" → communication en français, non-technique, concrète

Une fois tous les `[x]` → onboarding terminé. Bienvenue.
