# Lot « moteur de séquences » : brief de session

Suite de l'audit `docs/audit-2026-09-01.md` (top 10, rang 7). Les lots critiques
(rangs 1 à 5, plus BUG-001 et les trois critiques non tranchés) sont déjà
corrigés et poussés sur `claude/repository-audit-pcgg0y` (commits dee6b42,
4271c00, 6ea9cf6, 4eb8e16).

## Cadre

- Modèle : Opus 5, sélectionné avec `/model` avant de lancer. Une seule
  session. Aucun agent, aucun workflow, aucun sous-agent Explore ou Plan.
- Branche : `claude/repository-audit-pcgg0y`. Avant de commencer :
  `git fetch origin main` puis vérifier qu'aucun des fichiers du lot n'a bougé
  sur main (`git log --oneline HEAD..origin/main -- <fichiers>`).
- Prod : aucune écriture, aucun DDL, aucune transaction longue via MCP. Les
  lectures ponctuelles (une requête, moins de 5 s) restent possibles pour
  vérifier une contrainte ou un statut.
- Code : modifications chirurgicales, pas de refactor hors périmètre, pas de
  `as any`, pas de nouveau statut sans vérifier la contrainte CHECK en base.
- Arrêt : si un correctif exige de toucher plus de trois fichiers hors de la
  liste ci-dessous, ou de créer une migration, s'arrêter et demander.
- Durée cible : deux à trois heures de session. Un commit par étape.

## Objectif

Remettre le moteur de séquences dans un état où un message n'est jamais envoyé
deux fois ni après une réponse, où les étapes d'attente progressent, et où les
recruteurs peuvent créer, dupliquer et piloter leurs séquences depuis l'UI.

Critères de succès vérifiables :

1. Créer et dupliquer une séquence depuis l'UI aboutit (insert avec
   `organization_id`), la séquence apparaît dans la liste.
2. Une étape sautée n'est jamais renvoyée ; le janitor ne rejoue jamais une
   étape ayant déjà une exécution `sent`, `failed` ou `skipped`.
3. Une étape `wait_connection` est franchie par le moteur dès que la connexion
   est acceptée, et l'étape suivante est planifiée sans attendre le timeout.
4. `wait_reply`, `wait_profile_visit` et `condition_branch` ne tombent plus en
   `failed` ; une réponse détectée par polling clôt l'enrollment en `replied`.
5. En rotation multi-sender, conditions et détection de réponse utilisent le
   compte qui a réellement envoyé.
6. Les boutons manuels de l'UI fonctionnent pour un membre d'organisation et
   n'agissent que sur les données de son organisation.
7. Les écritures qui font foi pour la machine à états lisent `error`.

## Lecture préalable (ciblée, jamais le fichier entier)

- `CLAUDE.md` : discipline (5 principes), conventions edge functions,
  « Common Pitfalls ».
- `docs/audit-2026-09-01.md` : constats BUG-022, BUG-024, BUG-025, BUG-023,
  BUG-007, MQ-002, SEC-013, SEC-041, BUG-095, BUG-096, BUG-099.
  `grep -n "^\*\*BUG-022\|^\*\*BUG-024\|^\*\*BUG-025\|^\*\*BUG-023\|^\*\*BUG-007\|^\*\*MQ-002\|^\*\*SEC-013\|^| BUG-095\|^| BUG-096\|^| BUG-099\|^| SEC-041" docs/audit-2026-09-01.md`
- `supabase/functions/process-sequences/index.ts` (plus de 3400 lignes, lire
  par zones avec `sed -n` ou `Read offset/limit`) :
  - 118 à 182 : auth (service_role, PROCESS_SEQUENCES_SECRET, JWT admin via
    `has_role`) et dispatch des actions
  - 252 : `INVISIBLE_ACTIONS`
  - 340 à 380 : janitor « dormant »
  - 440 à 1080 : boucle `handleProcess` (conditions 560 à 720, claim et envoi
    900 à 1080, auto-pause 1060 à 1076)
  - 1100 à 1150 : `handleCheckReplies`
  - 1240 à 1330 : `handleCheckWaitEvents` (phases 1 et 2)
  - 2060 à 2070 : `handleForceReschedule`
  - 2380 à 2400 : `scheduleNextStep` et son garde anti-doublon
  - 2420 à 2480 et 2750 à 2760 : `executeStepAction` (`wait_connection`,
    `default`)
