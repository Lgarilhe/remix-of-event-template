---
description: "Tester un flow avec les 4 personas Konekt avant merge. Utiliser après un changement sur MissionWorkspace, LinkedInSearch, séquences, ou edge function critique. Obligatoire avant tout deploy en prod."
---

# /qa — Test 4 personas sur Remix Event Template (Konekt)

Laurent n'est pas développeur. Tu testes pour lui. Tu ne rends pas la main tant que les 4 personas passent.

Ce skill s'appuie sur le `CLAUDE.md` à la racine (Code Map, flows) et complète `edge-function.md` et `migration.md` qui couvrent l'écriture — celui-ci couvre la validation.

## Protocole

1. Identifier précisément le flow touché (mission, sourcing, outreach, pipeline, etc.) à partir du diff.
2. Pour chaque persona : scénario → exécution → verdict PASS/FAIL.
3. Rapport final : tableau 4 lignes, liste des bugs ouverts.
4. Si un persona FAIL : correction ou ticket. Jamais ignorer.
5. Écrire une ligne dans `LOGBOOK.md` avec le résultat.

## Préflight obligatoire (commun à tous les personas)

Avant toute exécution de scénario :

```bash
npx tsc --noEmit          # zero error
npx vite build            # must succeed
```

Ces deux vérifs sont déjà dans les hooks `.claude/settings.json` mais relance-les manuellement pour isoler la QA du commit.

## Les 4 personas

### 1. Guillaume — Power-user recruteur (Konekt interne)

**Profil** : recruteur senior Konekt, 8h/jour dans l'app, maîtrise tous les flows, raccourcis clavier.
**Droits** : accès agence (`hasFeature('prospection')` = true), peut voir `/prospection`.

**Scénarios selon le diff** :
- *Si MissionSourcing / LinkedInSearch touché* : ouvrir une mission existante → onglet sourcing → lancer recherche LinkedIn → filtrer → scorer 30 profils → passer à l'onglet outreach (vérifier que `missionSearchCache` restaure bien l'état au retour), chrono < 5 min.
- *Si MissionBrief / BriefWizard touché* : créer une mission → wizard 5 étapes → auto-save 800ms fonctionne → le job_details est bien écrit sur sourcing_projects.
- *Si MissionProcess touché* : ajouter 3 étapes d'entretien, les réordonner (vérifier le fix UNIQUE constraint avec valeurs négatives temporaires), inviter un membre d'équipe.
- *Si outreach / sequences touché* : créer une séquence, enrôler 10 candidats, vérifier `sequence_enrollments` + que `sequence_enrollments` respecte les safety limits (30 msg/jour/canal, 24h entre steps).
- *Si Apollo / database-search touché* : test de la mission en mode `searchSource='database'`, vérifier la pagination Apollo (`total_entries` au top level, pas dans `pagination`), et le bulk_match pour enrichissement.
- *Si Unipile / unipile-search touché* : test avec un compte LinkedIn Recruiter connecté, filtres avancés (role keywords + skills + seniority), vérifier auto-retry 3x sur `multiple_sessions`.

**FAIL si** :
- Latence > 500ms sur une action courante
- `missionSearchCache` perd du state au tab switch (regressions connues)
- Filtre AI pas transformé correctement vers `LinkedInFiltersState` (voir useLinkedInSearch l.266-306)
- Bulk action cassée
- Recharger la page nécessaire

### 2. Claire — DRH occasionnelle (client final)

**Profil** : DRH PME, se connecte 2-3x/semaine, n'a pas envie d'apprendre.
**Droits** : accès client final, pas d'agence, pas de `/prospection`.

**Scénarios** :
- *Si MissionBentoDashboard touché* : ouvrir une mission → comprendre l'état en < 10 secondes.
- *Si MissionPipeline touché* : lire un pipeline kanban, noter un candidat, planifier un entretien via MissionCopilot (fixed bottom bar).
- *Si qualification / screening touché* : recevoir un lien qualification → `/qualification/:id` → suivre le flow chatbot scorecard sans aide.
- *Si AcceptMissionInvite / invitations touché* : cliquer un lien d'invitation freelance → `/mission-invite/:token` → comprendre ce qu'on lui demande.
- *Si AlertDialog ajouté/modifié* : chaque action destructive doit utiliser shadcn AlertDialog avec texte français (règle CLAUDE.md), jamais `window.confirm`.

**FAIL si** :
- Hésitation > 3 secondes sur une action
- Terme technique visible à l'écran : "RLS", "webhook", "edge function", "JSON", "cursor", "pagination", "snapshot", "filter format", etc.
- Scroll nécessaire pour atteindre l'action primaire
- `window.confirm` vu au lieu d'AlertDialog

### 3. Théo — Edge-case technique

**Profil** : teste volontairement les limites.
**Droits** : variable selon le scénario, souvent multi-tenant crossing.

