# Génération des tests Playwright « séquences » : brief de session

Suite du lot « moteur de séquences » (`docs/audit-2026-09-01-lot-sequences.md`,
commits `e2695bc` → `6f8994c`) et des tests posés en `c82df51`.

Objectif : remplacer les quatre `test.fixme` de `e2e/flows/sequences.spec.ts`
par des tests exécutables, avec des locators vérifiés dans un vrai navigateur.

## Cadre

- Modèle : Sonnet 5 (`/model` avant de lancer). Le travail est mécanique :
  explorer le DOM, écrire des locators, faire tourner la suite.
- Agents : ceux du projet, `playwright-planner` puis `playwright-generator`,
  et `playwright-healer` seulement si un test devient rouge sans changement
  de code. Ce sont les seuls agents autorisés pour cette session.
- Prod interdite : `E2E_BASE_URL` pointe sur le dev local ou une preview,
  `E2E_SUPABASE_URL` sur un Supabase de test. `e2e/global.setup.ts` refuse de
  tourner contre `crckfywoyjxkawathdff` ; ne pas contourner ce garde-fou.
- Durée cible : 30 à 45 minutes. Un commit à la fin, ou un par test si les
  locators demandent des allers-retours.

## Prérequis à vérifier AVANT de lancer les agents

1. **Serveur MCP Playwright connecté.** Les deux agents du projet naviguent par
   lui ; sans lui ils devineraient les locators, ce que leurs consignes
   interdisent. S'il n'est pas disponible dans la session, s'arrêter et le dire
   plutôt que d'écrire des sélecteurs au jugé. Repli acceptable si le MCP
   manque : `npx playwright codegen $E2E_BASE_URL` en local pour relever les
   locators, puis écriture manuelle.
2. **Supabase de test** joignable, et les variables posées :
   `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`,
   `E2E_SUPABASE_SERVICE_ROLE_KEY`, éventuellement
   `E2E_SUPABASE_PROJECT_REF` et `E2E_BASE_URL`.
3. **Navigateur installé** : `npm run test:e2e:install`.
4. **Migrations de l'audit appliquées** sur ce Supabase de test, en particulier
   `20260903074500_rls_catchup_audit_critiques.sql` : sans elle, les policies
   ne correspondent pas au code et les tests RLS mentent.
5. **Edge functions déployées** sur le projet de test si l'on veut aussi faire
   tourner `e2e/api/sequences-engine.spec.ts` (`E2E_EDGE_FUNCTIONS=1`). Les
   tests UI n'en ont pas besoin : la fixture `mockVendors` intercepte
   `functions/v1/*`.

Commande de contrôle avant toute génération :

```
npx playwright test --project=api e2e/api/sequences-rls.spec.ts
```

Ces quatre tests doivent passer. S'ils échouent, le problème est
l'environnement (ou la migration RLS), pas les tests à écrire.

## Ce qui existe déjà, à ne pas refaire

| Fichier | Couvre | Navigateur |
|---|---|---|
| `e2e/api/sequences-rls.spec.ts` | policy INSERT d'`outreach_sequences` (SEC-013), isolation entre organisations | non |
| `e2e/api/sequences-engine.spec.ts` | contrat serveur de `skip_execution` et `nudge_sequences`, actions réservées au cron (BUG-007, MQ-002, SEC-041) | non |
| `e2e/flows/sequences.spec.ts` (smoke) | onglet outreach : auth, routing, RLS, rendu, pas de crash JS | oui |

Les tests à écrire valident le **câblage de l'interface** : que le bouton
appelle la bonne action et affiche le bon retour. Le contrat serveur est déjà
tenu ailleurs ; ne pas le retester dans le navigateur.

Helpers disponibles (`e2e/helpers/supabase-admin.ts`) : `seedMission`,
`seedSequence`, `seedEnrollment`, `seedExecution`, `seedLinkedInAccount`,
`addMember`, `createOrg`, `deleteOrg`, `signIn`. Les séquences seedées portent
un nom de la forme `Séquence e2e <suffixe>`.

## Les quatre tests à produire

### 1. Créer une séquence depuis le builder (SEC-013, BUG-045)

Persona Guillaume, rôle `agencyOwner`.

Parcours : onglet outreach d'une mission seedée, bouton de création, le wizard
s'ouvre, renseigner un nom et une étape message, enregistrer.