- `supabase/functions/unipile-webhook/index.ts` 718 à 772 (`new_relation`)
  et 950 à 970 (annulation des pendants).
- `supabase/functions/check-invitation-status/index.ts` 243 à 254.
- Front : `src/components/outreach/SequencesList.tsx` 110 à 130, 280 à 295,
  415 à 430 ; `src/components/outreach/SequenceEnrollmentsPanel.tsx` 320 à
  340, 399 à 417, 431 à 450, 505 à 540 ; `src/hooks/useCandidateEnrollments.ts`
  173 à 274 ; `src/components/outreach/SequenceDiagnostic.tsx` 228 à 231.
- Statuts autorisés sur `sequence_step_executions` et `sequence_enrollments` :
  chercher la contrainte CHECK dans `supabase/migrations/` avant tout ajout.

Les numéros de ligne renvoient à la révision 0f68ba7 ; aucun de ces fichiers
n'a changé depuis.

## Constats et correctifs attendus

### SEC-013 (haute, S) : création et duplication de séquence refusées par RLS

`SequencesList.tsx:285` et `:421`. Les deux `insert` dans `outreach_sequences`
ne renseignent pas `organization_id` ; la policy INSERT exige
`organization_id = get_user_org_id(auth.uid())`. Aucune séquence créée depuis
le 4 mai.

Correctif : `const { organizationId } = useOrganization();`, refuser
`handleSaveSequence` et `handleDuplicate` si `organizationId` est absent,
ajouter `organization_id: organizationId` aux deux inserts. Vérifier BUG-045 au
passage : ne pas afficher « Séquence enregistrée » quand la sauvegarde a
échoué (le `catch` de `handleSaveSequence` avale l'erreur).

### BUG-022 (haute, M) : le janitor rejoue des étapes déjà exécutées

`process-sequences/index.ts:362-369`. Un enrollment `active` sans exécution
pendante est considéré dormant et `scheduleNextStep(enr, current_step_order - 1)`
recrée l'étape courante. Or `current_step_order` n'est incrémenté qu'après le
marquage `sent` (943 puis 947) et jamais sur `failed`. Résultat : renvoi une
heure plus tard d'un message déjà parti, ou rejeu horaire d'une étape en échec.

Correctif : ne re-planifier que depuis la dernière exécution terminale
réussie (max `step_order` parmi `sent`, `opened`, `clicked`, `replied`,
`skipped`) ; si la dernière exécution est `failed`, passer l'enrollment en
`paused` avec `skip_reason` au lieu de rejouer. Écrire `current_step_order`
dans la même update que le `sent` (943). À 958-965, traiter
`freshExec.status === 'sent'` comme un succès (incrément puis
`scheduleNextStep`) au lieu de `continue`. Étendre le garde de
`scheduleNextStep` (2391) : refuser si une exécution `sent`, `opened`,
`clicked`, `replied` ou `skipped` existe déjà pour (enrollment, step) hors
cible de branche.

### BUG-007 (haute, M) : « Sauter cette étape » ne fait pas avancer

`SequenceEnrollmentsPanel.tsx:431`. Le front passe l'exécution en `skipped`
puis appelle `process-sequences {action:'process', force:true}` en ignorant
l'erreur (401 pour un client). Le moteur ne planifie la suite qu'après avoir
exécuté quelque chose ; le janitor recrée ensuite l'étape sautée.

Correctif : action serveur `skip_execution { execution_id }` dans
process-sequences : vérifier que l'appelant est membre de l'organisation de
l'enrollment (`requireAuth` puis `verifyOrgMembership`, cf.
`_shared/require-auth.ts`), marquer l'exécution `skipped`, poser
`current_step_order = step.step_order + 1`, appeler
`scheduleNextStep(supabase, enrollment, step.step_order, undefined, undefined, 0, step.id)`.
Côté front : appeler cette action et remonter l'erreur, supprimer le
`.catch(() => {})`.

### BUG-024 (haute, M) : `wait_connection` jamais franchie par le moteur

`process-sequences/index.ts:2473`. `executeStepAction('wait_connection')`
renvoie toujours `__WAIT_EVENT__`, même quand `checkStepCondition` vient de
confirmer la connexion (632). Boucle `waiting_event` / `scheduled` toutes les
15 minutes, `invites_accepted` incrémenté à chaque tour, message suivant envoyé
seulement par la branche timeout.

