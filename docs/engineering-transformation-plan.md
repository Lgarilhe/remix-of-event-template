# Plan de transformation engineering — Konekt

**Rôle** : note du CTO qui récupère la codebase et doit la rendre *scalable* et *travaillable par plusieurs équipes*.
**Date** : 2026-07-06
**Posture** : pas de rewrite. On transforme un codebase « mode fondateur » (1 humain + agents IA, ~51 commits/90j) en **plateforme prête à onboarder une équipe**. Chaque décision est calibrée pour l'étape réelle — ni bricolage, ni sur-ingénierie enterprise.

---

## 1. Diagnostic (état réel, chiffré)

| Dimension | Constat | Signal |
|-----------|---------|--------|
| **Volume** | ~513 fichiers src (360 tsx + 153 ts), 86 edge functions, 233 migrations, ~194k LOC TS | Grosse surface pour l'équipe actuelle |
| **Fichiers monstres** | `score-profile-job` 3704, `process-sequences` 3595, `agent-tools-mutations` 2995, `unipile-search` 2073, `useMessagesInbox` 1906, +20 fichiers >1000 lignes | Non maintenable à plusieurs |
| **TypeScript** | `strict: false`, `noImplicitAny: false`, `noUnusedLocals/Parameters: false` | Filet de type quasi absent |
| **ESLint** | 2 plugins (react-hooks, react-refresh), `no-unused-vars: off`, pas d'`exhaustive-deps` en erreur, pas de boundaries, pas d'a11y | Les bugs de deps `useEffect` trouvés à l'audit ne sont *pas* rattrapables par lint |
| **Tests** | 1 fichier `__tests__` (et **vitest pas installé** → il ne tourne même pas). Seul l'e2e Playwright existe | ~0 couverture unit/intégration sur 194k LOC |
| **CI** | e2e sur PR ; **aucun gate typecheck / lint / unit-test sur les PR** ; deploys uniquement sur push `main` | Une PR peut merger avec des erreurs TS |
| **Package manager** | 3 lockfiles : `bun.lock`, `bun.lockb`, `package-lock.json` | Installs non reproductibles entre postes |
| **Gouvernance** | Pas de `CODEOWNERS`, pas de PR template, pas de `CONTRIBUTING.md`, pas de git hook réel (le pre-commit vit dans `.claude/settings.json` → contourné par un `git` humain) | Rien n'enforce les conventions |
| **Docs** | 17 `.md` à la racine + 17 dans `AUDITS/` = 34 docs, `CLAUDE.md` = 32 Ko, **README décrit encore « Event Management Platform »** (template Lovable, pas Konekt) | Connaissance éparpillée, source de vérité introuvable |
| **Sécurité** | L'audit messagerie a révélé une **classe** d'IDOR/multi-tenant : l'isolation d'org est réimplémentée (mal) fonction par fonction | Problème systémique, pas ponctuel |
| **Héritage** | `.lovable/`, `lovable-tagger`, `MIGRATION_CLEAN.sql` (160 Ko) traînent ; migration tracking cassée pendant des semaines | Dette de migration Lovable→Vercel non soldée |

**Ce qui est déjà bon** (à préserver, pas à casser) : design system shadcn propre (`components/ui`, 54 fichiers), React Query partout, Sentry branché, `_shared/` côté edge existe déjà (auth/credits/cors/http), organisation frontend *feature-based* amorcée (`components/outreach`, `ats`, `missions`…), conventions écrites dans `CLAUDE.md`, e2e Playwright + healer/planner. Les bonnes idées sont là — **elles ne sont pas enforced**.

**Thèse centrale** : le problème n'est pas « le code est mauvais », c'est que **rien ne rend le bon chemin obligatoire**. À 1 personne, la discipline suffit. À 5, elle ne passe pas à l'échelle. Toute la transformation consiste à déplacer les conventions de *« c'est écrit dans CLAUDE.md »* vers *« le compilateur / le lint / la CI / le type refusent le mauvais chemin »*.

---

## 2. Principes directeurs (le « good » pour CETTE étape)