**Scénarios** :
- **Sécurité multi-tenant** : depuis une session user A / org A, tenter d'accéder à une mission d'org B via URL directe (`/missions/:id` avec id d'un autre org). Doit être bloqué. Vérifier que les edge functions utilisent bien `requireAuth` + `verifyOrgMembership` (règle CLAUDE.md).
- **Credential bleed** : si un edge function utilise des `let` globaux pour des credentials Unipile/Apollo → interdit (voir CLAUDE.md "NEVER use mutable globals"). Audit avec grep `let.*_API_KEY` dans `supabase/functions/`.
- **Inputs malveillants** : dans BriefWizard et LinkedInSearch, tester : champs vides, `> 500 chars` sur `q_keywords` Apollo (doit être cappé), `> 200 chars` sur keywords Unipile (CONTENT_TOO_LARGE), emojis, caractères RTL, SQL-like injection dans filtres.
- **Race conditions** :
  - Double-clic submit sur MissionBrief
  - Tab switch pendant une recherche LinkedInSearch en cours (cache restore vs hook state)
  - Deux users éditent la même mission simultanément
  - Offline au milieu d'un envoi de séquence
- **Rate limits** : simuler 429 sur unipile-search, vérifier retry après 60s + toast français.
- **DSN format** : vérifier `resolveUnipileCredentials` renvoie bien le DSN avec `https://`, et que les URLs ne font pas `https://https://` (bug classique mentionné CLAUDE.md).
- **Apollo pagination** : vérifier que `total_entries` est lu au top level, pas dans `pagination`.
- **AI model IDs** : grep toutes les edge functions pour IDs hardcodés. Seuls `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5-20251001` sont valides. Jamais `claude-sonnet-4-20250514`.
- **Credits settlement** : toute edge function appelant Anthropic doit appeler `settleCredits` après.

**FAIL si** :
- Erreur 500 silencieuse dans logs Supabase
- Fuite de données cross-org (CRITIQUE → incident sécurité immédiat)
- État incohérent après race condition
- Rollback impossible
- Any règle CLAUDE.md "Edge Function Conventions" violée
- IDs de modèles AI obsolètes

### 4. Sophie — Freelance mobile-first

**Profil** : freelance, 80% mobile (train, client, terrasse), iPhone 13, 4G moyenne.
**Droits** : accès freelance, voit uniquement missions auxquelles elle est invitée.

**Scénarios** :
- *Si AcceptMissionInvite / /mission-invite/:token touché* : ouvrir le lien sur mobile, accepter, arriver sur MissionWorkspace.
- *Si MissionPipeline touché* : swiper le kanban sur mobile, déplacer des candidats entre colonnes.
- *Si MissionCopilot touché* : le bottom bar fixe ne masque pas le contenu sous iPhone, et reste lisible.
- *Si inbox / MessagesInbox touché* : répondre à un message depuis mobile.
- *Si qualification touché* : compléter une session qualification sur mobile, prise de note vocale (Deepgram si intégré).
- *Général* : toute nouvelle UI testée sur Chrome DevTools iPhone 13 portrait, puis si possible sur un vrai iPhone.

**FAIL si** :
- Un élément déborde horizontalement
- Un clic cible < 44x44px
- Le clavier tactile masque l'input actif sans scroll
- Chargement > 3s en 4G simulée (throttle DevTools "Slow 4G")
- Voix ne fonctionne pas ou permissions mal gérées
- AlertDialog illisible ou mal positionnée sur mobile

## Format du rapport

```markdown
## QA — <NomFeature> — <YYYY-MM-DD>

**Préflight** : tsc ✅ / vite build ✅
**Scope** : <modules/fichiers touchés>

| Persona   | Scénario                         | Verdict | Bugs                              |
|-----------|----------------------------------|---------|-----------------------------------|
| Guillaume | LinkedInSearch bulk 30 scored    | PASS    | —                                 |
| Claire    | /qualification flow chatbot      | FAIL    | Terme "enrollment" visible        |
| Théo      | Multi-org URL forge /missions/:id | PASS    | —                                 |
| Sophie    | Swipe kanban mobile iPhone 13    | FAIL    | Colonne déborde de 18px en portrait |

**Go/No-go merge** : NO-GO — 2 FAIL à corriger
```

Entry correspondante dans `LOGBOOK.md`.

## Règles absolues — ne jamais skipper

- Touche à `requireAuth`, `verifyOrgMembership`, ou RLS → **Théo obligatoire**, aucune exception
- Touche à edge function avec credentials (Unipile, Apollo, Anthropic) → **Théo credential bleed check**
- Touche à un flow vu par client final (MissionWorkspace hors onglets internes, qualification, accept-invite) → **Claire obligatoire**
- Ajoute un champ, un bouton, ou une action visible → **les 4 obligatoires**
- Touche à `missionSearchCache` ou hook `useLinkedInSearch` → **Guillaume avec scénario tab-switch**

## Outils

- **Playwright** (si setup dans le repo — vérifier `playwright.config.ts`) : scénarios reproductibles → Guillaume et Théo scriptables
- **Chrome DevTools device toolbar** → Sophie (iPhone 13 Pro, Slow 4G)
- **Supabase Dashboard logs** → après chaque scénario avec edge function, vérifier pas de 500 silencieux
- **grep / ripgrep** sur `supabase/functions/**/*.ts` → Théo pour audits de convention
