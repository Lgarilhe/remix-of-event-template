# Audit technique Konekt — 2026-07-09

> **Statut** : actif — audit de référence à cette date.
> **Remplace** (pour la partie constats) : les audits `2026-04-16` (préfixe « Skalr ») et `2026-06-10`, dont plusieurs constats sont corrigés ou périmés (voir §7).
> **Révision analysée** : `889a8b7` (HEAD de la branche de travail au 2026-07-09), `feat(coresignal): pagination Base Konekt sans plafond`.
> **Méthode** : accès **complet** au code en local (Read/Grep/Bash), 14 agents d'audit parallèles, exécution réelle de `tsc`/`eslint`/`vite build`. Chaque constat cite `fichier:ligne`.
> **Point de départ** : cet audit part de l'audit externe « ChatGPT 5.6 » (lecture GitHub web, **sans** clone ni exécution) et le confronte au code réel.

---

## 0. TL;DR

L'audit externe est **globalement juste sur les axes structurels** (pas de filet CI automatique, TS non strict, base non reproductible, repo public trop bavard, curseur/facturation/rate-limit fail-open). Mais, faute d'accès au code, il **surestime le risque d'architecture** (l'auth des edge functions est en réalité solide sur 86/87 fonctions, la RLS est réelle, pas de credential bleed, pas de fuite CORS) et **rate 5 problèmes plus graves que tout ce qu'il liste** :

1. 🔴 **`src/integrations/supabase/types.ts` est corrompu** par de la sortie CLI committée → **tout le type-checking du projet est neutralisé** (invisible : le build passe quand même).
2. 🔴 **Le hook pre-commit `tsc --noEmit` est vacant** (vérifie 0 fichier) → la protection annoncée dans `CLAUDE.md` n'existe pas. Combiné au point 1 : **aucun type-check n'a jamais tourné**. `npm run lint` échoue avec **1788 problèmes**.
3. 🔴 **`process-email-queue` : bypass d'authentification** par JWT forgé non signé → déclenchement d'envoi d'emails par n'importe qui.
4. 🔴 **`export-org-data` interroge une table inexistante** → l'export RGPD (art. 20) renvoie **0 candidat en silence**.
5. 🔴 **Aucun contrôle de solde côté serveur avant appel fournisseur** → à 0 crédit, consommation LLM/Coresignal **illimitée, non facturée et invisible au ledger**.

Le vrai problème n'est donc pas « l'architecture est fragile » — c'est que **le filet de sécurité automatique est une illusion** (hook mort, types cassés, lint jamais lancé) et qu'une poignée de bugs P0/P1 réels vivent dans les zones récemment modifiées (Coresignal) et RGPD.

**Note de risque révisée : 6/10** — proche du 6,5 externe, mais pour des raisons différentes : sécurité applicative *meilleure* que redouté, contrôles automatiques *pires* que présentés.

---

## 1. Confrontation avec l'audit externe

### 1.1 Ce qu'il a eu JUSTE (confirmé par le code)