Assertions : un toast de succès, la séquence apparaît dans la liste, et en base
la ligne porte `organization_id` égal à l'organisation de l'utilisateur. Vérifier
aussi le cas d'échec : le builder ne doit ni afficher « Séquence enregistrée »
ni se fermer quand la sauvegarde échoue (simuler en interceptant l'appel
PostgREST d'insert avec un 403).

### 2. Dupliquer une séquence

Menu contextuel de la séquence seedée, action de duplication.

Assertions : une ligne « (copie) » apparaît, inactive ; en base, la copie porte
`organization_id`, ses étapes sont recopiées, et les références de branchement
(`next_step_id`, `if_true_goto_step`, `if_false_goto_step`,
`timeout_branch_step_id`) pointent vers les nouveaux identifiants, pas vers ceux
de la séquence source.

### 3. Sauter une étape (BUG-007)

Préconditions : séquence à trois étapes, un enrollment actif, une exécution
`scheduled` sur l'étape 0 (`seedExecution`).

Parcours : ouvrir le panneau d'enrollments, sauter l'étape, confirmer dans
l'AlertDialog.

Assertions : toast de succès ; en base, exécution `skipped` avec
`skip_reason`, `current_step_order` incrémenté, et une exécution créée pour
l'étape suivante. Vérifier surtout la régression : relancer le janitor
(`process` en clé de service, via `admin()` ou un appel direct à la fonction)
et s'assurer qu'**aucune** nouvelle exécution n'est créée pour l'étape sautée.

### 4. « Envoyer tout » pour un utilisateur sans rôle plateforme (MQ-002)

Correction par rapport au commentaire laissé dans le fichier : inutile de créer
un collaborateur. Le contrôle qui renvoyait 401 portait sur le rôle
**plateforme** (`has_role admin`, table `user_roles` vide), pas sur le rôle
d'organisation. `agencyOwner` reproduit donc exactement le cas cassé et évite
de construire un storageState à la main. Ajouter un collaborateur via
`addMember` reste possible en complément, mais demande de fabriquer sa session
(`signIn` puis écriture de la clé `authStorageKey()` dans le localStorage).

Préconditions : deux organisations, chacune avec une exécution planifiée dans
le futur (la seconde sert de témoin cross-tenant).

Assertions : toast « N action(s) avancée(s) » et non une erreur ; en base, les
exécutions futures de mon organisation sont ramenées à maintenant, celles de
l'autre organisation sont inchangées.

## Déroulé attendu

1. `playwright-planner` explore l'onglet outreach et le panneau d'enrollments,
   et écrit `e2e/specs/sequences.md` (format imposé par sa consigne : objectif,
   persona, préconditions, scénarios, assertions, vendors mockés).
2. Lire ce plan et le corriger si un scénario s'éloigne des quatre ci-dessus.
3. `playwright-generator` remplace les quatre `test.fixme` par des tests réels,
   en gardant le smoke existant.
4. Faire tourner deux fois de suite :
   `npx playwright test e2e/flows/sequences.spec.ts --repeat-each=2`.
   Tout test qui n'est pas vert deux fois est instable : le corriger, ne pas le
   retenter en boucle.
5. Contrôles de non-régression : `npx eslint e2e/` au même niveau qu'avant
   (5 problèmes préexistants), `npx playwright test --list` sans erreur.

## Garde-fous

- Locators par rôle ou par texte accessible. Aucun sélecteur CSS de structure.
- Zéro `waitForTimeout` : assertions web-first à auto-attente.
- Ne pas inventer de `data-testid`. Si un élément n'est pas adressable
  proprement, le signaler comme recommandation sur `src/` plutôt que forcer un
  sélecteur fragile.
- Un test rouge qui révèle un vrai défaut applicatif se remonte comme tel : le
  healer n'a pas le droit de le neutraliser.
- Nettoyage systématique en `afterEach` (les helpers `deleteOrg` et les
  suppressions par id sont déjà en place dans les specs existantes).

## Fin de session attendue

Les quatre tests écrits et verts deux fois, le smoke toujours vert, un commit
sur `claude/repository-audit-pcgg0y`, et un message court : ce qui a été
couvert, ce qui a résisté (locator manquant, élément non adressable) et les
recommandations d'accessibilité éventuelles à porter côté `src/`.
