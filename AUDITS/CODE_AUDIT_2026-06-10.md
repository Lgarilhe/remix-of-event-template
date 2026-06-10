# Audit complet du code — 2026-06-10

Audit réalisé sur la branche `claude/code-audit-5hhduv` (base : `67c1129`).
Périmètre : 77 edge functions Supabase, frontend `src/` (~1000 fichiers), 225 migrations SQL,
advisors de sécurité du projet Supabase production (`crckfywoyjxkawathdff`), dépendances npm, branding.

Méthode : 4 audits parallèles (sécurité edge functions, frontend React/TS, branding vendor,
DB/migrations/dette) + advisors Supabase live + `npx tsc --noEmit`. Les findings à fort impact
ont été re-vérifiés manuellement dans le code (un faux positif du passage frontend a été écarté).

---

## Verdict global

**Le code est en bon état.** Aucune violation critique dans les edge functions : auth multi-tenant,
timeouts, settleCredits, webhooks signés et gestion des credentials respectent les conventions
CLAUDE.md à 100 %. `tsc --noEmit` passe sans erreur. Pas de secret commité.

**Le risque principal n'est pas dans le code mais dans la base de production** : 52 fonctions
SQL `SECURITY DEFINER` sont exécutables par le rôle `anon` via l'API REST (`/rest/v1/rpc/...`),
dont des fonctions sensibles (`deduct_ai_credits`, `get_org_integration`, `get_vivier_*`).

---

## P0 — À traiter en priorité

### 1. 52 fonctions SECURITY DEFINER exécutables par `anon` (et 52 par `authenticated`)

Source : Supabase security advisors (live, 2026-06-10) — `anon_security_definer_function_executable` ×52,
`authenticated_security_definer_function_executable` ×52.

Toute personne **non authentifiée** peut appeler ces fonctions via `POST /rest/v1/rpc/<name>` avec
la clé anon (publique). Comme elles sont `SECURITY DEFINER`, elles s'exécutent avec les droits du
propriétaire et **contournent la RLS**. Cause probable : la migration de grants bootstrap
(`20260421180000`) + default privileges qui s'appliquent aussi aux fonctions.

Fonctions les plus sensibles exposées à `anon` :

| Fonction | Risque si appelée par anon |
|---|---|
| `deduct_ai_credits(org_id, user_id, amount, ...)` | Vider les crédits IA de n'importe quelle org |
| `get_org_integration(org_id)` | Lire les credentials d'intégration d'une org (Unipile keys ?) |
| `get_vivier_candidates / _companies / _contacts` | Exfiltrer le vivier CRM |
| `enqueue_email / read_email_batch / delete_email / move_to_dlq` | Injecter/lire/supprimer des emails en file |
| `invoke_process_sequences / _email_queue / _inmail_queue / ...` | Déclencher les crons à volonté |
| `increment_enrichment_quota`, `sync_credit_balance_from_subscription` | Corrompre quotas/facturation |
| `check_rate_limit`, `acquire_sequence_lock`, `record_webhook_event` | Contourner rate-limit / DoS logique |

Note : certaines sont légitimes pour `anon`/`authenticated` (`get_portal_token(p_token)` est
token-based by design ; `is_org_member`, `has_role`, `get_org_role` sont des helpers RLS qui doivent
rester exécutables par `authenticated`). Les triggers (`handle_new_user`, `enforce_role_hierarchy`…)
ne sont pas appelables utilement via RPC mais devraient quand même être révoqués par hygiène.

**Remédiation** (migration à écrire) :
```sql
-- Pour chaque fonction non destinée au client :
REVOKE EXECUTE ON FUNCTION public.deduct_ai_credits(uuid, uuid, integer, text, text) FROM anon, authenticated;
-- + empêcher la récidive :
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
-- puis re-GRANT explicitement les seules fonctions client (has_role, is_org_member, get_portal_token, ...)
```
Réf : https://supabase.com/docs/guides/database/database-linter?lint=0011_function_security_definer

⚠️ Avant de révoquer : vérifier quelles RPC le frontend appelle réellement (`grep -r "\.rpc(" src/`)
et tester l'onboarding (le fix grants du 2026-04-21 a été fait justement pour un problème de permissions).

### 2. Advisors Auth (configuration dashboard, 2 minutes)

- **Leaked password protection désactivée** — activer la vérif HaveIBeenPwned :
  https://supabase.com/docs/guides/auth/password-security
- **Options MFA insuffisantes** — activer au moins TOTP :
  https://supabase.com/docs/guides/auth/auth-mfa

---

## P1 — Important

