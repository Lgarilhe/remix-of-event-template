# LOGBOOK.md — Journal de bord Konekt AI Platform

Un entry par décision, spec, insight, ou action majeure. Ajouté en fin de chaque conversation pro importante avec Claude Code. Du plus récent en haut.

**Format strict** : date ISO, type, titre, corps. Pas de padding, pas d'emoji dans les titres, pas de "j'ai fait" — seulement le fait.

---

## Template d'entry

```markdown
## AAAA-MM-JJ — <TYPE> — <Titre court>

**Contexte** : 1-2 phrases.
**Décision / Fait** : ce qui a été tranché ou livré.
**Raison** : pourquoi (si non évident).
**Impact** : fichiers touchés, modules, users concernés.
**Reste à faire** : bullets courts. `[ ]` ouvert, `[x]` fait.
**Refs** : commit SHA, ticket, URL Notion, page Airtable.
```

**Types autorisés** :
- `DECISION` — choix d'architecture, de lib, de process
- `SPEC` — nouvelle feature spécifiée (sortie de /spec)
- `SHIP` — déploiement (staging ou prod)
- `INSIGHT` — apprentissage, gotcha, surprise technique
- `BUG` — bug identifié (ouvert ou fermé)
- `REFACTOR` — restructuration significative
- `SECURITY` — finding sécurité (audit, fix, alerte)
- `ROLLBACK` — retour arrière
- `MEETING` — synthèse d'une discussion externe (client, équipe)

---

## 2026-04-21 — SHIP — Migration Lovable → Vercel + Supabase achevée