Correctif : dans `handleProcess`, avant le claim, si l'étape est un
`wait_connection` (ou `wait_for_event === 'connection_accepted'` /
`condition_type === 'wait_until_connected'`) et que la condition est vraie :
exécution `sent` avec `executed_at`, enrollment `connection_status =
'connected'` et `current_step_order = step.step_order + 1`, puis
`scheduleNextStep(..., step.step_order, undefined, undefined, 0, step.id)`.
Garder `__WAIT_EVENT__` uniquement pour `wait`. Dans `unipile-webhook`
(`new_relation`) et `check-invitation-status`, se limiter à poser
`connection_status = 'connected'` et repasser l'exécution en `scheduled` : une
seule logique de progression, celle du moteur. Ne plus incrémenter
`invites_accepted` en phase 1 de `handleCheckWaitEvents`.

### BUG-025 (haute, M) : `wait_reply`, `wait_profile_visit`, `condition_branch` tombent en `failed`

`process-sequences/index.ts:2758`. Ces types persistés par le builder
arrivent dans le `default` de `executeStepAction` (« Unknown action »), non
retryable, donc `failed`, et comptent parmi les échecs qui auto-pausent la
séquence. La phase 2 du polling remet le step en `scheduled` sans clore
l'enrollment.

Correctif : ajouter `wait_reply`, `wait_profile_visit`, `condition_branch` à
`INVISIBLE_ACTIONS`. Dans `handleProcess`, avant le claim, si l'étape est un
`wait_*` (ou `wait_for_event` non nul) et que la condition est vraie : pour
`reply_received`, enrollment `replied` avec `replied_at`, annulation des
exécutions pendantes (`scheduled`, `waiting_event`, `quota_blocked`,
`sending`, cf. BUG-099), `logAnalytics('replies_received')`, exécution
`sent` ; sinon exécution `sent`, incrément, `scheduleNextStep`. Dans la phase
2 de `handleCheckWaitEvents`, `reply_received` satisfait clôt en `replied` au
lieu de re-planifier. `profile_visited` n'est pas supporté par
`checkStepCondition` : soit l'implémenter, soit le traiter comme `skipped`.
Le `default` devient un `skipped` loggé suivi de `scheduleNextStep`, plus un
`failed`.

### BUG-023 (haute, M) : rotation multi-sender évaluée sur le mauvais compte

`process-sequences/index.ts:632`. L'envoi part de
`step.sender_id || assigned_sender_id || account_id` (565, 2425) mais
`checkStepCondition` (632), le pre-send reply check (708), `handleCheckReplies`
(1138), `handleCheckWaitEvents` (1307, 1318) et `generatePersonalizedMessage`
(3106) interrogent LinkedIn avec `enrollment.account_id`.

Correctif : un `effectiveAccountId` unique par enrollment, persisté dans
`assigned_sender_id` dès l'enrôlement, utilisé partout où l'état LinkedIn est
lu. Dans `unipile-webhook`, matcher les enrollments sur
`account_id` ou `assigned_sender_id`. Si la sémantique de
`sequence_steps.sender_id` (utilisateur ou compte) n'est pas claire après
lecture, s'arrêter et la poser en question plutôt que deviner.

### MQ-002 et SEC-041 (haute et moyenne, M) : actions manuelles réservées à l'admin plateforme, et non scopées

`process-sequences/index.ts:118-182`, `SequenceEnrollmentsPanel.tsx:445, 511`,
`SequencesList.tsx:117, 125`, `SequenceDiagnostic.tsx:228`. Le JWT d'un client
n'est accepté que s'il porte le rôle plateforme `admin` (`has_role`), vide en
prod : « Traiter maintenant », « Forcer un cycle », « Envoyer tout »,
« Sauter » renvoient 401. À l'inverse, `force` et `force_reschedule` agissent
sur tous les tenants (aucun filtre `organization_id`, fuseau `Europe/Paris`
codé en dur).

Correctif : conserver `service_role` et `PROCESS_SEQUENCES_SECRET` pour le
cron. Pour un JWT utilisateur, remplacer le test `has_role` par
`requireOrgAccess` et n'autoriser que des actions scopées : `skip_execution`
(ci-dessus), `process_enrollment { enrollment_id }` ou `process_organization`
qui ne traite que les exécutions de l'organisation vérifiée,
`check_replies` et `check_wait_events` limités à cette organisation. Les
actions globales `process` (avec `force`) et `force_reschedule` restent
réservées au cron et au service_role. Adapter les quatre appels du front.

