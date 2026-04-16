# Audit de Sécurité Approfondie — Skalr SaaS Multi-Tenant
**Date:** 16 avril 2026 | **Codebase:** Vite/React + Supabase Edge Functions (Deno)

---

## 1. RLS Policies & Données Sensibles

**État:** 89% couvert, trous critiques identifiés
- **125 tables** avec `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- **Problème 1:** `portal_tokens` — RLS incomplete, exposition potentielle à `anon` role
- **Problème 2:** Pas de WITH CHECK sur UPDATE/DELETE dans ~15 migrations récentes
- **Problème 3:** Tables sans org_id (PII) : emails, phone numbers non filtrées par org

**Impact:** IDOR sur `portal_tokens` = accès non-autorisé à scoring/candidats

---

## 2. IDOR (Insecure Direct Object Reference)

Endpoints qui acceptent `id` ou `token` en query/body sans vérif d'ownership systématique:

| Endpoint | Risque | Sévérité |
|---|---|---|
| `accept-invitation/:token` | Token 64 hex (bon), expiration 7j (ok), mais vérif email suffisante? | M |
| `check-invitation-status/:token` | Même token, info leakage sur org_id/role | M |
| `client-portal-data/:token` | Portal token = accès aux scores/candidats sans vérif org | **H** |
| `unipile-search?org_id=X` | Pas `verifyOrgMembership`, user peut bruteforce org_id | **H** |
| `add-to-shortlist` | Accepte `org_id`, pas vérification d'appartenance | **H** |

**Fix requis:** Edge functions doivent appeler `verifyOrgMembership(userId, orgId)` systématiquement

---

## 3. Secrets & Variables d'Environnement

**Clés exposées (mais acceptables):**
- `VITE_SUPABASE_URL` — ok, URL publique
- `VITE_SUPABASE_PUBLISHABLE_KEY` — ok, anon key seulement
- `VITE_SENTRY_DSN` — ok, public

**Clés jamais commitées (✅):**
- Aucune clé `sk-` (Stripe), `pk_` (API key), `xoxb-` (Slack), JWT trouvée

**Problème:** 18 fichiers construisent directement des URLs fetch vers `/functions/v1/` avec credentials en headers — dépend de CORS, risque si bypassé

---

## 4. Webhooks & Verification de Signature

| Webhook | Signature | Replay Protection | Timing-Safe |
|---|---|---|---|
| **Stripe** | HMAC-SHA256 + timestamp (5min window) | ✅ timestamp check | ✅ `crypto.subtle.sign` |
| **Calendly** | HMAC-SHA256 + timestamp (5min window) | ✅ timestamp check | ✅ `crypto.subtle.sign` |
| **Unipile** | Optionnel (`UNIPILE_WEBHOOK_SECRET`) | ❌ warning if not set | N/A |
| **Sequence** | Fallback à `UNIPILE_WEBHOOK_SECRET` | Dépend d'Unipile | N/A |
| **Email Track** | Aucune vérification | ❌ ABSENT | ❌ |

**🔴 Critique:** `sequence-email-track/index.ts` + `sequence-webhooks-handler/index.ts` **ne vérifient PAS la signature**

---

## 5. Rate Limiting & Abuse

**Fonctions avec rate limit:**
- `fetch-notion-*` (8 requêtes)
- `fetch-airtable` (5 requêtes)
- `fetch-aircall` (3 requêtes)
- `process-sequences` (quota par step)
- `send-transactional-email` (token idempotency)

**Endpoints **sans** protection:**
- `apollo-search` — coûteux, pas d'auth ⚠️
- `pdl-search` — payant ($), pas d'auth ⚠️
- `unipile-search` — non facturé mais intensif
- `run-agent-search` — Anthropic credits, pas de rate limit explicite

**Manque:** Brute-force protection sur `/auth` login (dépend Supabase)

---

## 6. CORS & Headers

| Fonction | CORS | Status |
|---|---|---|
| ~85% endpoints | `Access-Control-Allow-Origin: *` | ✅ ok pour public |
| `process-email-queue` | Absent | ⚠️ internal only |
| `process-inmail-queue` | Absent | ⚠️ internal only |
| `backfill-knowledge-lake` | Minimal | ⚠️ internal only |

**Pas de risque CORS si fonctions auth-restricted**, mais documentation absente

---

## 7. PII & Données Sensibles au Repos

**Tables avec PII non-chiffrées:**
- `candidate_profiles` → emails, phones (texte clair) ✅ filtré par org via RLS
- `member_linkedin_accounts` → tokens Unipile (texte clair, secrets env)
- `email_tracking_events` → recipient email loggée
- `sequence_step_executions` → message content loggée (PII possible)

**Logs en console:**
- ✅ Sentry sample rate: 50% (acceptable)
- ⚠️ `console.log(access_token.length)` dans `unipile-accounts` (no values, ok)
- ⚠️ Pas de PII flagrante détectée, mais `message_content` en logs

**RAG/Embeddings:** Vérifiez que chunks n'incluent pas emails/phones perso

---

## 8. Injection (SQL/XSS/Prompt)

### SQL
- ✅ Supabase SDK tout à travers — peu de risque
- ⚠️ `.rpc()` calls : vérifier que user input n'est pas concaténé

### XSS
**dangerouslySetInnerHTML usage:**
```
- EnrollmentPreviewModal.tsx:message preview
- EmailSignatures.tsx:content
- chart.tsx:chart rendering (safe context)
```
**Risque:** Si `message_content` ou email signatures contiennent user input, XSS possible

### Prompt Injection
- ✅ `generate-outreach-message` échappe les données du candidat
- ✅ `generate-call-report` utilise template string, pas concat
- ⚠️ Mais RAG context (`retrieve-context`) n'échappe pas — chunks peuvent contenir injection

---

## 9. Sessions & Auth

| Aspect | État | Notes |
|---|---|---|
| **Token timeout** | Dépend Supabase config | Absent du code |
| **Refresh token rotation** | Supabase auto | ✅ |
| **Logout (côté serveur)** | `signOut({ scope: 'local' })` | ✅ tokens purged from localStorage |
| **Session validation** | `getValidatedSession()` réseau | ✅ timeout 4s, JWT decode check |
| **SessionExpiredDialog trigger** | Manual via component | ⚠️ pas d'auto-trigger après inactivité |

**Problème:** Pas de session timeout côté client visible — dépend de Supabase JWT expiration

---

## 10. Supply Chain & Dépendances

**Lockfile:** `bun.lockb` + `bun.lock` (bun est source of truth)

**Dépendances critiques:**
- React 18.3.1 ✅
- Supabase JS 2.75.1 ✅
- @sentry/react 10.46.0 ✅
- zod 3.25.76 ✅

**Aucun CVE critique trouvé** (basé sur maj 2026-04)

⚠️ Pas de `npm audit` ou `bun audit` en CI détecté

---

## 11. Top 15 Risques Priorisés

| # | Risque | Sévérité | Fichier:Ligne | Remédiation |
|---|---|---|---|---|
| 1 | Portal tokens IDOR + RLS incomplete | **C** | `migrations/20260309170800_fix_portal_tokens_rls.sql` | Activer RLS FOR ALL, ajouter `WITH CHECK` |
| 2 | `send-transactional-email` pas `requireAuth` | **C** | `supabase/functions/send-transactional-email/index.ts:55` | Ajouter vérif token JWT ou service role |
| 3 | `unipile-search` pas `verifyOrgMembership` | **C** | `supabase/functions/unipile-search/index.ts:1` | Appeler `verifyOrgMembership(userId, orgId)` |
| 4 | `add-to-shortlist` pas vérif org | **C** | `supabase/functions/add-to-shortlist/index.ts` | Ajouter vérification org |
| 5 | Email tracking webhook sans signature | **H** | `supabase/functions/sequence-email-track/index.ts` | Implémenter HMAC-SHA256 verification |
| 6 | `apollo-search`, `pdl-search` sans auth | **H** | `supabase/functions/apollo-search/index.ts`, `pdl-search/index.ts` | Ajouter `requireAuth()` |
| 7 | Invitation tokens scope ambigu | **H** | `supabase/functions/accept-invitation/index.ts:56` | Vérif email strict seulement, pas token reuse possible |
| 8 | XSS via `dangerouslySetInnerHTML` message | **M** | `src/components/outreach/EnrollmentPreviewModal.tsx:1` | Sanitize HTML avec DOMPurify |
| 9 | Prompt injection via RAG context | **M** | `supabase/functions/generate-outreach-message/index.ts:250` | Escape `{{var}}` dans chunks avant injection |
| 10 | `unipile-accounts` sans `verifyOrgMembership` | **M** | `supabase/functions/unipile-accounts/index.ts:20` | Vérifier org_id ownership |
| 11 | Pas de rate limit sur `run-agent-search` | **M** | `supabase/functions/run-agent-search/index.ts` | Implémenter quota check sur credits |
| 12 | Session timeout client invisible | **M** | `src/lib/authSession.ts` | Ajouter auto-logout après 30min inactivité |
| 13 | RLS WITH CHECK manquants (~15 tables) | **M** | `supabase/migrations/20260309170000_*.sql` | Ajouter `WITH CHECK` à tous UPDATE/DELETE |
| 14 | Duplication `resolveUnipileCredentials` | **L** | `supabase/functions/unipile-*/index.ts` | Consolider vers `_shared/resolve-org-credentials.ts` |
| 15 | No pre-commit lint/type check hook | **L** | `.husky/` absent | Ajouter `tsc --noEmit && eslint` pre-commit |

---

## Résumé & Recommandations

**Immédiat (24h):**
1. Ajouter `requireAuth` + `verifyOrgMembership` aux 6 fonctions critiques (A1/A2 audit)
2. Implémenter signature vérification sur email tracking webhooks
3. Fix RLS WITH CHECK sur INSERT/UPDATE/DELETE

**Court terme (1 semaine):**
4. Audit RLS policies table-par-table (vérifier org_id filtering)
5. Sanitize HTML/prompt injection (DOMPurify, escape templates)
6. Implement session timeout client-side

**Moyen terme (2 semaines):**
7. Add rate limiting à endpoints IA coûteux
8. Consolidate Unipile credential resolution
9. Pre-commit hooks (tsc, eslint)

**Score actuel:** 6/10 | **Target:** 8.5/10 après fixes