| Sujet | Verdict | Précision apportée par le code |
|---|---|---|
| Curseur Coresignal non signé, contrôlé client (CS1) | ✅ CONFIRMÉ mais **sur-évalué** | Réel, mais **P2 pas P0** : l'utilisateur peut déjà collecter n'importe quel ID via `action:'collect'`, et le cache est org-scopé (RLS). Pas d'escalade d'accès nouvelle. |
| Facturation fail-open (CS5) | ✅ CONFIRMÉ, **pire** | Doublement fail-open : `settle()` avale l'exception **et** `settleCredits` retourne `success:false` sans bloquer à solde insuffisant, retour jamais inspecté. |
| Rate-limit fail-open (CS6) | ✅ CONFIRMÉ, **généralisé** | Pas une fonction : **27 sites** ignorent `error` du RPC (`const { data: allowed }` sans `error`). |
| Reset silencieux sur curseur invalide (CS2) | ✅ CONFIRMÉ | `catch { state = {ids:[],...} }` → page 1 + re-facturation, pas de 400. |
| `Number()` sans `isFinite` (CS3) | ✅ CONFIRMÉ (robustesse, pas faille) | Sortie JSON = nombre ou `null`, pas d'injection DSL possible. |
| TS non strict + tests exclus | ✅ CONFIRMÉ | `strict:false`, `exclude:["src/__tests__"]`. |
| Base non reproductible depuis migrations (CI1) | ✅ CONFIRMÉ | Commentaire présent dans `e2e.yml:61-64`. |
| `deploy-migrations` dangereux (CI2) | ✅ CONFIRMÉ | Push→main→prod, aucun `environment:`, `repair_tracking` = UPSERT tracking sans DDL. |
| Pas de CI typecheck/lint/unit (CI3) | ✅ CONFIRMÉ | Nuance : `e2e.yml` tourne sur PR mais ne type-check pas. Hooks `.claude/settings.json` = local seulement **et vacants** (§2). |
| README parle d'événementiel/Lovable (D1) | ✅ CONFIRMÉ | 130 lignes « Event Management Platform… built with Lovable ». Zéro « Konekt ». |
| Audits contradictoires/périmés (D2) | ✅ CONFIRMÉ | 16 fichiers, aucun en-tête de statut ; `DB_AUDIT:175 migrations` vs `CODE_AUDIT:225`. |
| PR anciennes en conflit (D3) | ✅ CONFIRMÉ, **pire** | #173 (avril) n'a **aucun ancêtre commun** avec `main` (historique réécrit) → immergeable. #214 = 12 fichiers en conflit. |
| Repo public = cartographie infra (D4) | ✅ CONFIRMÉ | **P1**. Ref Supabase, noms de secrets, `SECURITY_DEEP_AUDIT.md` liste des failles RLS avec chemins = feuille de route d'attaque. **Aucune valeur secrète committée** (scan vérifié). |
| `console` supprimé en prod (FE3) | ✅ CONFIRMÉ | `drop:['console','debugger']` → breadcrumbs Sentry perdus. |
| Sourcemaps non uploadées (FE4) | ✅ CONFIRMÉ | `sourcemap:'hidden'`, pas de `@sentry/vite-plugin`. |
| `dangerouslySetInnerHTML` non sanitisé (FE5) | ✅ CONFIRMÉ | 3 usages, **DOMPurify absent**. Vrai vecteur XSS : `EnrollmentPreviewModal` interpole des champs profil LinkedIn (contrôlés par le candidat) via `.replace(/\n/g,'<br>')` sans échappement. |
| `PUBLIC_ROUTES` local, pas de source unique (FE2) | ✅ CONFIRMÉ | `src/lib/publicRoutes.ts` inexistant sur `main` (PR #214 non fusionnée). |
| Pas de CSP / en-têtes de sécurité | ✅ CONFIRMÉ | `vercel.json` = cache only. |
| 3 lockfiles (CI7) | ✅ CONFIRMÉ, **il en comptait 2** | `bun.lock` **+** `bun.lockb` **+** `package-lock.json`. Pas de `packageManager`/`engines`. |

### 1.2 Ce qu'il a eu FAUX (réfuté par le code)

| Claim externe | Verdict | Preuve |
|---|---|---|
| Index composite `(organization_id, coresignal_id)` manquant (CS10) | ❌ **RÉFUTÉ** | La contrainte `UNIQUE (organization_id, coresignal_id)` (migration `20260708120000:33`) **crée** l'index btree. Requête d'hydratation couverte. |
| `nextAfter` jeté = bug de pagination (CS7) | ⚠️ **NUANCÉ** | Heuristique **volontaire et commentée**, conforme au contrat provider (1000 IDs/page). Pas un bug en pratique (fragilité seulement si Coresignal change son défaut). |
| Action `search` renvoie toujours `cursor:null` (CS8) | ⚠️ **NUANCÉ** | Exact, mais **aucun appelant** n'utilise `action:'search'` de coresignal (code quasi mort ; les `action:'search'` repérés visent `unipile-search`). |
| Implicite : `requireAuth` décode le JWT sans le vérifier | ❌ **RÉFUTÉ** | `authClient.auth.getUser(token)` valide la signature côté serveur d'auth. Aucun decode local. |
| Implicite : CORS wildcard = fuite d'identifiants | ❌ **RÉFUTÉ** | `Allow-Credentials:true` seulement pour l'allowlist ; auth par `Bearer` (pas cookie) → un `ACAO:*` n'ouvre aucune requête authentifiée cross-site. |
| Implicite : credential bleed (globals mutables) | ❌ **RÉFUTÉ** | `resolve-org-credentials.ts` : `Map` keyé par `organizationId`, aucun global mutable de secret. Conforme à la règle CLAUDE.md. |
| Implicite : promesses non gérées répandues | ❌ **RÉFUTÉ** | 36 `.then(` audités : couverture `.catch`/2e-argument/allSettled quasi totale. 1 résidu bénin. |

**Lecture** : l'audit externe a bien identifié les *odeurs* (fail-open, curseur client) mais s'est trompé sur plusieurs *mécanismes* faute de code — et, plus important, il a **crédité des contrôles qui n'existent pas** (« hooks pre-commit tsc+build » présentés comme un filet ; ils sont vacants).

### 1.3 Ce qu'il a MANQUÉ (invisible sans le code — nos trouvailles)

Voir §3. Ce sont les constats les plus importants de cet audit.

---

## 2. 🔴 Le filet de sécurité automatique est une illusion

Ces trois faits se renforcent : ils expliquent pourquoi les 37 erreurs TS et le `types.ts` corrompu n'ont jamais été détectés.

- **`src/integrations/supabase/types.ts` est corrompu.** Ligne 1 = `Initialising login role...` ; lignes de fin = `A new version of Supabase CLI is available: v2.98.2…`. De la sortie console capturée pendant `supabase gen types > types.ts`. Présent sur tout l'historique du repo (depuis `d199065` du 2026-07-02). → **24 erreurs de syntaxe** dès `types.ts(1,1)` quand on type-check, ce qui **supprime tous les diagnostics sémantiques**. Le build Vite passe car `client.ts:3` fait `import type { Database }` (effacé par esbuild sans parser le fichier).
- **Le hook pre-commit `tsc --noEmit` vérifie 0 fichier.** `tsconfig.json` est « solution-style » (`"files": []` + `references`). `npx tsc --noEmit` sans `-p`/`-b` **ne compile pas les projets référencés** → `tsc --noEmit --listFiles | grep -c src/` = **0**. Le hook `.claude/settings.json` passe **toujours**, quel que soit le code. `CLAUDE.md` affirme « bloque le commit si erreurs TS » : **faux**.
- **Conséquence, mesurée par exécution réelle** (`types.ts` réparé + `node_modules` installés) :
  - `tsc -p tsconfig.app.json` (config laxiste du projet) → **37 erreurs** réelles (framer-motion `Variants`, `Json` vs `Record`, overloads Supabase).
  - Passage `strict:true` → **125 erreurs** (dette strict nette : +88). Faible pour 1015 fichiers, mais masquée par **473 `as any`**.
  - `npm run lint` → **1788 problèmes** (1655 erreurs, 133 warnings). Dont **1568 `no-explicit-any`** et surtout **90 `react-hooks/exhaustive-deps`** (exactement les races `useEffect` que `CLAUDE.md` documente comme pièges). Le lint échoue massivement → **jamais lancé**, ni en hook ni en CI.
  - `vite build` → **passe** (26,95 s), 2 chunks > 500 kB (`index` 1,24 Mo / 371 kB gzip, `MissionWorkspace` 634 kB).

**Le seul gate qui fonctionne (vite build) est aveugle aux types.** D'où l'invisibilité totale.

---

## 3. 🔴 P0/P1 manqués par l'audit externe

### 3.1 `process-email-queue` — bypass d'authentification (sécurité, P0)
`parseJwtClaims` fait `JSON.parse(atob(payload))` **sans vérifier la signature** (`index.ts:83-99`), puis `if (!isCronCaller && claims?.role !== 'service_role')` (`:158`). `verify_jwt=false` au gateway. → un JWT **forgé** `header.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.x` décode `{role:"service_role"}` et passe. N'importe qui avec l'URL déclenche le traitement de la file email (envoi Resend, client service-role). Le chemin cron (`PROCESS_SEQUENCES_SECRET`, comparé en clair) est correct — c'est le **fallback JWT** qui est cassé.
**Fix** : supprimer le fallback `parseJwtClaims`, n'accepter que le secret cron **ou** `getUser()` réel (le pattern de `process-inmail-queue`/`process-sequences`, corrects).

### 3.2 `export-org-data` — export RGPD art. 20 vide (conformité, P0)
`.from("candidate_job_status")` (`index.ts:81`) alors que la table est **`job_candidate_status`**. Erreur supabase-js jamais lue (`candidates || []`, `:107`). → JSON téléchargé = `candidates:[]`, `candidates_count:0` sans erreur. Le plan `2026-04-10-critical-audit-fixes.md` avait corrigé exactement cette inversion dans `rgpd-purge` mais raté `export-org-data`.
**Fix** : `job_candidate_status` ligne 81 + vérifier les erreurs de chaque requête.

### 3.3 Aucun gate de solde serveur avant appel fournisseur (coût, P0)
Le settlement est **toujours post-paiement** et fail-open. `settle-credits.ts:128-131` : à solde insuffisant, `return {success:false}` **sans débit ni ligne `ai_credit_transactions`**. Aucune edge function LLM ne lit `ai_credit_balances` avant d'appeler Anthropic (seule exception : `enrich-candidate-contact:246`). Le seul pré-check de solde vit **côté client** (`invokeWithCredits.ts:88` : `catch { proceeding anyway }`), contournable par `curl + JWT`.
→ Une org à 0 crédit consomme Anthropic/Coresignal **indéfiniment aux frais de Konekt, sans trace au ledger**.
**Fix** : pré-check serveur (ou réservation débit-puis-ajuste) dans les fonctions coûteuses ; insérer une transaction `unbilled` quand le settle échoue pour rendre la fuite visible.

### 3.4 `stripe-webhook` non idempotent (facturation, P1)
Aucune déduplication d'`event.id` (juste loggé), `credit_purchases.stripe_session_id` **sans UNIQUE**, crédit top-up = read-then-upsert non atomique (`:137-153`). → un retry Stripe (timeout, redeliver) **double les crédits**.
**Fix** : `UNIQUE(stripe_session_id)` + insert-first (skip crédit si conflit), ou table `stripe_events(event_id UNIQUE)`.

### 3.5 Ledger : insert d'audit jamais vérifié + `userId:''` (facturation, P1)
`settle-credits.ts:259` insère `ai_credit_transactions` sans lire l'erreur, retourne `success:true` **après** débit du solde. `user_id` est `uuid NOT NULL` mais 3 appelants passent `''` (`sequence-send-email:175`, `process-sequences:3578`, `coresignal-search:142`). → solde débité, **transaction absente** (invalid uuid `""`), silencieusement. Écart ledger/solde inexpliqué, litige impossible à instruire.
**Fix** : vérifier l'erreur d'insert ; passer `user_id:null` (colonne nullable) dans les flux service-role.

### 3.6 Chaîne RGPD incomplète (conformité, P1 ×3)
- **`rgpd-purge` n'est schedulé par aucun cron** : l'en-tête promet « pg_cron » mais aucun des 13 jobs cron ne l'invoque. La rétention 24/12/6 mois **n'est jamais exécutée**.
- **Caches profils jamais purgés physiquement** : `pdl_profile_cache` / `coresignal_profile_cache` filtrent `expires_at` à la lecture, **aucun DELETE nulle part**, cron « à câbler séparément » jamais câblé. TTL 30 j affiché = conservation illimitée réelle.
- **`rgpd-erase-contact` (art. 17) n'efface que `candidate_enrichments`** : caches fournisseurs, `knowledge_chunks` (nom/notes en clair), embeddings, `job_candidate_status`, CVs survivent. Pire : `coresignal-search handleCollect` **re-collecte et re-cache** un profil effacé sans consulter `gdpr_erasures`, et `isGdprBlocked` fail-open.
- **Bonus** : `rgpd-erase-contact` (chemin GET public) passe une **IP (texte) au paramètre `uuid p_user_id`** de `check_rate_limit` → le RPC échoue → fail-closed → **429 permanent** sur l'endpoint d'effacement (non-conformité masquée).

### 3.7 `coresignal_enabled` jamais vérifié côté serveur (coût/rollout, P2)
Le flag de rollout (`organization_integrations.coresignal_enabled`) n'est lu **que par le front** (`SearchFiltersPanel.tsx:123`). Le serveur exige JWT + membership mais pas le flag ; `resolveCoresignalCredentials` retombe sur la clé **env partagée**. → tout membre de toute org appelle `action:'collect'` en direct et brûle des crédits Coresignal (2/profil), hors rollout, jusqu'à 30 req/min.
**Fix** : lire le flag après résolution de l'org, `403` si `false` pour les actions payantes.

### 3.8 Portail client : `can_see_names` non appliqué serveur (accès/RGPD, P2)
`client-portal-data:107-136` renvoie **toujours** `candidate_name`/`candidate_headline`, sans consulter `permissions.can_see_names`. L'anonymisation n'existe **que** dans le rendu React. → un client à qui les noms sont masqués (souvent RGPD) les lit en clair dans l'onglet Réseau des devtools.
**Fix** : nuller les champs côté serveur si `can_see_names===false` avant renvoi.

### 3.9 Bugs de correction frontend dans la zone Coresignal récemment modifiée (P1/P2)
Tous dans le code du commit `889a8b7` / `a78af72` :
- **Changement de filtres sans reset du curseur** (P1) : `SET_FILTERS`/`UPDATE_FILTERS` ne réinitialisent ni `cursor` ni `hasMoreResults`. « Lot suivant » sert des profils des **anciens filtres** puis applique `search_after` de l'ancienne requête au nouveau DSL → pagination incohérente, silencieuse.
- **Retour d'onglet Sourcing = auto-relaunch qui débite** (P1) : l'hydratation du cache pose `searchSource='database'`, l'effet « auto-relaunch on source toggle » ne distingue pas restauration de toggle → une recherche Coresignal repart seule à +100 ms, écrase les lots restaurés et **débite `coresignal_preview` sans action utilisateur**, à chaque aller-retour.
- **Fix quota `a78af72` incomplet** (P2) : le 3e check quota (`useLinkedInSearchActions.ts:900`) manque le garde `isDatabase` → les lots Base Konekt restent tronqués quand le compteur LinkedIn est plein (le symptôme que le commit prétendait éliminer).
- **Toggle de source sans reset curseur** (P2) : curseur Coresignal (JSON) envoyé à Unipile → erreur ; ou curseur Unipile → Coresignal → append silencieux de sources mélangées.
- **Aucune protection de concurrence dans `handleSearch`** (P2) : « Rechercher » cliquable pendant un « Lot suivant » en vol → résultats de l'ancienne requête appendés à la nouvelle, curseur écrasé. Pas de jeton de génération ni d'AbortController.

---

## 4. Manifeste d'authentification des edge functions

**87 fonctions classées, 1 seule UNPROTECTED.** L'architecture d'auth est bien meilleure que ce que l'audit externe redoutait (« une future fonction oubliée devient publique »). Mais le contrôle **manque** : rien n'empêche la prochaine régression.

**Répartition** : `requireAuth+orgCheck` (majorité des écritures), `requireAuth` (fonctions LLM sans org body), `webhook-signature` (Stripe/Svix/Calendly/Unipile/Aircall — HMAC corrects, fail-closed), `cron-secret` (comparaison stricte), `token-scoped` (portail/extension/invitation/unsubscribe), `public-intentional` (`submit-application`, `sequence-email-track`).

**⚠️ Le cas UNPROTECTED** : `process-email-queue` (§3.1).

**Risques MOYENS à durcir** (auth présente mais trop permissive) :
| Fonction | Problème |
|---|---|
| `n8n-create-workflow` | Tout user authentifié peut **DELETE puis recréer** les workflows n8n partagés (clé globale, non multi-tenant). |
| `nurturing-analyzer` (`analyze`) | `created_by = user_id` **du body** → IDOR d'écriture (attribuer des opportunités à un user arbitraire) + brûle crédits. Le chemin `list` a été durci, pas `analyze`. |
| `send-transactional-email` | Tout user authentifié envoie n'importe quel template à **n'importe quelle adresse** → relais spam interne aux couleurs Konekt, pas de rate-limit. |
| `sequence-email-track` | **Open redirect** public : `Location: decodeURIComponent(redirectUrl)` sans validation de domaine, même `tid` inconnu → phishing sur domaine `supabase.co` de confiance. |
| `generate-embedding` | Check org **contournable par omission** : sans `organization_id`, upsert service-role d'un embedding sur un `entityId` arbitraire → corruption du matching sémantique **cross-tenant** + coût OpenAI. |
| `auto-analyze-message` | Idem : check `if (organization_id && userId)` sauté si l'org est omise → lecture/écriture potentiellement cross-org. |
| `unipile-search` / `setup-calendly-webhook` / `text-action` | Check org sauté si `organization_id` absent → fallback créds env partagées (unipile). |
| `unipile-accounts` | Fuite mineure : 12 premiers chars de la clé service-role renvoyés dans un message 403. |
| `rgpd-erase-contact` (GET) | Effacement d'un contact arbitraire par email sans preuve de propriété (design self-service RGPD), rate-limit IP contournable — **et actuellement cassé**, cf §3.6. |

---

## 5. État des tests

Progrès réel vs audit d'avril : **Playwright existe** (`e2e/`, ~21 tests actifs + nightly). Couverture : auth, routes protégées, mobile, `@smoke` authed, **multi-tenant** (3 `@critical` : forge cross-org, RLS REST 0 ligne, featureGates), **RLS API** (4 `@critical` : SECURITY DEFINER révoquées), **quota-gate** (4 `@critical`).

Lacunes confirmées :
- **Aucun framework unitaire** (pas de vitest/jest, pas de script `test`). `src/__tests__/aiCredits.test.ts` importe `vitest` **absent** → test mort, exclu de `tsc`, jamais exécuté.
- **Aucun test Deno** pour les helpers critiques (`require-auth`, `settle-credits`, `resolve-org-credentials`, quotas).
- Le test `@critical` du flux recherche/`missionSearchCache` est un **`test.fixme` vide** (placeholder).
- Les mocks vendors (`mockVendors`) existent mais **aucun test actif ne les consomme** (contredit le `e2e/README`).

---

## 6. Plan de remédiation

> Ordonné par **ratio risque/effort**. Chaque item est vérifiable. Les fixes edge function exigent un redéploiement manuel (`supabase functions deploy <name>`) — non auto-déployé.

### Palier 0 — Hotfix immédiat (le filet + les fuites) — ~½ journée
Objectif : rétablir la visibilité et colmater les fuites silencieuses. Petits diffs, fort impact.

1. **Réparer `types.ts`** : `supabase gen types typescript --linked > src/integrations/supabase/types.ts` (en veillant à ne pas polluer stdout) ou retirer ligne 1 + 2 dernières lignes. → débloque le type-checking.
2. **Réparer le hook pre-commit** : `.claude/settings.json` → `npx tsc --noEmit -p tsconfig.app.json`. Ajouter un hook `eslint`. → le garde-fou redevient réel.
3. **`export-org-data`** : `candidate_job_status` → `job_candidate_status` (1 ligne) + vérifier les erreurs. (Déployer.)
4. **`process-email-queue`** : supprimer le fallback `parseJwtClaims`, exiger secret cron ou `getUser()` réel. (Déployer.)
5. **Rendre `coresignal-search` fail-closed** : vérifier `error` du `check_rate_limit`, inspecter le retour de `settleCredits`, vérifier `coresignal_enabled` serveur, valider/typer le curseur (rejet 400 au lieu de reset silencieux). (Déployer.)
6. **`client-portal-data`** : appliquer `can_see_names` côté serveur.
7. **Corriger la dette bloquante** révélée par les points 1-2 : les 37 erreurs TS, puis relancer lint.

### Palier 1 — Sous 2 semaines (contrôles automatiques + facturation fiable)
8. **CI de PR obligatoire** : nouveau workflow `ci.yml` sur `pull_request` → `npm ci` → `tsc --noEmit -p tsconfig.app.json` → `eslint` → (à terme) tests unitaires → `vite build`. Bloquant.
9. **Manifeste d'auth des edge functions** + test statique : chaque dossier `supabase/functions/*` doit être classé (le §4 est la base) ; CI échoue sur une fonction non classée. Empêche la prochaine `process-email-queue`.
10. **Gate de solde serveur** (§3.3) + **idempotence Stripe** (§3.4) + **ledger fiable** (§3.5) : réservation-puis-ajuste via RPC atomique (le modèle `deduct_ai_credits` existe), `UNIQUE(stripe_session_id)`, vérifier les inserts d'audit.
11. **Helper `checkRateLimit()` fail-closed** partagé, appliqué aux 27 sites coûteux.
12. **Bugs frontend Coresignal** (§3.9) : reset curseur sur changement de filtres/source, garde anti-auto-relaunch au retour d'onglet, jeton de génération dans `handleSearch`, fix quota ligne 900.
13. **Durcir les auth MOYENNES** (§4) : `n8n-create-workflow`, `nurturing-analyzer analyze`, `send-transactional-email`, open redirect `sequence-email-track`, check org par omission (`generate-embedding`, `auto-analyze-message`).
14. **Installer Vitest** + tests des helpers `_shared` (`require-auth`, `settle-credits`, curseur Coresignal, mapping).
15. **Sécurité navigateur** : CSP `Report-Only` → bloquant, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` dans `vercel.json`. **DOMPurify** sur les 3 `dangerouslySetInnerHTML` (surtout `EnrollmentPreviewModal`).
16. **Décider du repo public** : passer privé, **ou** purger `CLAUDE.md`/`AUDITS/` de la carto sensible. Corriger le **README**. Ajouter `SECURITY.md`, `CODEOWNERS`, protection de branche `main`.
17. **RGPD** (§3.6) : câbler le cron `rgpd-purge`, cron de purge physique des caches, étendre la cascade d'effacement art. 17 + blocage re-collecte, réparer le rate-limit IP→uuid.
18. **Lockfiles** : supprimer `bun.lock`/`bun.lockb` **ou** ajouter `"packageManager"`. Fermer/re-porter les PR #173, #214 ; merger ou clore #218.

### Palier 2 — Sous 6 semaines (dette de fond)
19. **`strict` progressif** : `strictNullChecks` dossier par dossier (~125 erreurs), résorber les 473 `as any` en priorité dans les hooks de recherche/scoring.
20. **`environment: production`** sur `deploy-migrations` (approbation manuelle + snapshot), `repair_tracking` derrière une procédure d'incident distincte.
21. **Baseline Supabase reproductible** : commiter un schéma baseline, faire fonctionner `supabase db reset` + `test:e2e` sur machine vierge.
22. **Réduire les gros fichiers** (`process-sequences` 3595 l., `score-profile-job` 3749 l., `useMessagesInbox` 1906 l.) et les 2 chunks > 500 kB (`manualChunks`).
23. **Upload sourcemaps Sentry** (`@sentry/vite-plugin` + release ID), logger structuré au lieu du `console` supprimé.
24. **Observabilité coûts** : p95 par edge function, coût par recherche/profil révélé, hit-rate cache.
25. **Nettoyer `AUDITS/`** : en-tête de statut (archivé/remplacé-par) sur les 16 fichiers.

---

## 7. Audits antérieurs — statut

| Fichier | Statut |
|---|---|
| `*_2026-04-16` (préfixe « Skalr ») | ⚠️ Largement périmés (ancien nom produit, Apollo/PDL/Lovable). Constats sécurité partiellement corrigés depuis. À archiver. |
| `CODE_AUDIT_2026-06-10.md` | Partiellement à jour ; comptes migrations/fonctions incohérents avec la réalité (91 migrations locales ≠ 225/175 cités). |
| `EDGE_FUNCTIONS_UNIPILE_AUDIT_2026-06-10.md` | À jour sur Unipile. |
| **Ce document** | **Référence au 2026-07-09.** |

---

*Audit produit avec accès complet au code (14 agents parallèles, exécution réelle des contrôles). Les 5 constats P0/§3 ont été vérifiés à la main après le rapport des agents.*