### 3. Frontend : boucle de recherche sans annulation
`src/hooks/useLinkedInSearchActions.ts:780` — `handleSearch` enchaîne jusqu'à 15 rounds de fetch
Unipile (20-30 s au total) sans AbortController ni flag `cancelled`. Si l'utilisateur change d'onglet,
de mission, ou relance une recherche pendant un batch : les rounds continuent en arrière-plan
(consommation de quota LinkedIn), et deux recherches concurrentes peuvent se marcher dessus sur
`setResults`. Fix : un `searchRunIdRef` incrémenté à chaque lancement, vérifié après chaque `await`
(même pattern que le guard `initialJobId` déjà en place dans `useLinkedInScoring.ts:1074`).

### 4. Frontend : échec silencieux de la persistance des profils découverts
`src/hooks/useLinkedInSearchActions.ts:927` — `candidateStatus.batchDiscover(...).catch(console.error)`.
Fire-and-forget volontaire (ne pas bloquer l'UI, ok), mais en cas d'échec les profils affichés
n'existent pas en base → incohérences plus tard (statuts, scoring). Minimum : un toast discret
« Certains profils n'ont pas pu être enregistrés » + retry.

### 5. Frontend : dépendance objet dans useEffect
`src/hooks/useLinkedInSearch.ts:519` — `}, [activeProject?.id, activeProject?.job_details, enabledCompetitors])`.
`job_details` est un objet : chaque refetch React Query crée une nouvelle référence → le synthetic
job est reconstruit même sans changement réel. C'est exactement le pitfall documenté dans CLAUDE.md.
Fix : `JSON.stringify(activeProject?.job_details)` mémoïsé, ou un champ `updated_at` du brief.

### 6. Spinner de scoring potentiellement bloqué
`src/hooks/useLinkedInScoring.ts:~856` — `setScoringInProgress(true)` est posé avant certaines
validations ; un early-return après laisse le spinner actif. Envelopper dans `try/finally`.

### 7. Branding : messages d'erreur edge functions exposant des vendors
- `supabase/functions/scan-recruiter-linkedin/index.ts:268` — `"Configuration Apollo manquante"`
  (message FR destiné à l'affichage). → « Configuration d'enrichissement manquante ».
- `supabase/functions/refresh-pedigree-by-funding-stage/index.ts:256` — `"APOLLO_API_KEY not configured"`
  retourné en JSON. → message générique (fonction cron, risque faible mais non conforme).

Le sanitizer `src/lib/sequenceErrorMessages.ts` couvre les séquences mais pas ces fonctions.

---

## P2 — Mineur / hygiène

### Base de données
- `rls_enabled_no_policy` ×2 (dont `gdpr_erasures`) : RLS activée sans policy = deny-all. Sans danger,
  mais à documenter si intentionnel (accès service-role uniquement).
- `contact_submissions` : policy `anon_insert` `WITH CHECK (true)` — formulaire de contact public,
  probablement voulu, mais vecteur de spam : ajouter rate-limit/captcha côté edge.
- Bucket public `event-images` : 3 policies SELECT larges sur `storage.objects` qui permettent le
  **listing** du bucket. Restreindre le listing si non nécessaire (`public_bucket_allows_listing`).
- 11 fonctions sans `SET search_path` (`enqueue_email`, `move_to_dlq`, `read_email_batch`,
  `delete_email`, `cosine_similarity_match`, triggers `*_updated_at`…) — ajouter
  `SET search_path = public` (hardening contre le search_path hijacking).
- Extensions `vector`, `unaccent`, `pg_trgm` dans le schéma `public` — à déplacer vers `extensions`
  à l'occasion (faible priorité, migration délicate pour `vector` à cause des colonnes typées).
- Migrations legacy `20260210105248` / `20260210110708` : policies `USING (true)` sur les tables
  sequences — **corrigées par des migrations ultérieures** (confirmé : les advisors live ne flaggent
  plus ces tables). Rien à faire, noté pour l'historique.

### Frontend
- `as any` répandus dans `useLinkedInScoring.ts` (certifications, volunteering, projects…) — champs
  non typés dans `LinkedInProfile`. Ajouter les champs optionnels au type.
- `src/pages/ScorecardFullPage.tsx:774` — URL `logo.clearbit.com` hardcodée (vendor visible dans le
  network tab + dépendance non déclarée). Passer par le même mécanisme de logo que le reste de l'app.
- `src/index.css:361` — commentaire `/* Claude/Notion-style ... */` : interne donc toléré, renommer
  à l'occasion.

### Dépendances
- `@dnd-kit/sortable` et `remark-gfm` : 0 import dans `src/` → supprimables de `package.json`.
- Aucune duplication de libs détectée.

### Dette
- 3 TODO seulement dans les edge functions (rgpd-erase-contact v2, notification email stripe-webhook,
  clarification text-action), aucun critique. 0 TODO dans `src/`.

---

## Ce qui est sain (vérifié)

- **Edge functions : 0 violation.** 36 fonctions avec `requireAuth`, 38 avec `verifyOrgMembership` ;
  les fonctions sans auth JWT sont toutes des webhooks signés (Stripe HMAC, Calendly HMAC, Svix,
  token Unipile/Aircall, comparaison constant-time) ou des crons service-role org-scopés.
- **100 % des fetch externes passent par `fetchWithTimeout`.** Aucun fetch nu.
- **Tous les appels Anthropic settlent les crédits** (`settleCredits`), aucun model ID deprecated.
- **Pas de global mutable de credentials** (pattern credential-bleed absent).
- **Pas de secret en dur, pas de `.env` commité**, clés via `Deno.env.get()` partout.
- **`window.confirm` : 0 occurrence** (un wrapper AlertDialog `src/lib/confirmAlert.tsx` existe).
- **Tous les `supabase.functions.invoke()` du frontend pointent vers des fonctions existantes.**
- **`npx tsc --noEmit` : 0 erreur.**
- Le guard anti race-condition cross-projet du scoring (`initialJobId`, `useLinkedInScoring.ts:863/1074`)
  est bien en place et fonctionnel.

---

## Addendum 2026-06-10 (après-midi) — remédiation P0.1 + nouveau finding

**P0.1 traité** par la migration `supabase/migrations/20260610120000_revoke_function_grants_hardening.sql` :
- Cause racine identifiée : `20260421180000_grants_bootstrap_owner_uniques.sql` faisait
  `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated` + le même grant en
  default privileges pour toutes les fonctions futures.
- Inventaire vérifié : le frontend n'appelle que `get_vivier_contacts`, `get_vivier_companies`,
  `get_email_signatures` et `get_portal_by_token` ; **tous** les `.rpc()` des edge functions
  utilisent un client service_role (non impacté).
- 42 fonctions internes révoquées pour `anon` + `authenticated` ; `get_vivier_contacts/_companies`
  révoquées pour `anon` seulement ; helpers RLS (`has_role`, `is_org_member`, `get_user_org_id`…)
  et fonctions token-scoped (`get_email_tracking_by_id`, `get_portal_by_token`) conservés avec
  re-GRANT explicite ; default privileges corrigés (les futures fonctions ne seront plus
  exécutables par les clients sans GRANT explicite).

**🔴 Nouveau finding P0 découvert pendant l'inventaire — vivier exposé cross-org :**
les fonctions `get_vivier_contacts` / `get_vivier_companies` / `get_vivier_candidates` sont
`SECURITY DEFINER` (bypass RLS sur les tables `airtable_*`) et **ne vérifient pas l'org de
l'appelant en interne**. Le gate « Prospection = agency-only » n'existe que côté client
(`featureGates.ts`). Conséquence : n'importe quel utilisateur authentifié d'une org cliente
(enterprise/freelance) peut lire l'intégralité du CRM vivier Konekt via
`POST /rest/v1/rpc/get_vivier_contacts`. La migration ci-dessus réduit la surface (anon révoqué,
`get_vivier_candidates` entièrement révoquée).

**✅ Fix complet appliqué** par `supabase/migrations/20260610130000_vivier_agency_guard.sql` :
`get_vivier_contacts` et `get_vivier_companies` redéfinies (corps identique à la dernière
version 20260409140625, vérifié par diff) avec un garde en tête : `service_role` passe
(les agent-tools les appellent via adminClient, `auth.uid()` NULL dans ce cas), sinon
l'appelant doit être membre d'une org `org_type = 'agency'`, sinon erreur 42501 avec
message générique. Vérification post-déploiement : page Prospection OK pour une org agency,
`POST /rest/v1/rpc/get_vivier_contacts` avec un JWT d'org enterprise → 403.

## Plan d'action suggéré (ordre)

1. **Migration REVOKE EXECUTE** sur les SECURITY DEFINER (P0.1) — après inventaire des `.rpc()` frontend.
2. Activer leaked-password protection + TOTP dans le dashboard Auth (P0.2).
3. Annulation de la boucle de recherche + toast sur échec `batchDiscover` (P1.3, P1.4).
4. Les 2 messages d'erreur Apollo user-facing (P1.7) — quick win.
5. `SET search_path` sur les 11 fonctions + policy listing bucket (P2).
6. Nettoyage deps inutilisées + typage des champs profil (P2).
