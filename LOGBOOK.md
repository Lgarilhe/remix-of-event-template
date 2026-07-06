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

## 2026-07-02 — SHIP — Tutos vidéo in-app : popup d'aide + studio de tournage Playwright

**Contexte** : Laurent veut des popups d'aide avec vidéos tuto courtes où l'on voit la souris naviguer.
**Décision / Fait** : (1) composant générique `TutorialVideoDialog` (bouton « ? » → Dialog avec vidéo autoplay muted loop + points clés) — chaque écran peut monter son tuto ; premier montage : header Pipeline (« Le pipeline en 30 secondes », public/tutos/pipeline-tour.webm, 2,1 Mo / 27 s). (2) Studio de tournage : harnais Playwright (app réelle + Supabase intercepté, mocks STATEFUL pour que le drag persiste à l'écran) + recordVideo, curseur factice injecté (suivi mousemove, ripple au clic) + barre de sous-titres injectée pilotée depuis le script. Scénario : funnel → clic tuile → drag Sarah vers Entretien technique (toast) → fiche candidat → outro. Sortie webm VP8 (le ffmpeg Playwright n'a pas libx264 — pas de mp4 ; lisible partout sauf très vieux Safari).
**Raison** : onboarding visuel sans dépendance à un outil externe (Loom etc.) — reproductible à chaque évolution d'écran en relançant le script.
**Impact** : src/components/help/TutorialVideoDialog.tsx, MissionPipeline (montage), public/tutos/.
**Reste à faire** :
- [ ] Tuto sourcing (pills, toggle À l'écoute) avec le même studio
- [ ] Pièges de tournage documentés : cibler les cartes par classe (le toast sonner peut porter le même texte), attendre la disparition des toasts, scrollIntoViewIfNeeded avant clic (sinon clic sidebar)
**Refs** : MissionPipeline.tsx, TutorialVideoDialog.tsx

---

## 2026-07-02 — SHIP — Vue Pipeline mission : données réparées (project_id, RPCs) + refonte DA v2

**Contexte** : Pipeline débloqué le même jour → l'user découvre une vue quasi vide et restée en DA brutaliste.
**Décision / Fait** : (1) job_candidate_status.project_id NULL sur 1352/1398 lignes (le sourcing ne le remplissait jamais) alors que useProjectCandidates filtre dessus → trigger BEFORE auto-résolution depuis job_id + backfill + index partiel ; (2) les 3 RPCs de 20260309170900 (get_project_stats…) n'existaient PAS en prod — jamais rejouées après le repair tracking-only de la désynchro migrations → re-créées avec fix (untreated='discovered', pas 'untreated') et gardes org (SECURITY DEFINER non borné = fuite cross-tenant) ; (3) refonte MissionPipeline en DA v2 (pills segmentées, colonnes/cartes arrondies, casse normale, suppression du double cadre) + colonne « Contacté » dans le kanban dynamique (les messaged/replied étaient noyés dans « Sourcé ») + table : hauteur viewport (350px fixes), statuts replied/scored/discovered affichés, token mort hover:text-linkedin.
**QA** : dry-run transactionnel prod (rollback) : backfill 46→1398, pipeline f0bf=434 candidats, trigger OK ; harnais Playwright avant/après PASS ; tsc+build OK.
**Itération 2 (même jour, « pas ouf, fais mieux »)** : refonte command-center issue d'un panel de 3 directions design + juge — command bar avec funnel actionnable (compteurs font-display + taux de passage entre étapes, tuiles cliquables qui scrollent vers la colonne), système de staleness (badge global « X sans mouvement +7j », compteur par colonne, âge orange sur carte), avatars initiales (hash nom→palette brand), thème sémantique des colonnes (Contacté=info, Embauché=success — plus de couleurs positionnelles), cartes denses avec LinkedIn au hover, board pleine hauteur (100dvh), toasts nominatifs (« X embauché ! »), perf 400 cartes (React.memo + content-visibility). dnd-kit inchangé.
**Itération 3 (retour fondateur : cartes non ouvrables = « nul »)** : clic sur une carte kanban → CandidateDetailModal (le modal riche de l'ATS : profil, évaluation, CV, séquences, messages, notes, rappels) avec nouvelle prop `stageOptions` pour utiliser les étapes de LA mission dans le sélecteur (au lieu des ATS_STAGES hardcodés) ; garde anti-clic-fantôme post-drag (dragHappenedRef) ; colonnes fluides flex-1 min/max-w (fini la moitié d'écran vide) ; `.thin-scrollbar` (index.css) sur colonnes + board ; CTA « Contacter les candidats » (→ tab outreach) dans la colonne Contacté vide.
**Itération 4 (question fondateur : « pourquoi pas les mêmes étapes ? »)** : sans étapes de process configurées, le board tombe sur les colonnes génériques sans l'expliquer → bannière « Board générique — définissez vos étapes d'entretien » avec CTA → tab process, affichée seulement si steps.length===0 et des candidats existent. Vérifié au navigateur (bannière, absence avec steps, navigation CTA).
**Reste à faire** :
- [ ] Persister viewMode kanban/table (localStorage) si demandé
- [ ] Insights : vérifier ce qu'il affiche maintenant que project-candidates remonte des données
- [ ] Fiche candidat : « Postes liés » affiche le job_id brut (project:{uuid}) quand pas de titre — mapper vers le nom de mission (useCandidateFullProfile)
**Refs** : migration 20260702164207, MissionPipeline.tsx, ProjectCandidatesTableEnhanced.tsx

---

## 2026-07-02 — SHIP — Filtres sourcing (À l'écoute/Shortlist), visibilité contactés, déblocage Pipeline

**Contexte** : UX sourcing dégradée — impossible de filtrer les profils à l'écoute, de retrouver ses shortlistés/contactés ; phase Pipeline grisée malgré l'activité réelle.
**Décision / Fait** : (1) pills Shortlist + toggle « À l'écoute » (spotlight OPEN_TO_WORK serveur — l'API search ne renvoie JAMAIS le flag par profil, vérifié 0/1213 en base) ; (2) useJobCandidateStatus lit les 2 formes de job_id (`project:{uuid}` et nu — l'inscription séquence normalise, le sourcing préfixait → contactés invisibles) ; (3) pills DB embarquent le pool même en vue Résultats ; (4) trigger SQL sync stats_* mission + backfill (colonnes jamais mises à jour → readiness verrouillait Pipeline à vie) ; (5) add-to-shortlist écrit enfin job_candidate_status (upsert par candidate_id, match URL par slug ; avant : UPDATE par URL stricte = 0 match, et rien du tout si Notion absent) ; pill Shortlist matche aussi la shortlist Notion par nom.
**Impact** : useLinkedInSearch, useFilteredResults, useJobCandidateStatus, useLinkedInSearchActions, LinkedInSearch, SearchResultsPanel, edge add-to-shortlist, migration 20260702121429.
**QA** : préflight tsc+build OK ; persona Guillaume (sourcing) couvert par harnais Playwright (app réelle, Supabase intercepté, 16+22 checks PASS) ; migration validée par dry-run transactionnel sur schéma prod (rollback).
**Reste à faire** :
- [ ] `supabase functions deploy add-to-shortlist` après merge
- [ ] Vérifier le workflow deploy-migrations sur le push main (backfill → Pipeline débloqué)
- [ ] Générer le spec e2e sourcing live (test.fixme du socle QA)
**Refs** : 9f71dff, 08aa113, 0de9097, 7a1298e (branche claude/sourcing-filters-visibility-r0zsr8)

---

## 2026-04-27 — SECURITY — QA 4 personas sur feature enrichment, fix sécurité multi-tenant

**Contexte** : Sprint 1+2+3 enrichment (cascade lookup + bulk + permissions + RGPD + analytics) déployés en prod sans avoir lancé `/qa` 4 personas — manquement à la skill `qa.md` "Obligatoire avant tout deploy en prod". Laurent m'a recadré → audit rétroactif lancé.

**Décision / Fait** :
- QA Théo a révélé 1 trou de sécurité CRITIQUE : `get-enrichment-status` faisait un fallback BC direct si la row n'existait pas en DB → un user pouvait brute-force des `request_id` BC valides et récupérer les emails/phones d'enrichments d'autres orgs. Fix : suppression du fallback, refus strict 404 si row absente.
- Théo bug #2 : pas de rate limit sur `get-enrichment-status` (polled 5s). Fix : ajout `check_rate_limit` 60 req/min/user.
- Théo bug #3 : double-clic sur `EnrichContactButton.handleConfirm` possible. Fix : `submitting` state + early return guard.
- Guillaume bug : `INSUFFICIENT_CREDITS` ou `QUOTA_EXCEEDED` ne stoppait pas le bulk → 70 erreurs 402 inutiles. Fix : `aborted` flag + skip workers restants + toast d'erreur explicite.
- Guillaume UX : pas de progress UI pendant le bulk. Fix : `toast.loading` updated tous les 5 profils.
- Claire bug : "cascade de fournisseurs" + "Background" anglais visibles dans modale. Fix : "plusieurs sources de données vérifiées" + "Arrière-plan".
- Sophie : modale `max-w-md` ok sur iPhone 13 portrait, pas de fix nécessaire.

**Raison** : sécurité multi-tenant non négociable, le reste UX.

**Impact** :
- `supabase/functions/get-enrichment-status/index.ts` : refus strict no-row + rate limit
- `src/components/outreach/result-card/EnrichContactButton.tsx` : submitting guard + textes FR
- `src/components/outreach/result-card/BulkEnrichButton.tsx` : aborted flag + progress toast

**Reste à faire** :
- [ ] Lancer /qa systématiquement avant chaque commit prod (pas après)
- [ ] Écrire tests unitaires pour `_shared/get-or-fetch-contact.ts`, `parseBoolean`, `cleanLocationPart`
- [ ] UI admin Settings>Équipe pour modifier `can_enrich_contacts` + `enrichment_quota_monthly` per-user (actuellement faut SQL editor)
- [ ] Webhook BC au lieu de polling (perf)

**Refs** : commit à venir (post-fixes)

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