1. **Modular monolith, pas microservices.** À l'échelle actuelle, un frontend modulaire + des edge functions bien cadrées suffisent. Zéro découpage réseau prématuré.
2. **Enforcement > documentation.** Une règle non vérifiée par un outil n'existe pas. On code les invariants (auth, tenant, crédits) comme du *middleware obligatoire*, pas comme un pattern à recopier.
3. **Strangler-fig, pas big-bang.** On ne réécrit rien. On pose les garde-fous, puis on refactore *à l'occasion du travail sur chaque module* (« boy-scout rule » outillée).
4. **Le type système est la première ligne de défense.** `strict` d'abord, parce qu'il transforme des classes entières de bugs en erreurs de compilation gratuites.
5. **La frontière de tenant est architecturale, pas discrétionnaire.** L'isolation par org doit être impossible à oublier (helper unique + test qui échoue si on l'oublie), parce que l'audit a prouvé qu'on l'oublie.
6. **Calibrer à l'équipe.** Pas de Nx/Turborepo/monorepo multi-package tant qu'on n'a pas 2+ apps qui partagent du code. Pas de DDD dogmatique. On adopte la complexité *quand la douleur arrive*, pas avant.

---

## 3. Architecture cible

### 3.1 Frontend — passer de « par type » à « par feature » (bounded modules)

Aujourd'hui : `src/{components,hooks,lib,pages,types}` par *type technique*, puis `components/` re-découpé par feature (`outreach/` = 120 fichiers à lui seul), et **91 hooks à plat** dans `src/hooks/`. Résultat : pour toucher « messagerie » on saute entre 4 dossiers, et deux devs sur deux features se marchent dessus.

Cible : **un dossier par domaine métier**, autonome, avec une API publique explicite.

```
src/
  app/                    # bootstrap: router, providers, layouts (ex-App.tsx éclaté)
  modules/
    inbox/                # ex-messagerie
      components/
      hooks/              # useMessagesInbox & co vivent ICI, plus à plat
      api/                # appels edge/supabase typés du module
      types.ts
      index.ts            # API PUBLIQUE du module (seul point d'import externe)
    sourcing/
    sequences/
    pipeline/             # ATS
    missions/
    settings/
  shared/                 # design system (ui/), utils vraiment transverses, primitives
    ui/                   # shadcn — inchangé
    lib/
  integrations/           # supabase client, types générés
```

- **Règle de frontière enforced** (eslint `import/no-restricted-paths` ou `eslint-plugin-boundaries`) : un module n'importe un autre module **que via son `index.ts`**, jamais ses fichiers internes. `shared/` ne dépend d'aucun module. → on peut confier `inbox` à une équipe et `sequences` à une autre sans collisions.
- **Colocation** : hooks, composants, types et appels d'un domaine vivent ensemble. On supprime le dossier `src/hooks` à plat.

### 3.2 Backend / edge — un socle obligatoire, pas des patterns à recopier

Aujourd'hui : 86 fonctions, `_shared/` existe (`require-auth`, `settle-credits`, `resolve-org-credentials`, `cors`) mais l'adoption est **inégale** — d'où l'IDOR (auth/tenant réimplémentés à la main) et les settle oubliés. Les fonctions grossissent sans limite (3700 lignes).

Cible : **un `defineFunction()` wrapper unique** qui rend les invariants non-optionnels.

```ts
// _shared/handler.ts — le seul point d'entrée autorisé d'une edge function
export const handler = defineFunction({
  auth: 'user' | 'service' | 'cron' | 'webhook',   // résolu et vérifié AVANT le corps
  tenant: 'required',            // exige + vérifie account_id/org_id → member_linkedin_accounts
  rateLimit: { key: 'user', max: 60 },
  ai: { action: 'reply_suggestion' },  // settle crédits automatique post-appel
}, async (ctx) => { /* ctx.org, ctx.user, ctx.unipile déjà résolus et sûrs */ })
```