**Contexte** : bascule du backend Konekt de Lovable Cloud vers un projet Supabase self-managed (`konekt-production`, ref `crckfywoyjxkawathdff`, West EU Ireland), frontend repositionné sur Vercel (https://konekt-app-navy.vercel.app). L'onboarding était cassé en prod sur "permission denied for table organizations", 0 secrets Supabase configurés, deploy des edge functions bloqué.

**Décision / Fait** :
- Schéma Supabase importé (88 tables, 194 policies RLS, 3 plans seed) — fichier `MIGRATION_CLEAN.sql` gardé à la racine comme référence.
- Bug RLS résolu : root cause = GRANTs manquants à la role `authenticated` (schema importé sans les privileges standard Supabase). Fix appliqué via `fix-organizations-rls.sql` : GRANT SELECT/INSERT/UPDATE/DELETE sur toutes les tables public + default privileges pour les futures.
- Deploy des edge functions débloqué : suppression du bloc `[functions.copilot]` orphelin dans `supabase/config.toml` (dossier inexistant) + correction du `project_id`. **77/77 fonctions déployées** sans erreur.
- Inventaire complet des secrets requis (26 secrets au total dont 6 critical, 8 important, 12 optional) — détail dans CLAUDE.md section "Supabase secrets".
- Vercel SPA rewrites déjà commit précédent (`vercel.json`).

**Raison** : sortir de la dépendance Lovable avant le weekend 2026-04-25 pour avoir un stack full-contrôlé (git → Vercel + Supabase CLI).

**Impact** :
- `CLAUDE.md` : nouvelle section stack + infra + runbook hotfix + liste secrets + auth URL config.
- `supabase/config.toml` : `project_id` → `crckfywoyjxkawathdff`, bloc copilot retiré, note auth URL config.
- `supabase/migrations/20260309170000_invalidate_match_scores_on_job_update.sql` : no-op (la table `public.jobs` n'existe pas dans le nouveau schéma).
- `fix-organizations-rls.sql` : nouveau, à rejouer si un reset/restore casse les grants.
- Frontend : ~zéro changement, branche main auto-deploy Vercel.

**Reste à faire** :
- [ ] Setter les 6 secrets CRITICAL dans le Dashboard Supabase : `ANTHROPIC_API_KEY`, `LOVABLE_API_KEY`, `OPENAI_API_KEY`, `UNIPILE_API_KEY`, `UNIPILE_DSN`, `NOTION_API_KEY` (+ 3 `NOTION_*_DB_ID`), `STRIPE_SECRET_KEY`.
- [x] Configurer Site URL + Redirect URLs dans le Dashboard Auth.
- [ ] Setter les secrets IMPORTANT (Apollo, PDL, webhooks) pour débloquer enrichissement et webhooks.
- [x] Tester onboarding end-to-end — débugging complet des 3 bugs RLS/triggers (voir 2026-04-21-bis).
- [ ] Rejouer un premier scoring LinkedIn pour valider la chaîne Unipile + score-profile-job.

**Refs** : commits à venir sur main — voir `git log` après push.

---

## 2026-04-21 — REFACTOR — Sortie totale de Lovable (emails → Resend)

**Contexte** : Après la migration AI Gateway Lovable → Anthropic direct, il restait 3 fonctions email qui dépendaient encore de Lovable (SDK `@lovable.dev/email-js` + webhooks `@lovable.dev/webhooks-js`). Objectif : couper totalement Lovable.

**Décision / Fait** :
- `process-email-queue` : remplace `sendLovableEmail` par fetch direct à l'API Resend (`https://api.resend.com/emails`). Gère 429 (Retry-After), 401/403 (auth → DLQ immédiat), 422 (validation → DLQ), autres erreurs (log + VT retry). Ajoute `Idempotency-Key` + `List-Unsubscribe` RFC 8058 + `X-Entity-Ref-ID`. Log enrichi avec `{provider: 'resend', resend_email_id}` dans metadata.
- `preview-transactional-email` : remplace l'auth `LOVABLE_API_KEY` par comparaison `token === SUPABASE_SERVICE_ROLE_KEY`. La fonction rend juste les templates React Email, n'envoie pas.
- `handle-email-suppression` : réécrit pour le format Resend webhook (événements `email.bounced`, `email.complained`, `email.delivery_delayed`). Verification de signature Svix (HMAC-SHA256 sur `${svix-id}.${svix-timestamp}.${body}` avec `whsec_<base64>`, rejet si timestamp > ±5 min). Mapping vers `suppressed_emails.reason` ('bounce' / 'complaint'). Unsubscribes restent gérés par `handle-email-unsubscribe` (endpoint One-Click déjà existant).
- Nouvelle migration `20260421200000_suppressed_emails_unique.sql` : ajout UNIQUE sur `suppressed_emails.email` (nécessaire pour l'upsert `onConflict: 'email'`).
- 3 fonctions redéployées, 0 erreur.

**Raison** : simplification de la stack, élimination de la dépendance Lovable, control total de la delivery (domaines vérifiés côté Resend, logs consultables).

**Impact** :
- `supabase/functions/process-email-queue/index.ts` : réécriture complète, fetch direct Resend.
- `supabase/functions/preview-transactional-email/index.ts` : auth guard changé.
- `supabase/functions/handle-email-suppression/index.ts` : réécriture complète pour webhook Resend/Svix.
- `supabase/migrations/20260421200000_suppressed_emails_unique.sql` : nouveau.
- `CLAUDE.md` : `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET` ajoutés, `LOVABLE_API_KEY` retiré partout.

**Reste à faire** :
- [ ] Setter `RESEND_API_KEY` dans les secrets Supabase.
- [ ] Vérifier le(s) domaine(s) d'envoi dans le dashboard Resend (sinon emails depuis `@konekt.fr` refusés).
- [ ] Configurer le webhook Resend Dashboard → Webhooks : endpoint = `https://crckfywoyjxkawathdff.supabase.co/functions/v1/handle-email-suppression`, cocher events `email.bounced` + `email.complained`, récupérer le `whsec_xxx` → setter comme `RESEND_WEBHOOK_SECRET`.
- [ ] Tester un envoi bout en bout : créer une invitation d'équipe → vérifier réception + log `email_send_log` avec `status=sent` + `metadata.provider='resend'`.

**Refs** : commit à venir. Fichiers clés : `process-email-queue/index.ts`, `handle-email-suppression/index.ts`.

---

## 2026-04-21 — REFACTOR — Sortie de Lovable AI Gateway, passage à Anthropic direct

**Contexte** : 16 fonctions edge appelaient le Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`) avec `LOVABLE_API_KEY` pour utiliser principalement Google Gemini 2.5 Flash / 3 Flash Preview. Laurent veut couper la dépendance à Lovable post-migration Supabase.

**Décision / Fait** :
- Nouveau helper `supabase/functions/_shared/call-claude.ts` : drop-in replacement qui prend le même payload (messages, tools, tool_choice, response_format, temperature, max_tokens) et le convertit en appel Anthropic Messages API directe. Gère retries 429/529, timeout, JSON mode (via consigne system), tool use (conversion OpenAI ↔ Anthropic).
- Migration des 16 fonctions : ai-chat-completion, analyze-linkedin-profile, analyze-response, audit-employer-brand, auto-categorize-chats, detect-profile-fraud, enrich-company (8 blocs tools), fetch-notion-jobs, generate-call-report, generate-recruiter-bio, generate-scorecard, live-coach, nurturing-analyzer, process-debrief, screen-candidate.
- Modèle par défaut : `claude-haiku-4-5-20251001` (aussi rapide que Gemini Flash, meilleur pour reasoning/extraction).
- `LOVABLE_API_KEY` toujours utilisé par 3 fonctions email (`process-email-queue`, `preview-transactional-email`, `handle-email-suppression`) — service Lovable Email, à migrer séparément (Resend/Postmark/SES selon choix).
- Les 15 fonctions AI redéployées, 0 erreur. `enrich-company` = le plus gros morceau (~1900 lignes, 8 blocs tools convertis).

**Raison** : 1 seul vendor AI (Anthropic) simplifie la gestion des clés et aligne avec CLAUDE.md qui préconise déjà Claude Sonnet/Haiku. Élimine un middleman.

**Impact** :
- `supabase/functions/_shared/call-claude.ts` (nouveau, ~200 lignes).
- 15 fonctions edge modifiées.
- `CLAUDE.md` : section secrets mise à jour, `LOVABLE_API_KEY` déplacé de CRITICAL vers "DEPRECATED — à migrer" (pour les emails uniquement).

**Reste à faire** :
- [ ] Setter `ANTHROPIC_API_KEY` dans les secrets Supabase pour que tout marche.
- [ ] Décider du provider email de remplacement (Resend par défaut) et migrer les 3 fonctions restantes.
- [ ] Valider un scoring LinkedIn + un audit employer-brand pour vérifier que la chaîne Claude fonctionne en prod.

**Refs** : commit à venir. Fichier clé : `supabase/functions/_shared/call-claude.ts`.

---

## 2026-04-21 — BUG — Onboarding org creation : 3 bugs en cascade (RESOLVED)

**Contexte** : après la migration Supabase, la création d'organisation pendant l'onboarding échouait avec "new row violates row-level security policy for table organizations". Symptôme côté UI : impossible de passer l'étape "Parlez-nous de vous" (scene org).

**Décision / Fait** : 3 bugs distincts découverts en cascade pendant le debug, tous patchés dans `fix-organizations-rls.sql` :

1. **GRANTs manquants** (fix initial) — la role `authenticated` n'avait aucun privilège sur les tables `public.*`. Fix : GRANT SELECT/INSERT/UPDATE/DELETE à authenticated + default privileges.

2. **Catch-22 enforce_role_hierarchy** — le trigger `handle_new_organization` (AFTER INSERT) tentait d'ajouter le créateur comme 'owner' dans `organization_members`, mais le trigger BEFORE `enforce_role_hierarchy` bloquait : "Only owners can assign the owner role". Or personne n'est owner d'une org qui vient d'être créée. Fix : ajout d'une clause bootstrap dans `enforce_role_hierarchy` — laisser passer si c'est le tout premier membre de l'org ET que le user = created_by de l'org.

3. **UNIQUE constraint manquante sur ai_credit_balances** — la fonction `sync_credit_balance_from_subscription` fait `ON CONFLICT (organization_id) DO UPDATE` mais la contrainte UNIQUE n'existait pas → cascade de triggers cassée à la création d'org. Fix : `ADD CONSTRAINT ... UNIQUE (organization_id)`.

4. **Race condition sur members_select / RETURNING** — `INSERT ... RETURNING *` via supabase-js évaluait `is_org_member(auth.uid(), id)` pour le RETURNING, mais à un moment où le trigger AFTER n'avait pas encore inséré le user dans `organization_members` (ou visibility glitch PostgREST). Résultat : erreur RLS bien que l'INSERT ait réussi. Fix : étendre `members_select` pour accepter aussi `created_by = auth.uid()` — sémantiquement normal (le créateur doit pouvoir voir sa propre org).

**Raison** : le schéma importé depuis Lovable avait des triggers et policies qui supposaient implicitement des grants/conventions Supabase que l'import n'a pas transférés.

**Impact** :
- `fix-organizations-rls.sql` : 4 sections + vérification post-fix DO block, idempotent (rejouable).
- DB prod : policies/constraints/trigger fn mis à jour.
- `LOGBOOK.md` + `CLAUDE.md` : doc.

**Bug #5 — UNIQUE constraints perdues à l'import Lovable** : 8 autres tables avaient le même problème (contraintes UNIQUE disparues), bloquant les upserts client (`SceneProfile` onboarding, `ConnectorSettings`, `useJobCandidateStatus`, `useMemberLinkedInAccounts`, etc.). Fix : loop DO block dans `fix-organizations-rls.sql` qui ajoute idempotemment les UNIQUE sur `profiles`, `connector_instances`, `chat_categories`, `job_candidate_status`, `member_email_accounts`, `member_linkedin_accounts`, `member_quotas`, `message_analysis_cache` (+ celles déjà patchées).

**Reste à faire** :
- [x] Valider l'onboarding complet jusqu'au dashboard (testé OK 2026-04-21 soir).
- [x] Transformé en migration datée : `supabase/migrations/20260421180000_grants_bootstrap_owner_uniques.sql`, marquée `applied` en remote via `supabase migration repair`.

**Refs** : commits `00acc732` + `bb9b1ec1` (bug #5 UNIQUE constraints) + commit de consolidation. Migration : `20260421180000_grants_bootstrap_owner_uniques.sql`.

---

## 2026-04-20 — DECISION — Package Claude Code consolidé livré

**Contexte** : 25 fichiers (CLAUDE.md + 15 skills + settings + 4 guides + LOGBOOK + PROMPTS + routines) prêts à être déposés dans le repo Konekt AI Platform.
**Décision** : structure finale adoptée, plus de versions parallèles.
**Raison** : éviter la dérive documentaire et les règles contradictoires entre fichiers.
**Impact** : `CLAUDE.md`, `.claude/settings.json`, `skills/*.md` remplacent toute version antérieure.
**Reste à faire** :
- [ ] Déposer le package dans le repo
- [ ] Tester /go sur une feature réelle
- [ ] Ajuster PROMPTS.md après 2 semaines d'usage
**Refs** : conversation du 2026-04-20.

---

## Règles d'usage

1. **Une ligne suffit si c'est tout ce qui est vrai.** Pas d'étirement artificiel.
2. **Pas de PII client dans LOGBOOK.md.** Noms de candidats, emails, téléphones interdits. Remplacer par des IDs.
3. **Les `BUG` ouverts restent en haut** jusqu'à fermeture (flag `[RESOLVED]` dans le titre + date de résolution).
4. **Chaque `SHIP` référence le commit SHA et la cible** (staging ou prod).
5. **Relecture hebdo** : lundi matin, parcourir les 7 derniers jours. Ce qui est `[ ]` depuis 7+ jours → soit fait, soit fermé, soit escaladé.

---

## Anti-patterns à éviter

- ❌ `J'ai implémenté la feature X` → le verbe à la 1ère personne n'ajoute rien.
- ✅ `SPEC — Feature X : scope, contrats, limites`.

- ❌ Entry de 10 paragraphes avec code inline → mettre le code dans le repo, lier le commit.
- ✅ Entry de 5 bullets + `Refs: <SHA>`.

- ❌ `INSIGHT — Claude Code est cool` → vide.
- ✅ `INSIGHT — Playwright échoue sur Safari mobile à cause de <raison précise>, workaround : <X>`.

---

*Ce fichier est lu par Claude Code en début de chaque conversation via la skill /status. Garder concis pour ne pas polluer le contexte.*