### BUG-096, BUG-095, BUG-099 (moyennes, S à M) : transitions sans lecture d'erreur, message livré marqué `cancelled`, pendants orphelins

`process-sequences/index.ts:943, 929, 1140`. À traiter si le temps le permet,
dans l'ordre : helper `mustUpdate` (vérifie `error` et le nombre de lignes
avec `.select('id')`, log contextualisé) sur les transitions `sent`,
`current_step_order`, `replied`, `completed`, pause compte déconnecté ;
après un envoi réussi, ne jamais marquer l'exécution `cancelled` (929-939) :
marquer `sent` et laisser le statut de l'enrollment décider de la suite ; à
chaque clôture d'enrollment, annuler aussi `waiting_event`, `quota_blocked` et
`sending`, pas seulement `scheduled`.

## Ordre de travail et commits

1. SEC-013 et BUG-045 (front). Commit.
2. BUG-022 et BUG-007 : janitor et action `skip_execution`. Commit.
3. BUG-024 et BUG-025 : progression des étapes d'attente, webhook et
   check-invitation-status alignés. Commit.
4. BUG-023 : `effectiveAccountId`. Commit.
5. MQ-002 et SEC-041 : auth des actions manuelles, appels front. Commit.
6. BUG-096, BUG-095, BUG-099 si le temps le permet. Commit.

Les hooks pre-commit lancent tsc (ratchet, baseline 32, aujourd'hui 31) et le
build Vite à chaque commit : compter environ trois minutes par commit.

## Vérifications à chaque commit

Deno n'est pas installé dans le conteneur et esm.sh est bloqué par le proxy.
Utiliser `npx -y deno@2` avec un import map qui redirige supabase-js vers npm :

```
cat > /tmp/importmap.json <<'JSON'
{ "imports": {
  "https://esm.sh/@supabase/supabase-js@2.75.1": "npm:@supabase/supabase-js@2.75.1",
  "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check": "npm:@supabase/supabase-js@2.75.1",
  "https://esm.sh/@supabase/supabase-js@2": "npm:@supabase/supabase-js@2.75.1"
} }
JSON
npx -y deno@2 check --import-map=/tmp/importmap.json --node-modules-dir=none \
  supabase/functions/process-sequences/index.ts \
  supabase/functions/unipile-webhook/index.ts \
  supabase/functions/check-invitation-status/index.ts
```

Comparer le nombre d'erreurs par fichier avec la base (les erreurs
préexistantes sont nombreuses ; aucune nouvelle n'est admise) :
`git worktree add /tmp/base HEAD` puis la même commande dans `/tmp/base`.

ESLint, même principe, sur les fichiers modifiés uniquement :
`npx eslint <fichiers>` sur la branche et sur `/tmp/base`, les totaux doivent
être égaux ou inférieurs.

Puis : `npm run test:agent` (35 tests, tous verts aujourd'hui), et `grep` des
noms de fonctions ou d'actions supprimés pour éviter tout appel orphelin.

QA : suivre `.claude/skills/qa.md` (personas) sur le flux « créer une séquence,
enrôler deux profils, sauter une étape, mettre en pause, reprendre ». Un test
e2e `e2e/flows/sequences.spec.ts` est attendu par le rapport (MQ-010) ; le
créer seulement si le temps le permet, après les correctifs.

## Points de vigilance

- Le cron appelle le moteur toutes les minutes avec `PROCESS_SEQUENCES_SECRET`
  : ce chemin ne doit jamais casser.
- Limite de 60 s par invocation : ne pas alourdir la boucle d'envoi (BUG-093).
- Les statuts d'exécution et d'enrollment sont contraints par CHECK : vérifier
  avant d'en introduire un.
- `process-sequences` n'est déployé qu'au merge sur `main` (workflow
  deploy-edge-functions). Aucun `supabase functions deploy` manuel.
- État de la prod au 2026-09-03 : 17 enrollments, aucune séquence créée
  depuis le 4 mai, `user_roles` vide (donc aucun client ne peut aujourd'hui
  déclencher les actions manuelles).
- Interdiction de toute écriture en prod, y compris « à blanc » dans une
  transaction : le 3 septembre, des rejeux de migration en transaction annulée
  ont gardé des verrous pendant 40 minutes et ralenti l'application.

## Fin de session attendue

Un message court : correctifs livrés par constat, vérifications passées et
non passées, commits poussés, ce qui reste (BUG-096/095/099 s'ils n'ont pas
été traités), et les points à tester à la main avant merge.