- **La classe d'IDOR de l'audit disparaît par construction** : impossible d'atteindre le corps sans que le binding `account_id → org → membership` ait été vérifié. C'est le pattern qui règle C1/C2 *une fois pour toutes*, pas fonction par fonction.
- **Une seule passerelle LLM** (`call-claude.ts`) rendue obligatoire (les 3 fetch Anthropic directs trouvés à l'audit deviennent interdits par lint sur `api.anthropic.com`).
- **Plafond de taille** : lint/CI qui *warn* >400 lignes, *fail* >800 sur les fonctions. Les monstres (`score-profile-job`, `process-sequences`) se découpent en modules internes (`_lib/` par fonction).
- **Timeout, retry, idempotence** fournis par le socle, pas réinventés.

### 3.3 Data — la frontière de tenant vit dans la base

- **RLS = l'invariant de sécurité de dernier recours**, testé automatiquement (voir §3.4). L'app ne doit jamais être la *seule* barrière tenant.
- **Discipline de migration** : la table de tracking désynchro (6/219) est le symptôme d'un process fragile. On fige : une migration = un fichier horodaté, jamais éditée après merge, `db push` idempotent, workflow vert obligatoire. Un lint de migration (nommage, `IF NOT EXISTS`, RLS présente sur toute nouvelle table).
- **Accès typé** : les 5938 lignes de types générés sont bien, mais on ajoute une couche `api/` par module qui *encapsule* les requêtes Supabase (plus de `.from('...')` éparpillés dans les composants → testable, cacheable, refactorable).

### 3.4 Tests — construire le filet AVANT de refactorer

On ne peut pas réorganiser 194k LOC sans régresser si on n'a rien pour le prouver. Pyramide cible :

- **Unit (vitest)** — à *installer* d'abord (il n'est même pas dans les deps). Cible les fonctions pures à fort risque : mapping de filtres, interpolation de templates, calcul de crédits, transforms, réducteurs (`searchReducer`, inbox). Vite, nombreux.
- **Intégration edge (Deno test)** — le socle `defineFunction` : auth refusée, tenant croisé rejeté, settle appelé. **Un test qui échoue si une fonction org-scopée oublie la vérif tenant** = le garde-fou anti-IDOR permanent.
- **RLS** — suite qui se connecte en tant que user org A et *tente* de lire/écrire des données org B. Rouge = fuite. Tourne en CI.
- **E2E (Playwright)** — déjà là, garder pour les parcours critiques (`@critical`), pas pour tout.
- **Cible réaliste** : pas de « 80 % coverage » dogmatique. On vise *coverage sur le code à risque* (paiement, tenant, envoi de messages, crédits) proche de 100 %, et on laisse l'UI cosmétique peu couverte.

### 3.5 CI/CD & release

