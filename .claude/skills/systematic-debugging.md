---
description: "Méthode systématique de root cause analysis pour les bugs Konekt. Utiliser quand l'user dit 'ça marche pas' / 'bug bizarre' sans détail, race condition suspectée, RLS permission denied, missionSearchCache buggé, credential bleed possible, état incohérent après tab switch, ou bug qui n'apparaît qu'en prod."
---

# Systematic Debugging — Konekt

Méthode 4 phases inspirée de `obra/superpowers`, adaptée aux gotchas spécifiques de Konekt.

**À ne pas confondre avec `/debug`** (slash command native Claude Code = debug de l'app Claude Code, pas du code).

## Phase 1 — Reproduire et délimiter

1. **Reproduire** le bug à l'identique. Étapes exactes, données exactes, env exact.
   - Si pas reproductible → c'est probablement une race condition ou un état corrupted.
   - Demander à l'user les étapes EXACTES (screenshot/vidéo si flou).
2. **Délimiter le scope** : quel flow, quel composant, quel hook, quel edge function ?
3. **Snapshot** : console réseau (DevTools), logs Supabase (`[function-name]`), state React.
4. **Hypothèse initiale explicite** : "Je pense que X parce que Y" — pas deviner silencieusement.

## Phase 2 — Tracer le flow (checklists Konekt-specific)

### 🎨 Bug d'état UI (le composant n'affiche pas ce qu'on attend)

1. Vérifier `useEffect` deps :
   - `activeProject` (object ref) vs `activeProject?.id` (primitive) — si object → re-fire infini garanti
   - Voir CLAUDE.md "useEffect — avoid object deps"
2. Vérifier le `missionSearchCache` (Map in-memory) — restore-t-il un état stale au tab switch ?
   - Cache restore SKIPS `selectedJob` mais restaure le reste. Tout changement de hook state peut être écrasé.
3. Vérifier les hydration refs (`hydratedCacheKeyRef`, `pendingLocationRef`)
4. React Query staleTime (5min sur `useSourcingProjects`) — données peut-être pas fraîches
5. Synthetic job creation — `activeProject?.id` ou `activeProject?.job_details` ont-ils bien changé ?

### ⚙️ Bug d'edge function (500, données manquantes, comportement étrange)

1. Logs Supabase : grep `[function-name]` dans les logs Dashboard
2. `requireAuth(req, corsHeaders)` appliqué ? `verifyOrgMembership` si `organization_id` vient du body ?
3. **Credential bleed** : grep `let.*_API_KEY` dans la fonction — interdit (CLAUDE.md "NEVER use mutable globals")
4. `fetchWithTimeout` utilisé pour external HTTP ? Bare `fetch()` = timeout indéfini possible
5. `settleCredits` appelé après tout call Anthropic ? (sinon comptabilité crédits cassée)
6. AI model ID valide ? Seuls `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5-20251001` autorisés. Jamais `claude-sonnet-4-20250514` ou autre ID obsolète.
7. DSN Unipile : `https://${creds.dsn}` direct = bug si DSN déjà préfixé → `https://https://...`. Toujours utiliser le ternaire `creds.dsn.startsWith('http') ? creds.dsn : 'https://' + creds.dsn`
8. Timeout budget : 60s max sur Supabase — batch LLM calls doivent fit dedans

### 🔒 Bug RLS / multi-tenant (permission denied, leak cross-org)

1. La table a-t-elle `ENABLE ROW LEVEL SECURITY` ?
2. Policies présentes :
   - "Service role full access" (edge functions en bypass)
   - "Org members can view/create/update/delete"
3. **GRANTs** appliqués (gotcha du 21/04) : table accessible à role `authenticated` ?
4. Index sur `organization_id` ? (mandatory pour perf RLS)
5. Helper functions : `public.get_user_org_id(auth.uid())` pour USING, `public.is_org_member(...)` pour WITH CHECK
6. Legacy rows (`organization_id IS NULL`) : policy gère le `OR (organization_id IS NULL AND created_by = auth.uid())` ?
7. Bootstrap owner (`enforce_role_hierarchy`) : pas de loop infini sur premier user ?

### 🔗 Bug Unipile / LinkedIn

1. Type de licence ? (`classic` / `recruiter` / `sales_navigator`) — features dispos diffèrent (voir CLAUDE.md "Key Differences by License")
2. Auto-retry 3x sur erreur `multiple_sessions` actif ? (0ms / 6s / 15s)
3. Keywords > 200 chars → `CONTENT_TOO_LARGE` → vérifier auto-truncate
4. 429 RATE_LIMIT → retry après 60s + toast français ?
5. Account status `CREDENTIALS` → prompt user reconnect ?
6. Webhook reçu mais pas d'action → vérifier event type matche (`new_relation`, `message_received`, `account_*`)

### 📊 Bug Apollo (Base Konekt)

1. `total_entries` lu au **TOP LEVEL** (pas dans `pagination`) ?
2. `q_keywords` capé à 500 chars ? `q_organization_name` à 200 chars ?
3. `person_locations` format simple ("Paris, France" pas "Île-de-France, Hauts-de-France, France") ?
4. Boolean syntax dans keywords → cleaned vers simple terms ?
5. Quand `person_titles` présent, `q_keywords` réduit à max 4 termes ?
6. Pagination : envoyer `page: 2, 3, ...` — pas `offset`
7. linkedin_url manquant → c'est normal sur `mixed_people/api_search`, faut passer par `bulk_match` (1 crédit/profil)

### 🎯 Bug sourcing / synthetic job

1. `activeProject` existe → synthetic job créé avec `id: "project:{projectId}"` ?
2. `filters_snapshot` au format AI (`skills_keywords`, `location_keywords`) → transformation l.266-306 de `useLinkedInSearch` appliquée ?
3. Location en `pendingLocationRef` car pas de compte LinkedIn connecté → résolution déférée OK ?
4. Cache restore n'override pas le synthetic job (guard l.218) ?

## Phase 3 — Distinguer symptôme / cause proche / root cause

Avant de fix, écrire les 3 niveaux :
- **Symptôme** : ce que l'user voit (ex: "le bouton ne fait rien")
- **Cause proche** : le code qui produit le symptôme (ex: "handler pas attaché au onClick")
- **Root cause** : pourquoi ce code est cassé (ex: "useEffect re-fire infini → reset du state → handler perdu")

**Ne jamais fix juste le symptôme.** Le fix doit cibler la root cause, sinon le bug reviendra ailleurs.

## Phase 4 — Vérifier le fix

1. Reproduire le scénario initial → doit passer
2. Tester les scénarios adjacents :
   - Tab switch → refresh → back/forward navigation
   - Edge case : data vide, data très grande, data malformée
3. Lancer `qa.md` avec persona pertinent :
   - **Théo** pour security/race conditions/multi-tenant
   - **Guillaume** pour flows power-user
   - **Claire** pour UX client final
   - **Sophie** pour mobile
4. Vérifier pas de régression sur d'autres flows utilisant le même code (grep call sites)

## ❌ Anti-patterns à éviter absolument

- ❌ "Ça marche maintenant, je sais pas pourquoi" → tu as fix le symptôme, pas la cause. Continue jusqu'à comprendre.
- ❌ Ajouter `setTimeout` pour "donner le temps que ça se charge" → bug temporel masqué, reviendra
- ❌ `try/catch` silencieux qui swallow l'erreur → masque le vrai problème
- ❌ `data?.foo?.bar?.baz` partout pour éviter un crash → root cause = pourquoi la structure est inattendue ?
- ❌ `window.location.reload()` → aveu d'échec sur gestion d'état
- ❌ Fix dans le composant alors que le bug est dans le hook → tu mets un pansement
- ❌ Ajouter un `useEffect` pour "synchroniser" des states qui devraient déjà l'être → empile la complexité

## 🆘 Quand abandonner la voie pure

Si après 30 min tu tournes en rond :
1. Sortir du code, relire CLAUDE.md sections "Critical State Patterns" + "Common Pitfalls"
2. Demander à l'user les étapes EXACTES (screenshot, vidéo, console export)
3. Logs Supabase Dashboard + console.log stratégiques + re-essayer
4. Lancer un sub-agent Explore pour cross-check tous les call sites du code suspect
5. En dernier recours : git bisect entre dernier commit qui marchait et aujourd'hui