- **Gate PR obligatoire** (aujourd'hui inexistant) : `typecheck` + `lint` + `unit` + `build` sur chaque PR, bloquant. L'e2e reste mais n'est plus le seul filet.
- **Preview envs** : chaque PR → un déploiement Vercel de preview + (idéalement) une branche Supabase éphémère pour tester migrations+RLS avant `main`.
- **Deploy edge automatisé** : le workflow existe déjà sur push `main` — bien. On ajoute un *smoke test* post-deploy.
- **Branch protection** sur `main` : PR obligatoire, gate vert obligatoire, 1 review (via CODEOWNERS quand l'équipe grossit).

### 3.6 DX & outillage

- **Un seul package manager.** Choisir bun *ou* npm, supprimer les 2 lockfiles en trop, le documenter. C'est la cause n°1 de « ça marche chez moi ».
- **Git hooks réels** (husky + lint-staged) : typecheck + lint + format sur le staged, côté *git* (pas seulement côté Claude). Le hook `.claude` reste en bonus pour les sessions agent.
- **Prettier** ajouté (absent) → fin des diffs de style, revues centrées sur le fond.
- **Générateurs / scaffolds** : `plop` (ou script) pour « nouveau module », « nouvelle edge function » (qui produit déjà `defineFunction` + test). La cohérence par défaut, pas par vigilance. (Les skills `.claude/skills/edge-function.md` et `migration.md` existent — les transformer en générateurs exécutables.)

### 3.7 Observabilité & sécurité

- **Sentry** est là → standardiser : release tracking, source maps, tags `org_id`/`module`, alerting.
- **Logs structurés** côté edge (JSON, niveau, request-id), **PII masquée** (l'audit a trouvé emails/noms en clair). Un helper `log()` dans le socle.
- **Secrets** : inventaire (déjà bien documenté dans CLAUDE.md), rotation, et *cache credentials avec TTL* (l'audit a noté l'absence d'invalidation).
- **Branding lint** : une règle CI qui grep `Unipile|Apollo|PDL|Anthropic|Resend` dans les chaînes user-facing (JSX/toast) et *fail* la PR. Règle métier connue → automatisée (les 4 fuites de l'audit ne passeraient plus).

---

## 4. Team topology & ownership

- **Modules = unités d'ownership.** Quand l'équipe grossit : `CODEOWNERS` mappe `src/modules/inbox/**` → équipe messagerie, `supabase/functions/unipile-*` → équipe intégrations, etc. Review obligatoire du owner.
- **Les frontières enforced (§3.1) rendent l'ownership réel** : une équipe ne peut pas casser le module d'une autre par un import sauvage.
- **Un `CONTRIBUTING.md`** court : comment lancer, tester, nommer une branche, ouvrir une PR, la convention de commit. Onboarding d'un dev en < 1h.
- **ADRs** (`docs/adr/`) : les décisions structurantes (pourquoi modular monolith, pourquoi Unipile, pourquoi PDL abandonné) deviennent des *Architecture Decision Records* datés, au lieu de vivre dans 34 `.md` dispersés.

---

## 5. Roadmap séquencée (garde-fous d'abord, refacto ensuite)

L'ordre n'est pas négociable : **on pose le filet avant de bouger les meubles.**

### Phase 0 — Hygiène & filet (≈ 1–2 semaines, gros ROI, faible risque)
1. Un seul package manager, supprimer les lockfiles en trop.
2. Installer vitest + Prettier + husky/lint-staged.
3. Durcir ESLint : `exhaustive-deps` en **error**, boundaries (préparé), a11y de base, interdiction des fetch Anthropic directs + grep branding.
4. **Gate CI PR** : typecheck + lint + unit + build, bloquant. Branch protection sur `main`.
5. Nettoyer la racine : README réécrit (c'est Konekt, pas « Event Platform »), 34 `.md` → `docs/` rangés + archivés, ADRs amorcés.

### Phase 1 — TypeScript strict (progressif, ≈ 2–4 semaines)
6. `strict: true` par étapes (`strictNullChecks` d'abord), fichier par fichier ou via `// @ts-strict-ignore` décroissant. Chaque erreur corrigée = un bug potentiel tué gratuitement.

### Phase 2 — Socle backend & sécurité (≈ 3–4 semaines, priorité sécurité)
7. Écrire `defineFunction()` (auth/tenant/rateLimit/ai). Migrer d'abord les fonctions **messagerie + envoi** (là où l'audit a trouvé les IDOR/double-envoi). Corriger C1/C2/C4 dans la foulée.
8. Suite de tests **RLS + tenant-crossing** en CI. Rouge = merge bloqué.
9. Découper les 5 fonctions >2000 lignes en modules internes.

### Phase 3 — Modularisation frontend (continu, strangler-fig)
10. Créer `src/modules/`, migrer **un domaine à la fois** en commençant par `inbox` (déjà audité, on connaît les bugs). Activer les boundaries au fur et à mesure.
11. Casser les composants/hooks monstres *pendant* la migration du module, avec les tests unit comme filet.

### Phase 4 — Industrialisation (continu)
12. Preview envs + branches Supabase éphémères. Générateurs de modules/functions. Observabilité standardisée. CODEOWNERS quand les premiers devs arrivent.

**Jalons de succès mesurables** : gate PR vert obligatoire (oui/non) · `strict: true` (% fichiers) · fonctions >800 lignes (→ 0) · tests tenant/RLS en CI (oui/non) · temps d'onboarding d'un dev (< 1 jour) · 0 chaîne vendor user-facing (lint).

---

## 6. Pièges à éviter (autant que ce qu'on fait)

- **Le rewrite.** Tentant sur du code à 3700 lignes/fichier. C'est la mort par 1000 coupures : on perd 6 mois et le métier encodé implicitement. Strangler-fig only.
- **Microservices / monorepo multi-package prématurés.** 1 app, 1 backend edge. Nx/Turbo/services séparés = complexité qu'on ne peut pas encore amortir.
- **DDD/abstractions dogmatiques.** Cf. `CLAUDE.md` : « trois lignes similaires valent mieux qu'une abstraction prématurée ». On abstrait ce qui a *prouvé* sa récurrence (auth, tenant, LLM), pas le reste.
- **Big-bang de la config.** `strict: true` d'un coup sur 194k LOC = des milliers d'erreurs, PR ingérable, équipe qui abandonne. Progressif.
- **Confondre « écrit » et « enforced ».** `CLAUDE.md` est excellent — et pourtant l'audit a trouvé les violations qu'il interdit. La leçon de tout ce plan.

---

## 7. TL;DR pour le board

Le code n'est pas à jeter : les fondations (React Query, shadcn, `_shared`, feature-folders, Sentry, e2e) sont saines. Ce qui manque, c'est **l'enforcement** : rien n'oblige aujourd'hui à écrire du code sûr et uniforme, donc à 1 personne ça tient par la discipline, et à 5 ça casse. La transformation est séquencée pour **poser les garde-fous (types stricts, gate CI, socle backend anti-IDOR, tests de tenant) avant de refactorer**, module par module, sans jamais réécrire. Résultat visé : une plateforme où le mauvais chemin est *impossible*, où un nouveau dev est productif en un jour, et où chaque équipe possède son module sans marcher sur celui des autres.
