# Lot 5 « Contacter » : plan d'exécution, version 2

Écrit le 05/10/2026. Remplace le plan v1 du même jour.

Sources :
- les quatre relevés de l'espace de travail (carte du code des séquences, insertion dans la nouvelle page mission, spécification cible, rédaction par l'IA) ;
- la relecture adverse du plan v1 (3 points bloquants, 8 importants, 10 mineurs), traitée point par point en annexe A ;
- les décisions du fondateur des 04 et 05/10 (section 1.2) ;
- le dépôt au commit 5f691abb, branche `claude/lot5-contacter`. Les numéros de ligne cités datent de ce commit.

Ce que la v2 change par rapport à la v1 :
- un arrêt manuel clôt l'inscription en `completed` (et non `stopped`), pour rester compté par l'anti-doublon de 90 jours ;
- un sous-lot 5a-2 pose tôt la garde du moteur : aucun message rédigé par l'IA ne part sans relecture ;
- 5c, 5d et 5f sont découpés ; 5j ne retire plus rien qui serve encore ;
- l'écran Séquences a son entrée dans la barre latérale ;
- la case des destinataires vaut aussi pour l'InMail groupé ;
- la rédaction par l'assistant est ouverte en formule gratuite, dans la limite des crédits ;
- chaque PR d'extraction ou de retrait recopie un grep des tests touchés ; toute fonction nouvelle a son entrée dans `config.toml`.

---

## 1. Résumé

### 1.1 Le lot

Le lot 5 garde son objet de départ (conception.md, section 13) : contacter une sélection depuis la mission. Il y ajoute les deux chantiers demandés par le fondateur.

1. La refonte des séquences de la maquette :
   - une page par séquence (étapes, candidats, journal, réglages) ;
   - un seul éditeur ;
   - un suivi lisible ;
   - un écran Séquences pour l'organisation, avec une entrée dans la barre latérale.
2. L'aspect agent : l'assistant rédige la séquence de la mission à partir du poste, quand on le lui demande. Une personne relit et enregistre. Rien ne part avant qu'elle clique « Inscrire N candidats ». Aucun message rédigé par l'IA ne part sans avoir été relu.

Restent dans le lot, comme prévu par la conception :
- le panneau Prise de contact définitif ;
- « Contacter » depuis toute sélection, avec la séquence de la mission choisie d'avance ;
- le chemin gratuit, un candidat à la fois (décision 2 du 27/09) ;
- les invitations reçues, déplacées dans la messagerie ;
- le rang 9 de la carte Maintenant ;
- le retrait de l'accès provisoire du lot 1.

Le lot est découpé en 16 PR, chacune mergeable seule, plus quatre petits correctifs indépendants.

### 1.2 Décisions du fondateur et leur traduction

1. Périmètre : lot 5 avec la refonte des séquences de la maquette et l'assistant qui rédige depuis le poste ; validation par une personne avant tout envoi.
   - `enroll_in_sequence` et `resume_sequence` ne sont plus jamais automatiques, côté serveur et à l'écran (5a). `create_sequence` non plus (5e).
   - La rédaction depuis le poste rend un brouillon non enregistré (5e). La fonction serveur n'écrit que le débit de crédits.
2. Éditeur : un seul parcours. Liste d'étapes verticale et aperçu réel, construits en 5d-2 derrière un drapeau, ouverts à tous en 5h. Guidé, Expert et Visuel sont retirés en 5j.
3. Arrêt et Pause immédiats, avec « Annuler » pendant 8 secondes, sans fenêtre (5b).
   - Annuler une pause passe par `resume_enrollments` : la base interdit au navigateur de remettre une inscription en `active` (`ENROLLMENT_RESUME_SERVER_ONLY`).
   - Arrêter et son annulation sont deux actions serveur nouvelles de `process-sequences`.
   - CLAUDE.md reçoit une exception écrite à la règle AlertDialog pour ces seuls gestes.
4. Case « Je confirme les destinataires » obligatoire dès 5 candidats, avec l'aperçu du premier message.
   - Le seuil se compte sur le nombre affiché sur le bouton : les candidats réellement inscrits, après retraits, exclusions et dérogations.
   - Elle arrive en 5a sur les fenêtres actuelles, puis en 5f-2 sur le nouveau « Contacter ».
5. Messages rédigés par l'IA pour chaque candidat : génération et relecture obligatoires avant l'inscription, et garde du moteur.
   - Sous-lot 5a-2, juste après 5a, avec sa recette moteur.
   - Le moteur reporte, avec une raison lisible et sans l'annuler, toute étape `use_ai_personalization` sans texte relu ; l'étape repart après relecture.
   - L'éditeur ne propose « L'IA rédige pour chaque candidat » qu'avec cette relecture par inscrit (5d-2).
6. Rédaction par l'assistant ouverte en formule gratuite, dans la limite des crédits. La séquence est enregistrée désactivée. L'envoi reste réservé aux offres payantes (5e, 5g).
7. La case des destinataires (dès 5) vaut aussi pour l'InMail groupé (`BulkInMailModal`), avec l'aperçu du premier InMail (5a).
8. L'écran « Séquences » de l'organisation a une entrée « Séquences » dans la rangée basse de la barre latérale, à côté de Tâches et Agenda, en plus du panneau de mission et de Ctrl J (5c-2 sous drapeau, 5h pour tous).

Choix par défaut retenus avec ces décisions :
- Pause immédiate pour un candidat, un groupe ou toute la séquence. « Réactiver », « Ne pas envoyer cette étape » et « Supprimer » gardent leur fenêtre.
- `create_sequence` n'est jamais automatique.
- Une inscription réussie fait passer en Retenu un candidat À trier ou Écarté (origine `user`), avec création de la ligne si besoin, comme `handleShortlist`.
- Séquences partagées : le panneau montre celles de la mission, plus les partagées qui portent des candidats de la mission. Toutes sont proposées dans Contacter, sous « Autres séquences de l'organisation ».
- Rang 9 : les relances du jour qui ne partiront pas sans vous.
- Un arrêt manuel clôt l'inscription en `completed` avec `tracking_data.completion_reason = 'manual_stop'`. L'anti-doublon de 90 jours la compte. Une réponse tardive est vue par `lateReplyEnrollments`. Le texte d'aide dit « Vous pourrez le relancer plus tard ».
- Les exécutions annulées par un arrêt portent le motif « Arrêt manuel », déjà réarmable.
- Aucune restriction nouvelle sur le réordonnancement des étapes.

### 1.3 Principes du découpage

Drapeau `konekt.sequences-v2` :
- module `src/lib/sequencesBeta.ts`, sur le modèle de `missionBeta.ts` : clé locale et paramètre `?sequences-v2=1|0`, lectures sous try/catch ;
- éteint par défaut de 5c-2 à 5g. Les routes nouvelles existent, mais aucun lien n'y mène tant qu'il est éteint ;
- allumé pour tous en 5h, avec `?sequences-v2=0` comme secours ; retiré en 5j.

Sans drapeau : 5a, 5a-2, 5b, 5c-1 (aucun effet visible), 5d-1, 5f-1, la règle Retenu de 5f-2, l'onglet Invitations de la messagerie (5f-3), 5i et les correctifs. Leur effet est voulu tout de suite.

Aucune migration :
- chaque sous-lot dit pourquoi il n'en a pas besoin ;
- si l'un d'eux en découvrait une indispensable, elle serait rejouable sur base vide et passerait `seq_*_audit.sql` et `rls_two_orgs_audit.sql` (CLAUDE.md, règles 6 et 7), dans un sous-lot à part.

Un seul chemin d'écriture par donnée :
- étapes : la RPC `save_sequence_steps`, y compris pour l'assistant à partir de 5e ;
- inscriptions : `enrollCandidates`, extrait en 5f-1 (l'outil de l'assistant garde son propre chemin serveur) ;
- étape du candidat : `setCandidateStages` ;
- reprises, réarmements et arrêts : par le serveur seulement ;
- relecture d'un message après l'inscription : `final_message` de l'exécution programmée, écriture déjà admise par la base.

Tests :
- chaque sous-lot écrit la version v2 des cas e2e qu'il remplace ; 5j n'a plus qu'à supprimer les cas anciens qui ont un équivalent ;
- règle des greps : toute PR qui extrait, déplace ou retire un fichier ou une fonction recopie dans sa description le résultat de `grep -rln "<nom>" tests e2e` pour chaque nom touché, et dit ce qu'elle fait de chaque fichier trouvé (adapté, inchangé et pourquoi, supprimé avec son remplaçant). Les listes de ce plan sont celles du 05/10 ; le grep de la PR fait foi ;
- règle des fonctions : toute fonction nouvelle sous `supabase/functions/` a son entrée `[functions.<nom>]` avec `verify_jwt = false` dans `supabase/config.toml` (jetons ES256, voir l'en-tête du fichier). Un test statique le vérifie à partir de 5d-1.

Contrôles de toute PR :
- `npx tsc --noEmit -p tsconfig.app.json` sous la baseline (11) et `npx vite build` ;
- `npm run test:c1`, `test:ux` et `test:agent` ; les tests Deno de `supabase/functions/_shared` touchés ;
- grep des noms de prestataires et de « Notion » dans les textes visibles ;
- aucun import orphelin.

Recette locale, obligatoire pour tout sous-lot qui touche aux envois (5a-2, 5b, 5e pour le moteur, 5f-1, 5f-2, 5g, 5h, correctifs 1 et 4), ciblée pour 5a et 5d-1 :
1. `bash e2e/local-stack/up.sh`, puis l'environnement de `/tmp/konekt-e2e-stack/env` ;
2. `npx playwright test --project=api`, puis `--project=chromium-desktop`, suites `seq-*` comprises ;
3. preuve de ce qui serait parti par le journal du faux prestataire (`GET /__log?account_id=`), et échecs simulés par `POST /__mode` (`fail_send`) ; appels au faux modèle relus dans son journal ;
4. audits `supabase/tests/seq_*_audit.sql` rejoués sur la base neuve ;
5. parcours `qa.md` des quatre personas (Guillaume, Claire, Théo, Sophie) sur les écrans du sous-lot.

### 1.4 Ordre et dépendances

| Sous-lot | Taille | Dépend de | Drapeau | Touche aux envois |
|---|---|---|---|---|
| Correctif 2 Rémunération des aperçus | P | rien | non | aperçus validés |
| 5a Garde-fous d'envoi | M | rien | non | non (il bloque ; l'outil de l'assistant écrit un champ de plus) |
| 5a-2 Garde du moteur sur les messages IA | M | 5a, correctif 2 | non | oui (moteur) |
| 5b Arrêter et Pause immédiats | G | 5a-2 | non | oui |
| 5c-1 Extraction pure | M | 5b | non (aucun effet visible) | non |
| 5c-2 Pages Séquences et entrée de la barre | G | 5c-1 | oui | non |
| 5d-1 Aperçu réel par `preview_values` | M | 5a-2 | non | non (aperçu seulement) |
| 5d-2 Éditeur unique | G | 5c-2, 5d-1 | oui | non (même RPC) |
| 5e Rédaction par l'assistant | G | 5d-2 | oui pour les écrans ; `create_sequence` sans | moteur testé sur la forme rédigée |
| 5f-1 Extraction de l'inscription | M | 5a-2, 5d-1 | non | oui |
| 5f-2 Contacter | G | 5f-1, 5c-2 | oui (la règle Retenu sans) | oui |
| 5f-3 Invitations dans la messagerie | P | 5f-2 | messagerie sans, panneau avec | non |
| Correctif 4 RGPD de `send_message` | P | rien | non | oui |
| 5g Un par un, formule gratuite | M | 5f-2, correctif 4 | oui | oui |
| 5h Bascule | M | 5c-2 à 5g | allumé | oui (tous les parcours) |
| 5i Rang 9 et « Relance auto » | P | 5h, 5a-2 | non | non |
| 5j Retraits | M | 5h, plus une semaine sans incident | retiré | non |
| 5k Mesurer | M | 5c-2, détachable | oui jusqu'à 5h | non |
| Correctif 1 Client anonymisé | P | rien | non | oui |
| Correctif 3 `draft_outreach_message` | P | avec 5e | non | non |

5d-1 peut avancer en parallèle de 5b et 5c ; il passe avant 5f-1 pour éviter deux PR sur `useEnrollmentPreview.ts` en même temps.

Coordination avec les autres lots :
- Lot 4 :
  - il réécrit `SourcingResultsV3`, où 5f-2 branche « Contacter » : recetter les deux écrans dans les deux lots (F-I9) ;
  - il crée le cadre « un par un », que 5g emprunte. Si 5g passe avant, il construit un cadre minimal que le lot 4 reprend.
- Lot 0b-5 (refus des écritures directes, au plus tôt le 09/10) : le lot 5 n'écrit l'étape que par `setCandidateStages`.
- Lot 9 : le rattachement de la conversation à la mission en dépend pour `create_sequence` ; les boutons « Rédiger » n'en dépendent pas.

---

## 2. Sous-lots

### 5a. Garde-fous d'envoi (M)

Objectif. Fermer tout de suite, sur les écrans actuels et sans toucher au moteur, les écarts du code avec les décisions 1, 4, 5 (pour l'assistant) et 7. Utile dès le merge, risque faible : la PR retire un automatisme, ajoute une case et rend l'aperçu de l'assistant exact.

Écrans et comportements.

Assistant, politique des outils :
- `enroll_in_sequence` et `resume_sequence` rejoignent `NEVER_AUTO_TOOLS` (`_shared/agent-tools.ts:133`). `resolveEffectivePolicy` ramène toute politique « auto » enregistrée à « approve » ; `isAutoEligible` les dit non éligibles.
- Paramètres › Assistant (`AgentPoliciesSettings.tsx`, l. 60 et 63) : les deux lignes passent `autoEligible: false`, avec le cadenas et la description « Peut déclencher des envois : approbation obligatoire ». Une politique « auto » déjà enregistrée s'affiche « Demander », par la règle existante (l. 203).

Assistant, outil d'inscription :
- `enroll_in_sequence` refuse une séquence qui contient une étape à message avec `use_ai_personalization` (décision 5 : la relecture par inscrit est impossible depuis la conversation). Refus dans `verifyAccess`, raison rendue au modèle : « Cette séquence contient un message rédigé par l'IA pour chaque candidat : inscrivez ce candidat depuis l'écran, où vous relirez son message. »
- Le candidat est relu dans la mission : ligne `job_candidate_status` de l'organisation et de la mission (`project_id` = `job_id`), rapprochée par `candidate_id`, puis par le slug de `linkedin_profile_url`. Champs retenus : `candidate_name`, `candidate_headline`, et le poste et l'entreprise actuels de `linkedin_profile_data` s'ils y sont.
- `dryRun` construit une inscription fictive avec ces champs, exactement ceux qu'`execute` écrira, puis rend `details.first_step_preview` par la règle du moteur : `buildSequenceContext` (client admin) puis `interpolateAndStrip` (`_shared/template-interpolation.ts`).
- `execute` écrit les mêmes champs (`profile_headline`, et `job_title`, `company_name` s'ils sont connus) à partir de la même lecture. Ce qui est montré sur la carte est ce qui part.
- Candidat absent de la mission : pas de refus nouveau. La carte le dit : « Ce candidat n'est pas encore dans la mission : aperçu construit avec son seul nom. »
- Premier message : l'étape racine (`pickFirstRootStep`, même règle qu'`execute`), puis le parcours principal jusqu'à la première étape qui porte un texte (note d'invitation, message, InMail). À une fourche « Vérifier la relation », les deux textes, chacun avec sa condition (« Si déjà en relation », « Sinon »). Étape A/B : la version A, puis « Version B selon le tirage » avec son texte.

Carte d'approbation (`AgentToolApprovalCard.tsx`) :
- bloc « Premier message pour Claire Dubois », texte entier, retours à la ligne gardés, aucune troncature ;
- type d'étape (« Invitation avec note », « Message », « InMail ») et objet s'il y en a un ;
- donnée absente signalée sous le texte : « Poste actuel inconnu : retiré du message. » ;
- un candidat par carte : le seuil de 5 ne s'y applique pas. Le module du seuil servira si l'outil inscrit un jour plusieurs candidats.

Fenêtres d'inscription et InMail groupé (décisions 4 et 7) :
- `RecipientsConfirm` dans le pied, à côté du bouton, dans trois fenêtres :
  - `EnrollmentPreviewModal` : N = `activeProfiles.length`, le nombre du bouton « Inscrire N candidats » (l. 1040) ;
  - l'inscription simple de `SequenceEnrollModal` : N = `enrollCount` (l. 554) ;
  - `BulkInMailModal` : N = `readyCount`, bouton « Planifier N InMails » (l. 1281).
- Dès que N vaut 5 ou plus :
  - case « Je confirme les destinataires » ;
  - aide reliée par `aria-describedby` : « Obligatoire à partir de 5 candidats. » ;
  - bouton désactivé tant qu'elle n'est pas cochée ;
  - case décochée dès que la liste des destinataires change (signature des identifiants), retirée si N repasse sous 5.
- Au-dessus de la case, dès 5 : « Premier message, pour Claire Dubois », texte entier dans un bloc qui défile, sans troncature.
  - `BulkInMailModal` : objet et texte du premier InMail prêt.
  - Inscription simple (séquence sans message) : « Aucun message écrit. Première action : visite de profil. »
- Mode Récapitulatif de `EnrollmentPreviewModal` (plus de 10 candidats, `isBulk` l. 251) : bloc « Aperçu du premier message » sur le premier candidat prêt, avec ‹ › pour passer aux suivants.
- Étape rédigée par l'IA dans ces aperçus : l'aperçu généré s'il existe ; sinon « Message rédigé par l'IA Konekt pour ce candidat : générez-le pour le relire. » [Générer l'aperçu] (génération existante, coût annoncé). La phrase « au moment de l'envoi » n'apparaît nulle part. L'obligation de générer et de relire arrive en 5a-2.
- Rendu des étapes écrites : celui d'aujourd'hui (retouche si elle existe, sinon `resolveVariables`). Il passe à `preview_values` en 5d-1.
- L'AlertDialog « Planifier N InMails ? » reste.

Appels serveur. Aucun nouveau. L'aperçu de l'outil d'inscription réutilise `buildSequenceContext` et `interpolateAndStrip`.

Migration. Aucune : politique d'outil, aperçu, refus et case sont du code ; `profile_headline`, `job_title` et `company_name` existent sur `sequence_enrollments`.

Fichiers.
- Créés :
  - `src/lib/contactRecipientsGuard.ts` : seuil (5), `recipientsConfirmRequired(n)`, `recipientsSignature(ids)`, textes de l'aide ;
  - `src/components/outreach/enrollment-preview/RecipientsConfirm.tsx` : aperçu du premier message, case et aide ; réutilisé en 5a-2 et 5f-2 ;
  - `supabase/functions/_shared/enroll-preview.ts` et `enroll-preview.test.ts` : `firstTextSteps(steps)`, `hasAiPersonalizedStep(steps)`, `missionCandidateFields(row)` ;
  - `tests/agent/sequence-tools-policy.test.mjs`, `tests/ux/lot5a-destinataires.test.mjs`.
- Modifiés :
  - `supabase/functions/_shared/agent-tools.ts` (`NEVER_AUTO_TOOLS`) ;
  - `supabase/functions/_shared/agent-tools-mutations.ts` (`enroll_in_sequence` : `verifyAccess`, `dryRun`, `execute`) ;
  - `src/components/settings/AgentPoliciesSettings.tsx` (l. 60 et 63) ;
  - `src/components/agent/AgentToolApprovalCard.tsx` ;
  - `src/components/outreach/EnrollmentPreviewModal.tsx`, `SequenceEnrollModal.tsx`, `BulkInMailModal.tsx` ;
  - `e2e/api/seq-assistant.spec.ts`, `e2e/flows/seq-ui-1.spec.ts`, `e2e/flows/seq-final-inmail-ui.spec.ts` (cas nouveaux) ;
  - CLAUDE.md, « Séquences : règles du moteur et de l'interface » : deux outils jamais automatiques, refus des séquences IA par l'outil, case dès 5 candidats sur les trois fenêtres.
- Retirés : aucun.

Tests à écrire.
- `tests/agent/sequence-tools-policy.test.mjs`, sur le modèle de `stage-tools-policy.test.mjs` :
  - les deux outils sont dans `NEVER_AUTO_TOOLS` ; `resolveEffectivePolicy` et `isAutoEligible` les traitent comme la liste ;
  - les deux lignes de `AgentPoliciesSettings.tsx` ont `autoEligible: false` ;
  - `create_sequence` n'est pas encore concerné (5e).
- `supabase/functions/_shared/enroll-preview.test.ts` (Deno) :
  - visite puis invitation : le texte retenu est la note ;
  - fourche « Vérifier la relation » : deux textes avec leur condition ;
  - A/B : versions A puis B ;
  - séquence sans texte : aucun texte, première action nommée ;
  - `hasAiPersonalizedStep` : vrai pour un message IA, faux pour une invitation (jamais rédigée par l'IA) ;
  - `missionCandidateFields` : mêmes champs que la charge d'insertion.
- `tests/ux/lot5a-destinataires.test.mjs` :
  - module pur : 4 sans case, 5 avec case, signature qui change quand un candidat est retiré ;
  - la case est montée dans les trois fenêtres, avec le bon nombre (`activeProfiles.length`, `enrollCount`, `readyCount`) ;
  - le bouton est désactivé sans elle ; aide reliée par `aria-describedby` ;
  - aperçu présent dans le Récapitulatif et dans `BulkInMailModal` ;
  - la carte rend `first_step_preview` sans `slice` ni troncature ;
  - aucune phrase « au moment de l'envoi » sous `src/` ; aucun nom de prestataire.
- `e2e/api/seq-assistant.spec.ts`, cas nouveaux :
  - politique « auto » enregistrée pour `enroll_in_sequence`, puis pour `resume_sequence` : l'outil est proposé, aucune inscription ni reprise avant l'approbation ;
  - `first_step_preview` contient le texte entier, avec le prénom et le poste de la ligne de la mission ;
  - après approbation et un passage du moteur, le journal du faux LinkedIn contient exactement le texte de l'aperçu, et l'inscription porte le `profile_headline` de la mission ;
  - séquence avec une étape IA : refus, aucune inscription.
- `e2e/flows/seq-ui-1.spec.ts`, cas nouveaux : 5 candidats, bouton grisé jusqu'à la case ; 4 candidats, pas de case ; un candidat retiré décoche la case ; 11 candidats, « Aperçu du premier message » avec ‹ ›.
- `e2e/flows/seq-final-inmail-ui.spec.ts`, un cas de plus : 5 InMails, case obligatoire et aperçu du premier InMail.

Tests existants à adapter. Grep du 05/10 : `grep -rln "enroll_in_sequence\|resume_sequence\|AgentToolApprovalCard\|AgentPoliciesSettings\|EnrollmentPreviewModal\|SequenceEnrollModal\|BulkInMailModal" tests e2e`, recopié dans la PR.
- À changer :
  - `tests/ux/seq-audit-f5.test.mjs`, l. 382 : attend `autoEligible: true` pour `enroll_in_sequence`.
- À relire (motifs sur les blocs modifiés) :
  - `tests/ux/seq-audit-b5.test.mjs` (l. 167, 241, 258, 336) et `seq-audit-b5-final.test.mjs` (l. 118, 206-217) : blocs `verifyAccess`, `dryRun` et `execute` des deux outils ;
  - `tests/ux/lot12a-parametres-compte.test.mjs`, l. 293 (libellé du Journal) ;
  - pieds des fenêtres : `lot6c-preparation`, `seq-audit-f4a`, `f4b`, `f4c`, `f4-final`, `f4-final2`, `tests/c1/lot0c-socle-ecrans`, `lot0c4-fiches` ;
  - `BulkInMailModal` : `seq-audit-e3-cross`, `lot6d-suivi`, `tests/c1/lot0b-ecrivains` ;
  - carte : `barre-lot6-a-traiter`, `lot12b-parametres-organisation`.
- À rejouer verts sans changement attendu : aucune spec relevée n'inscrit 5 candidats ou plus ni n'inscrit l'assistant dans une séquence IA (grep des libellés « Inscrire N » et « Planifier N » et de `use_ai_personalization: true`) :
  - `e2e/api` : `seq-assistant`, `seq-decisions-assistant`, `seq-identity`, `seq-actions-2`, `seq-scheduled-1`, `seq-scheduled-2` (actions déjà approuvées : inchangées) ;
  - `e2e/flows` : `seq-ui-1` (l. 839-988), `seq-ui-2` (InMail groupé, l. 1493-1525), `seq-final-inmail-ui` (l. 339-340), `seq-last-enroll-batch` (l. 236), `seq-identity` (l. 215).

Recette locale ciblée : les suites ci-dessus, et la comparaison du texte de la carte avec le journal du faux LinkedIn.

Critère de fin.
- `test:agent`, `test:ux`, `test:c1` et `enroll-preview.test.ts` verts ; `tsc` sous la baseline ; `vite build` passe.
- Sur la stack locale :
  - une politique « auto » n'inscrit ni ne reprend plus personne sans clic ;
  - la carte montre le message entier, et c'est ce texte que reçoit le faux LinkedIn ;
  - l'outil refuse une séquence IA ;
  - 5 candidats ou 5 InMails ne partent qu'avec la case ; 4 sans case ;
  - les suites rejouées sont vertes.

Risques. Faibles.
- Une spec qui inscrirait 5 candidats ou plus échouerait sans la case : aucune au 05/10, grep à refaire dans la PR.
- Rapprochement du candidat dans la mission : par identifiant puis par slug ; à défaut, aperçu avec le seul nom, annoncé.

### 5a-2. Garde du moteur : aucun message IA sans relecture (M)

Objectif. Décision 5. Le moteur ne rédige plus jamais un message à l'envoi sans relecture humaine. Il reporte l'étape avec une raison lisible, sans l'annuler ; elle repart après relecture. L'interface rend la génération et la relecture obligatoires avant l'inscription, et permet de relire après coup. Sans drapeau.

Moteur (`process-sequences/index.ts`).
- Règle : une exécution d'une étape à message (`needsMessage`) avec `use_ai_personalization`, sans texte relu, ne part pas.
- Texte relu :
  - la retouche validée à l'inscription, `tracking_data.message_overrides[step_id]` ;
  - ou le message corrigé dans le Journal, `final_message` d'une exécution programmée.
  Ce sont exactement les deux cas où le moteur n'appelle pas l'IA aujourd'hui : la garde se pose quand `aiWillGenerate` est vrai (l. 2646), copie périmée du modèle comprise (`isStaleTemplateSnapshot`).
- Place : juste après le calcul d'`aiWillGenerate`, avant `hasTimeToLock`, avant le verrou et avant `checkQuotaForAction`. Aucune place du plafond LinkedIn n'est donc réservée.
- Effet :
  - l'exécution reste `scheduled` ;
  - `scheduled_at` avance d'une heure (même forme que le report des identifiants indisponibles, l. 1996) ;
  - `error_message` = « Message rédigé par l'IA à relire avant l'envoi. » ;
  - compté dans `results.skipped` ;
  - inscription inchangée : ni pause, ni échec, ni `retry_count`, ni auto-pause ;
  - aucun appel au modèle, aucun débit de crédits.
- Chemins couverts : inscrits actuels des séquences IA, étape IA ajoutée à une séquence qui a déjà des inscrits, relance (`re_enroll`), reprise, ancien parcours jusqu'à 5j, onglet resté ouvert sur une ancienne version du navigateur.
- `generatePersonalizedMessage` reste dans le code ; il n'est plus atteint à l'envoi. Son retrait se décidera après 5j.
- Règle en module pur : `aiReviewRequired({ useAi, actionType, editedMessage, usedOverride })` dans `_shared/sequence-send-rules.ts`.

Avant le merge : une lecture en production compte les inscriptions actives ou en pause d'une séquence à étape IA (requête en lecture seule). Si ce nombre n'est pas nul, leurs auteurs sont prévenus à la main.

Interface.
- « Relire les messages » (`EnrollmentPreviewModal`), quand la séquence a une étape rédigée par l'IA :
  - le bouton « Inscrire N candidats » reste désactivé tant que chaque candidat à inscrire n'a pas son texte généré pour chacune de ces étapes ;
  - message : « Générez et relisez les messages rédigés par l'IA avant d'inscrire : 3 candidats sur 5 n'en ont pas encore. » [Générer tous les aperçus] ;
  - puis case « J'ai relu les messages rédigés par l'IA », obligatoire quel que soit N, décochée par toute génération ou régénération ;
  - dès 5 candidats, une seule case : « Je confirme les destinataires et j'ai relu les messages rédigés par l'IA » (règle ajoutée à `contactRecipientsGuard.ts`) ;
  - le Récapitulatif montre les messages IA candidat par candidat (‹ ›) ;
  - les textes générés partent tels quels (`message_overrides`), comme aujourd'hui.
- Relecture après l'inscription :
  - le parcours du suivi (`SequenceEnrollmentsPanel`, qui affiche déjà la raison d'une exécution programmée, l. 1236) et le Journal (`SequenceActivityLog`) portent « Relire le message » sur l'étape reportée ;
  - il ouvre `EditScheduledMessageModal`, prérempli avec le modèle de l'étape, avec « Proposer avec l'IA » (génération d'aperçu existante pour ce candidat et cette étape, coût annoncé, résultat modifiable) ;
  - « Enregistrer » écrit `final_message` (et `final_subject`), écriture déjà admise sur une étape encore programmée (`EXECUTION_NOT_SCHEDULED`) ;
  - le moteur l'envoie au premier passage après la date reportée, au plus une heure plus tard ;
  - aucune réécriture de `tracking_data` depuis le navigateur après l'inscription (pas d'écrasement concurrent) ;
  - collaborateur : ses inscriptions seulement (règle existante du Journal).
- Libellé de la raison dans `sequenceErrorMessages.ts` (`formatErrorMessage`).

Prérequis. Correctif 2 (rémunération retirée des aperçus de `generate-outreach-message`), livré avant ou dans cette PR : la génération devient obligatoire.

Migration. Aucune : la garde est du code ; la raison va dans `error_message` ; la relecture réutilise `final_message`.

Fichiers.
- Créés : `e2e/api/seq-ai-review-guard.spec.ts`, `e2e/flows/seq-ai-review.spec.ts`, `tests/ux/lot5a2-relecture-ia.test.mjs`.
- Modifiés : `process-sequences/index.ts`, `_shared/sequence-send-rules.ts` et son test, `EnrollmentPreviewModal.tsx`, `useEnrollmentPreview.ts` (compte des textes IA manquants), `contactRecipientsGuard.ts`, `RecipientsConfirm.tsx`, `SequenceEnrollmentsPanel.tsx`, `SequenceActivityLog.tsx`, `activity-log/EditScheduledMessageModal.tsx`, `sequenceErrorMessages.ts`, CLAUDE.md (règle du moteur).
- Retirés : aucun.

Tests à écrire.
- `_shared/sequence-send-rules.test.ts` (Deno), table de `aiReviewRequired` : IA et message sans retouche, vrai ; retouche, faux ; correction du Journal, faux ; invitation, faux ; IA désactivée, faux ; copie périmée du modèle, vrai.
- `e2e/api/seq-ai-review-guard.spec.ts` (faux LinkedIn, faux modèle) :
  1. séquence IA, inscription sans retouche, trois passages du moteur : aucun appel au faux modèle, journal du faux LinkedIn vide, exécution `scheduled`, date reportée d'une heure, raison posée, inscription `active`, aucune pause automatique ;
  2. retouche à l'inscription : le texte part tel quel ;
  3. correction par le Journal après un report : le texte part au passage suivant ;
  4. relance (`re_enroll`) et reprise sur une étape IA : reportées ;
  5. étape IA ajoutée par `save_sequence_steps` à une séquence qui a des inscrits : reportée ;
  6. aucune place du plafond LinkedIn consommée par une étape reportée.
- `e2e/flows/seq-ai-review.spec.ts` :
  - « Relire les messages » : bouton grisé tant qu'un texte IA manque, « Générer tous les aperçus », case, inscription ;
  - suivi : raison affichée, « Relire le message », « Enregistrer », raison retirée.
- `tests/ux/lot5a2-relecture-ia.test.mjs` :
  - garde placée avant `hasTimeToLock` et avant `checkQuotaForAction` ;
  - aucune écriture de `status: 'paused'` ni `'failed'` dans sa branche ;
  - bouton conditionné ; « Relire le message » n'écrit que `final_message` et `final_subject`.

Tests existants à adapter. Grep : `grep -rln "use_ai_personalization: true\|generatePersonalizedMessage\|aiWillGenerate\|usedPreviewOverride\|EditScheduledMessageModal" tests e2e`.
- `e2e/api`, cas qui exercent la rédaction à l'envoi, désormais injoignable. Chacun est réécrit pour prouver le report, ou reçoit une retouche quand son sujet est ailleurs :
  - `seq-steps-1.spec.ts`, l. 495 (« une réponse IA illisible… ») ;
  - `seq-steps-2.spec.ts`, l. 759 (« Crédits IA épuisés… »), l. 785 (« refus passager (429)… »), l. 811 (« Copie du modèle laissée… ») ;
  - `seq-decisions-engine.spec.ts`, l. 338 (« rédaction IA indisponible ») ;
  - `seq-meeting.spec.ts`, l. 87 (sujet : rendez-vous ; retouche ajoutée) ;
  - `seq-engine-2.spec.ts`, l. 1012 (« ia-indisponible »), l. 1115 (« budget-cycle »).
  `seq-steps-2.spec.ts`, l. 737 (« un aperçu validé ou une correction du Journal part tel quel ») reste vert.
- `e2e/flows` : `seq-ui-1.spec.ts`, l. 784 (générer aussi la relance IA avant d'inscrire) ; `seq-ui-2.spec.ts`, l. 1141 (générer le message IA avant d'inscrire).
- Node, à relire : `seq-audit-e1a`, `e1b`, `e1c`, `e3`, `e3-cross`, `e3-final` (code IA du moteur) ; `seq-audit-f4a`, `f4-final2`, `lot6c-preparation` (aperçus) ; `lot6d-suivi`, `seq-audit-f3` (`EditScheduledMessageModal`).
- Deno, à relire : `seq-steps-2.test.ts`, `seq-engine-2.test.ts`.

Recette locale complète, avec en plus : séquence IA réelle sur un compte de test, trois passages, relecture par le Journal, envoi.

Critère de fin.
- `seq-ai-review-guard` et toutes les suites `e2e/api/seq-*` vertes après adaptation ; `seq-ai-review` vert.
- Aucun appel au faux modèle pendant un envoi dans toute la suite `e2e/api`.
- CLAUDE.md porte la règle.

Risques.
- Une séquence IA existante cesse d'envoyer sans relecture : voulu ; mesuré avant le merge ; signalé par le suivi, puis par le rang 9 (5i).
- Report d'une heure répété tant que personne ne relit : sans coût ni effet sur le compte LinkedIn.

### 5b. Arrêter et Pause immédiats, avec « Annuler » (G)

Objectif. Décision 3, sur les écrans actuels, avec des actions serveur testées. La page séquence de 5c-2 les réutilisera.

Écrans et comportements.
- « Mettre en pause pour ce candidat » (suivi, fiche, messagerie `inbox/MessageView.tsx:481`) :
  - pause `manual` écrite comme aujourd'hui (garde `.eq('status','active')`), sans fenêtre, avec `.select('id')` ;
  - toast : « Séquence mise en pause pour Claire Dubois. » [Annuler] ;
  - « Annuler » appelle `resume_enrollments` sur cette inscription.
- Pause groupée (« Mettre en pause tous les candidats actifs ») :
  - sans fenêtre ; l'écriture rend les identifiants touchés ;
  - « Annuler » ne reprend que ceux-là, par lots de 25 (logique existante) ;
  - masquée au collaborateur, comme aujourd'hui.
- « Mettre en pause la séquence » (l'interrupteur, ex « Désactiver ») :
  - sans fenêtre ; chemin `deactivateSequence` gardé (inscriptions en `sequence_inactive` avant l'interrupteur, recompte, jamais de succès sans preuve) ; l'écriture des inscriptions rend leurs identifiants ;
  - toast qui dit le résultat réel : « Séquence mise en pause : 6 candidats en pause. » [Annuler] ;
  - « Annuler » remet l'interrupteur, avec les contrôles d'offre de « Réactiver » (décision 32), puis appelle `resume_enrollments` avec les seuls `enrollment_ids` rendus. Une pause qu'il n'a pas posée (par exemple `auto_paused`) reste ;
  - hors de cette annulation, « Réactiver cette séquence ? » garde sa fenêtre ; l'interrupteur reste verrouillé pour un collaborateur.
- « Arrêter pour ce candidat », nouveau, dans « Actions pour X » (suivi) et « Actions de l'inscription » (fiche) :
  - aide sous l'élément de menu : « Le candidat reste compté comme contacté pendant 90 jours. Vous pourrez le relancer plus tard. » ;
  - toast : « Séquence arrêtée pour Claire Dubois. » [Annuler] ;
  - version groupée « Arrêter » dans la barre du suivi, 200 inscriptions au plus, masquée au collaborateur.
- Après un arrêt :
  - statut « Arrêtée par Guillaume Martin le 29/09 » (lu de `completion_reason` et de `manual_stop`) ;
  - action « Relancer la séquence » (`re_enroll`), qui réarme l'étape annulée par l'arrêt (motif « Arrêt manuel », dans `RESUMABLE_SKIP_REASONS`).
- Messages de retour :
  - « Arrêt annulé : Claire Dubois reprend la séquence là où elle en était. » ;
  - « Arrêt annulé : Claire Dubois reste en pause (compte LinkedIn non relié). » (la reprise refuse ; même forme pour séquence en pause ou registre illisible) ;
  - « Pause annulée. » ;
  - « Annulation impossible : Claire Dubois a répondu entre-temps. » ;
  - « Annulation impossible : la séquence de Claire Dubois a changé entre-temps. » ;
  - « Annulation impossible : le délai est passé. » ;
  - « Arrêt impossible pour l'instant : rien n'a changé. » [Réessayer].
- Le toast :
  - global (sonner), `role="status"`, modèle `ApprovalsSection.tsx:104-107` ;
  - 8 s, prolongé tant qu'il a le survol ou le focus, fermé d'office à 1 min 50 s (`toast.dismiss` programmé), sous la validité du jeton (2 min) : « Annuler » visible est toujours accepté par le serveur ;
  - Échap le ferme sans annuler ; recharger la page perd « Annuler », l'arrêt reste ;
  - ne promet jamais que rien n'est parti : une étape en `sending` part.
- Gardent leur fenêtre : « Ne pas envoyer cette étape ? », « Réactiver cette séquence ? », « Supprimer cette séquence ? », « Marquer comme ayant répondu ».
- L'ancien tableau de mission (`ProjectCandidatesTableEnhanced`) garde sa fenêtre jusqu'aux lots de retrait de l'ancienne page.

Appels serveur (actions membres de `process-sequences`, `MEMBER_ACTIONS`).
- `stop_enrollments` { organization_id, enrollment_ids, 200 au plus } :
  - contrôles : JWT, organisation vérifiée, collaborateur limité à ses inscriptions (`canActOnEnrollment`), candidat effacé ignoré (`isGdprErasedEnrollment`) ; seulement `active` ou `paused` ;
  - écriture conditionnelle sur le statut et l'`updated_at` relus, un nouvel essai après relecture si 0 ligne : `status = 'completed'`, `completed_at`, `pause_reason = null`, `tracking_data` relu plus `completion_reason = 'manual_stop'` et `manual_stop` { token, by, at, previous_status, previous_pause_reason } ;
  - puis `cancelPendingExecutions(id, 'Arrêt manuel')` : `scheduled`, `waiting_event`, `quota_blocked`, jamais `sending` ;
  - rend le jeton et un résultat par inscription : `stopped`, `not_eligible`, `gdpr_erased`, `forbidden`, `changed`.
- `undo_stop_enrollments` { organization_id, enrollment_ids, token } :
  - refus : `expired` (plus de 2 min), `not_author`, `moved_since` (plus `completed` avec ce jeton), `gdpr_erased`, `replied` ;
  - réponse détectée depuis l'arrêt : statut passé à `replied` (par `lateReplyEnrollments` ou `check_replies`, qui examinent les inscriptions terminées), `mission_conversations.last_inbound_at` postérieur à l'arrêt pour ce candidat dans l'organisation, ou `replied_at` postérieur sur une inscription sœur ;
  - écriture conditionnelle `completed` vers `paused` (raison d'avant, sinon `manual`), `completed_at` effacé, `completion_reason` et `manual_stop` retirés, `manual_stop_undone_at` gardé ;
  - inscription en pause avant l'arrêt : fin ; ses étapes annulées « Arrêt manuel » seront réarmées à la reprise ;
  - inscription active avant l'arrêt : `resumeOneEnrollment` (mode `resume`, séquence active vérifiée). `planResume` réarme l'exécution annulée à max(date prévue, maintenant plus 1 min), ou planifie l'étape suivante si une étape `sending` est partie pendant l'arrêt. RGPD, registre illisible, compte non relié et séquence désactivée y sont déjà traités ; si la reprise refuse, l'inscription reste en pause manuelle et le résultat dit pourquoi ;
  - aucune seconde logique de réarmement. Le dernier contrôle de réponse avant envoi du moteur reste le filet.
- `resume_enrollments`, existante : annulation d'une pause.
- Module pur `_shared/enrollment-stop.ts` : validité du jeton, tracking d'arrêt et d'annulation, lecture des refus.

Migration. Aucune.
- `completed` et `tracking_data.completion_reason` existent déjà (`meeting_booked`) ; « Arrêt manuel » est déjà réarmable.
- L'anti-doublon compte `completed` sur 90 jours partout : `find_recent_org_contacts` (20260928140414, l. 1011-1015), `enrollmentDuplicates.ts` (l. 40-44), `agent-tools-mutations.ts` (l. 699-701). Aucune liste à changer.
- Le réarmement passe la garde `EXECUTION_REARM_SERVER_ONLY`, qui ne vise que le rôle `authenticated`.

Fichiers.
- Créés : `_shared/enrollment-stop.ts` et `enrollment-stop.test.ts`, `src/hooks/useUndoableEnrollmentAction.ts`, `e2e/api/seq-stop.spec.ts`, `tests/ux/lot5b-arret-pause.test.mjs`.
- Modifiés :
  - `process-sequences/index.ts` (`MEMBER_ACTIONS`, aiguillage) ;
  - `SequenceEnrollmentsPanel.tsx`, `CandidateSequencesPanel.tsx`, `useCandidateEnrollments.ts`, `inbox/MessageView.tsx`, `SequencesList.tsx` (interrupteur) ;
  - `sequenceLabels.ts`, `SequenceBadges.tsx` (statut d'un arrêt manuel), `sequenceErrorMessages.ts` (refus) ;
  - `e2e/flows/sequences-enrollments.spec.ts` (cas nouveaux) ;
  - CLAUDE.md : exception à la règle AlertDialog pour ces gestes, actions membres, arrêt manuel dans « Séquences : règles du moteur et de l'interface ».
- Retirés : les AlertDialog de pause du suivi et de la fiche, celui de pause groupée, celui de désactivation.

Tests à écrire.
- `enrollment-stop.test.ts` (Deno).
- `e2e/api/seq-stop.spec.ts` :
  - l'arrêt annule les trois statuts en attente avec « Arrêt manuel », ne touche pas `sending`, et le journal du faux LinkedIn reste vide après un passage ;
  - après l'arrêt, `find_recent_org_contacts` renvoie l'inscription ; un collègue est refusé dans une autre séquence, par l'écran comme par l'assistant ;
  - annulation dans les 2 min : étape réarmée à sa date (ou dans une minute), puis partie au passage suivant ;
  - annulation d'un arrêt posé sur une pause : retour en pause avec sa raison ;
  - étape `sending` partie pendant l'arrêt : l'annulation planifie l'étape suivante ;
  - refus : délai passé, autre auteur, jeton faux, réponse simulée au webhook, RGPD ; compte dissocié entre-temps : reste en pause, raison rendue ;
  - collaborateur ; 201 identifiants refusés ;
  - réponse tardive après un arrêt : l'inscription passe `replied` ;
  - « Relancer » après un arrêt : reprend l'étape annulée ;
  - pause puis annulation par `resume_enrollments` ; pause de séquence annulée : seules les inscriptions rendues reprennent, une `auto_paused` antérieure reste.
- `tests/ux/lot5b-arret-pause.test.mjs` :
  - plus d'AlertDialog sur ces gestes ; toast de 8000 ms, fermeture d'office à 110 000 ms au plus ;
  - annulation par `process-sequences` ;
  - aucune écriture de `status: 'active'` ni `'completed'` ni d'exécution depuis le navigateur ;
  - texte d'aide exact ; aucun « Définitif ».
- `e2e/flows/sequences-enrollments.spec.ts`, cas nouveaux : pause puis « Annuler » ; « Arrêter » puis « Annuler » ; pause de séquence puis « Annuler ».

Tests existants à adapter. Grep : `grep -rln "Désactiver cette séquence\|Mettre en pause la séquence pour\|Mettre en pause tous les candidats\|Mettre en pause « \|Mettre en pause pour ce candidat\|confirmAction\|La séquence reste active\|stopEnrollment\|bulkStopActive\|deactivateSequence\|requestToggle" tests e2e`.
- Node :
  - `lot6d-suivi.test.mjs`, l. 112-125 (« arrêt groupé derrière la confirmation ») ;
  - `seq-audit-f2a` (dialogues de désactivation, `stopEnrollment`, `bulkStopActive`, `deactivateSequence` l. 66 et 134) ;
  - `seq-audit-f2b` (« Mettre en pause pour ce candidat », `requestToggle` l. 171) ;
  - `seq-audit-f2d` (`confirmAction`, « La séquence reste active », exécution de `requestToggle`, `deactivateSequence`, `bulkStopActive`) ;
  - `seq-audit-f2e` (`requestToggle`) ; `seq-audit-f3` (fiche) ; `seq-audit-f3-last`, l. 235 ;
  - à relire : `lot6-catalogue` (statuts), `seq-audit-e1-final`, `e1-last` (actions membres).
- e2e :
  - `sequences-enrollments.spec.ts`, l. 312-336 ;
  - `seq-ui-2.spec.ts`, l. 312-366 et 1602-1603 (« Mettre en pause « X » ? ») ;
  - `seq-ui-1.spec.ts`, l. 1409-1479 ;
  - `seq-actions-2.spec.ts` (flows), l. 222-226 (« Désactiver cette séquence ? ») ;
  - `seq-decisions-ui.spec.ts` (fiche, collaborateur).

Recette locale, avec en plus : arrêt d'une étape prévue dans la minute ; `sending` posé en base pendant un arrêt ; réponse simulée au webhook pendant la fenêtre ; compte déconnecté ; arrêt annulé pendant une attente d'acceptation ; 200 inscriptions mesurées dans la limite de 60 s.

Critère de fin.
- `seq-stop` et toutes les suites `e2e/api/seq-*` vertes ; audits `seq_*` verts.
- Aucune fenêtre de confirmation sur la pause et l'arrêt.
- CLAUDE.md porte l'exception.

Risques.
- 200 arrêts dans 60 s : écritures groupées quand le statut lu est le même ; mesuré en recette.
- Attente d'acceptation annulée puis réarmée : elle repasse par `scheduled`, puis le moteur la remet en `waiting_event` (l. 3007), comme dans toute reprise. Le délai d'attente est relu en recette.
- Statistiques : un arrêt manuel compte parmi les « Terminées » de `SequenceAnalytics` jusqu'à 5k, qui les distingue.

### 5c-1. Extraction pure (M)

Objectif. Préparer les pages sans rien changer. Sortir des gros composants ce que les pages réutiliseront, et ce dont les fichiers gardés dépendent. Aucune modification de logique. Aucun effet visible, donc pas de drapeau.

Contenu.
- `src/types/sequence.ts` : `SequenceStep`, `StopConditions`, `SenderAccountConfig`, `Sequence` (aujourd'hui `SequenceBuilder.tsx`, l. 115-176).
  - `sequenceGraph.ts`, `messageTypeUtils.ts`, `SequencesList.tsx` et `SequenceTemplateSelector.tsx` importent le nouveau module ;
  - `SequenceBuilder.tsx` les réexporte jusqu'à 5j, pour les fichiers voués au retrait (`StepEditor`, `WorkflowCanvas`, `nodes/WorkflowStepNode`, `VisualSequenceEditor`, `SequenceValidationChecklist`).
- `src/lib/sequenceActions.ts`, dépendances passées en paramètres (client, toast, mises à jour d'état), comme les tests les exécutent déjà :
  - de `SequencesList` : `requestToggle`, `deactivateSequence`, `activateSequence`, `handleDuplicate`, `handleEdit` (lecture), `handleNudgeToday`, `handleDelete`, `sequenceSaveError`, `blockedStepsNotice`, la règle `createInactiveForPlan` ;
  - de `SequenceEnrollmentsPanel` : `stopEnrollment`, `bulkStopActive`, `bulkResumePaused`, `markReplied`, `isGdprErased`, `resumeRetriesFailedStep`, `handleSkipExecution` ;
  - versions issues de 5b.
- `src/hooks/useSequenceSave.ts` : `handleSaveSequence` (l. 504-679) à l'identique (`save_sequence_steps`, `CONCURRENT_EDIT_MESSAGE`, suppression de l'en-tête créé si les étapes échouent, séquence créée désactivée selon l'offre).
- `src/components/outreach/SaveAsTemplateModal.tsx` : sorti de `SequenceTemplateSelector.tsx` (l. 437-520), qui l'importe. Gardé après 5j.
- `tests/ux/seq-v2-graphe.test.mjs` : copie des tests de `sequenceGraph.ts` portés par `seq-audit-f1a`, `f1b` et `f1d`, sans charger les fichiers voués au retrait. 5j ne perd aucune couverture.

Migration. Aucune.

Fichiers.
- Créés : les quatre modules ci-dessus et le test.
- Modifiés : `SequenceBuilder.tsx`, `SequencesList.tsx`, `SequenceEnrollmentsPanel.tsx`, `SequenceTemplateSelector.tsx`, `sequence/sequenceGraph.ts`, `sequence/messageTypeUtils.ts`.
- Retirés : aucun.

Tests à écrire. `tests/ux/seq-v2-graphe.test.mjs` ; dans `tests/ux/seq-v2-socle.test.mjs` (créé ici, étendu en 5c-2) : les types ne viennent plus de `SequenceBuilder` dans les fichiers gardés.

Tests existants à adapter. Grep du 05/10 sur les fonctions et fichiers déplacés :
- exécution des fonctions par leur nom, qui chargent désormais `sequenceActions.ts`, assertions inchangées : `seq-audit-f2d`, `seq-audit-f2e`, `seq-audit-f3-last` ;
- `body(list, '…')` et tranches de `SequencesList` : `seq-audit-f2a` (l. 36, 66, 69, 134, 168, 186, 191, 208, 215, 227), `seq-audit-f2b` (`handleSaveSequence` l. 92-119, `requestToggle` l. 171, `markReplied` l. 51, `createInactiveForPlan`), `seq-audit-f2c` (`activateSequence`, `handleEdit`, `handleSaveSequence`, `blockedStepsNotice`, `handleNudgeToday`), `seq-audit-f1c` (l. 65-66, `createInactiveForPlan`, `handleDuplicate`), `seq-audit-f1a` et `f1d` (`handleDuplicate`), `lot6b-sequences` (l. 50, tranche de `handleEdit`), `seq-audit-b6` (l. 275, `STEP_HAS_HISTORY` dans `SequencesList`) ;
- `SaveAsTemplateModal` : `seq-audit-f1d`, l. 193 (lu dans `SequenceTemplateSelector`) ;
- à relire (même nom dans d'autres fichiers) : `seq-audit-f3`, `f3-final`, `e1-final`, `e1a`, `e1b`, `e1-last` (`markReplied`, `isGdprErased`, `handleSkipExecution`), `tests/c1/lot0b-ecrivains` (`markReplied`), `tests/c1/c1-front` et `lot12b-parametres-organisation` (`handleDelete`) ;
- lecteurs de `SequencesList.tsx` ou `SequenceEnrollmentsPanel.tsx` à rejouer : `fondations-simplicite`, `lot12d-illustrations`, `lot6d-suivi`, `e2e/flows/seq-decisions-ui`, `sequences-enrollments`.

Critère de fin.
- Suites Node vertes avec les mêmes assertions (seul le fichier lu change).
- Sur la stack locale : `sequences-builder`, `seq-ui-1`, `seq-ui-2`, `seq-actions-2`, `sequences-enrollments`, `seq-steps-1` verts.
- Diff relu : fonctions déplacées, appels remplacés, aucune ligne de logique modifiée.

Risques. L'enregistrement de tous passe par le hook extrait. Parades : tests qui exécutent ces fonctions, specs e2e de l'éditeur actuel, aucune autre modification dans la PR.

### 5c-2. Pages Séquences et entrée de la barre latérale (G)

Objectif. Donner à chaque séquence sa page (suivi, journal, réglages) et créer l'écran de l'organisation, avec son entrée dans la barre latérale (décision 8). Tout est derrière le drapeau.

Écran `/sequences`.
- Onglets « Toutes », « À venir », « Modèles », « Statistiques » :
  - « Modèles » : `sequence_templates` et les modèles Konekt livrés dans le code (`sequenceStarterTemplates.ts`) ;
  - « Statistiques » : `SequenceAnalytics`, vue globale.
- En-tête :
  - « Envoyer les actions du jour » sur toutes les séquences que la personne peut gérer (`nudge_sequences` avec leurs `sequence_ids`), fenêtre actuelle gardée ;
  - « Créer une séquence », seul bouton plein. Il ouvre le créateur actuel jusqu'à 5d-2.
- Tableau : interrupteur (pause immédiate de 5b), barre de progression, alertes par cause reprises de `SequencesList`, « Accept. » et « Rép. » à partir de 5 contactés.

Page `/sequences/:id`.
- En-tête :
  - fil d'Ariane avec `&depuis=mission:<id>`, « Renommer la séquence », pastille de statut, ligne de rythme, un seul bouton plein ;
  - menu « … » : « Dupliquer » (`handleDuplicate`, copie nommée « Copie de … »), « Enregistrer comme modèle » (`SaveAsTemplateModal`), « Envoyer les actions du jour » (cette séquence), « Diagnostic des envois » (mène à la carte du Journal), « Raccourcis clavier », « Supprimer » (AlertDialog actuel « Supprimer cette séquence ? », 0 ligne supprimée donne « Suppression impossible »).
- Onglet « Étapes » : fil vertical en lecture, rendu en DOM, avec branches, délais et fin de séquence ; « Modifier les étapes » ouvre l'éditeur actuel jusqu'à 5d-2.
- Onglet « Candidats » :
  - puces sans zéro ; statut et prochaine action par `enrollmentStatusLine` (arrêt manuel de 5b et message à relire de 5a-2 compris) ;
  - panneau « Parcours de Claire Dubois » ;
  - gestes de 5b ; « Reprendre », « Relancer la séquence », « Ne pas envoyer cette étape », « Marquer comme ayant répondu », « Relire le message » (5a-2), par les actions existantes.
- Onglet « Statistiques » : `SequenceAnalytics` pour cette séquence.
- Onglet « Journal » : carte « État de l'envoi » (corps de `SequenceDiagnostic`), puis la file de `SequenceActivityLog` dans la page, paginée par curseur sur (`scheduled_at`, `id`).
- Onglet « Réglages » : `MultiSenderSettings` et `StopConditionsSettings`, sous « Conditions d'arrêt ».

Accès quand le drapeau est allumé :
- entrée « Séquences » de la rangée basse de la barre latérale (`SidebarBottomRow.tsx`), entre Agenda et Marketplace : même `<Link>`, `aria-label`, `aria-current`, infobulle en barre repliée ;
- ligne de `SequencesList` (panneau provisoire et ancienne page) ; « Toutes les séquences de l'organisation » ;
- palette Ctrl J (`NavigationPalette.tsx`, entrée « Séquences ») ;
- raccourci « G puis S » (`GoShortcuts.tsx`, lettre libre) et sa ligne dans `KeyboardShortcutsDialog`.

Fichiers.
- Créés :
  - `src/lib/sequencesBeta.ts`, `src/lib/enrollmentStatusLine.ts`, `src/lib/sequenceStarterTemplates.ts` ;
  - `src/pages/SequencesPage.tsx`, `src/pages/SequenceDetailPage.tsx` ;
  - `src/components/sequences/` : `SequenceHeader`, `SequenceMenu`, `SequenceStatusPill`, `SequenceTabs`, `RhythmLine`, `SequencesTable`, `SequenceRow`, `EnrollmentProgressBar`, `SenderAvatars`, `StepsReadOnly`, `CandidatesTab`, `JourneyPanel`, `JournalTab`, `SendHealthCard`, `SettingsTab` ;
  - `e2e/flows/seq-v2-suivi.spec.ts`.
- Modifiés :
  - `src/App.tsx` : routes avec `ProtectedRoute`, `OrganizationGuard` et `AppLayout` ;
  - `SequencesList.tsx`, `SequenceActivityLog.tsx`, `SequenceDiagnostic.tsx` (corps utilisable hors du Sheet) ;
  - `src/components/sidebar/SidebarBottomRow.tsx`, `NavigationPalette.tsx`, `GoShortcuts.tsx`, `sidebar/KeyboardShortcutsDialog.tsx` ;
  - CLAUDE.md (section « Barre latérale », rangée basse) et `docs/design/06-simplicite.md` (exception à « La barre latérale reste telle qu'elle est » : décision 8 du 05/10).
- Retirés : aucun.

Appels serveur. Aucun nouveau : `get_sequence_enrollment_counts`, actions membres existantes et celles de 5b.

Migration. Aucune.

Tests à écrire.
- `tests/ux/seq-v2-socle.test.mjs` :
  - `enrollmentStatusLine` : une ligne par cas du tableau des statuts (spec-cible 3.1), plus l'arrêt manuel et le message à relire ;
  - drapeau éteint par défaut, lecture sous try/catch ; routes gardées ;
  - entrée « Séquences » de la barre présente seulement drapeau allumé ;
  - aucune écriture d'exécution ni de `status: 'active'` sous `src/components/sequences` ;
  - aucun nom de prestataire ; puces sans zéro ; « Supprimer » derrière un AlertDialog.
- `e2e/flows/seq-v2-suivi.spec.ts`, avec `?sequences-v2=1` :
  - entrée de la barre latérale, écran `/sequences`, « Envoyer les actions du jour » ;
  - page, puces, Parcours ; pause et arrêt avec « Annuler » ;
  - Journal et carte « État de l'envoi » ; Réglages enregistrés ;
  - menu « … » : Dupliquer, Enregistrer comme modèle, Supprimer ;
  - collaborateur sur ses propres lignes.

Tests existants à adapter.
- `tests/ux/barre-lot56-coquille.test.mjs`, B-C6 (l. 158-172) : cinq liens dans la liste quand le drapeau est allumé, `/sequences` et « Séquences » attendus.
- `tests/ux/barre-lot6-assistant.test.mjs`, B6A-7 (l. 172-182) : entrée de palette « Séquences ».
- À relire : `tests/ux/lot12c-barre-laterale.test.mjs` (rangée basse) ; `seq-audit-f2b` et `f2c` (props du Journal, Statistiques et Diagnostic bornés à la mission) ; `lot6d-suivi` (Journal, Diagnostic).

Critère de fin.
- Drapeau éteint : toutes les suites existantes vertes, rien de visible ne change (barre comprise).
- Drapeau allumé : `seq-v2-suivi` vert ; l'écran est accessible par la barre, Ctrl J et « G puis S ».

Risques.
- Place de la rangée basse sur téléphone (cinq liens plus l'Aide) : vérifiée en recette visuelle à 360 px.
- Pagination du Journal : curseur testé sur 600 exécutions semées.

### 5d-1. Aperçu réel par `preview_values` (M)

Objectif. Un aperçu qui suit la règle du moteur (prénom fiable, découpage du titre LinkedIn, alias `city`/`ville`, retrait des variables vides), utilisé tout de suite dans « Relire les messages » à la place de `resolveVariables`, puis par l'éditeur (5d-2) et Contacter (5f-2). Sans drapeau : c'est une correction de l'aperçu actuel.

Appels serveur. Nouvelle fonction `draft-sequence`, une seule action pour l'instant, `preview_values`.
- Entrée : `organization_id`, `mission_id` facultatif, puis au plus 20 candidats en tout :
  - `enrollment_ids` : inscriptions lues avec le jeton de l'appelant, donc sous sa RLS ; expéditeur de chaque inscription ;
  - ou `profiles` : champs que le navigateur affiche déjà (nom, titre, poste, entreprise, URL, degré de relation), pour un candidat pas encore inscrit ; expéditeur : le compte LinkedIn de l'appelant, vérifié comme à l'inscription.
- Contrôles : `requireAuth`, `verifyOrgMembership`, mission lue dans l'organisation ; 21 candidats refusés ; candidat effacé exclu (registre RGPD ; registre illisible : pas d'aperçu, raison rendue).
- Contexte construit avec le client admin, une fois l'organisation vérifiée, exactement comme le moteur : `buildSequenceContext` (prénom de l'expéditeur, `user_template_variables`, organisation, mission).
- Sortie : par candidat, les valeurs du contexte et la liste des données absentes. Gratuite ; n'écrit rien.
- Après relecture adverse : `keys` obligatoire (variables des textes de la séquence, 50 au plus, `templateKeys`) et seules ces variables sont rendues ; `sequence_id` facultatif (lu dans l'organisation, sinon `SEQUENCE_NOT_FOUND`). Les variables personnelles d'un expéditeur qui n'est pas l'appelant, et celles d'un expéditeur que la rotation multi-expéditeurs choisira à l'envoi (avec ses prénom, nom, signature et poste), ne sont jamais données : annoncées entre crochets dans `at_send`, gardées telles quelles dans une retouche. Une lecture en échec pendant la construction du contexte exclut le candidat (`preview_failed`, à réessayer). Erreurs : `{ error, error_code }`, comme les autres fonctions (`invokeEdgeFunction` recopie `error_code` dans `error.code`).
- Le navigateur rend le texte avec `renderTemplatePreview(texte, valeurs)`. Un jeu de référence commun (JSON) prouve que ce rendu donne le même texte que `interpolateAndStrip` (repli, variable vide, alias).

Écrans. `EnrollmentPreviewModal` rend les étapes écrites par `preview_values` (pages de 10 candidats), au lieu de `resolveVariables` (`useEnrollmentPreview.ts:258`). Retouches et aperçus IA inchangés. Pendant le chargement : squelette, jamais un texte faux.

Migration. Aucune.

Fichiers.
- Créés : `supabase/functions/draft-sequence/index.ts`, `supabase/functions/_shared/sequence-preview-values.ts` et son test Deno, `src/hooks/usePreviewValues.ts`, `tests/fixtures/template-render-cases.json`, `tests/c1/fonctions-config.test.mjs`, `e2e/api/seq-preview-values.spec.ts`.
- Modifiés : `supabase/config.toml` (`[functions.draft-sequence]`, `verify_jwt = false`), `useEnrollmentPreview.ts`, `EnrollmentPreviewModal.tsx`, CLAUDE.md (71 fonctions, `draft-sequence` sans secret nouveau).
- Retirés : `resolveVariables` si plus aucun appelant (grep dans la PR), sinon en 5j.

Tests à écrire.
- `sequence-preview-values.test.ts` (Deno) : contexte identique à celui du moteur pour une même inscription ; candidat effacé exclu.
- `tests/c1/fonctions-config.test.mjs` : chaque dossier de `supabase/functions` qui a un `index.ts` a sa section `[functions.<nom>]` avec `verify_jwt = false`, sauf `submit-application` (neutralisée, `verify_jwt = true`, déjà testée par `c1-fonctions.test.mjs`) ; aucune section orpheline.
- Parité du rendu : test Node sur `renderTemplatePreview` et test Deno sur `interpolateAndStrip`, même fichier de cas.
- `e2e/api/seq-preview-values.spec.ts` : autre organisation refusée ; inscription hors de la RLS absente ; candidat effacé absent ; 21 identifiants refusés ; aucun débit ; le texte rendu pour une inscription est celui que le moteur envoie (journal du faux LinkedIn).

Tests existants à adapter. Grep : `grep -rln "resolveVariables\|useEnrollmentPreview" tests e2e`.
- `seq-audit-f4a` (`{{city}}` et `{{sender_name}}` dans l'aperçu), `f4-final`, `f4-final2`, `f4c`, `lot6c-preparation` ; `tests/c1/lot0c4-fiches` et `lot0c4-pipeline` (lecture de la note et `missionIdOfJob` dans le hook).
- e2e : `seq-ui-1` (préparation), `seq-identity` (flows) : textes d'aperçu attendus.

Recette locale ciblée : aperçu et envoi comparés sur trois candidats (prénom absent, titre « X chez Y », ville).

Critère de fin. Aperçus identiques aux envois sur la stack locale ; `config.toml` contrôlé par le test ; suites vertes.

Risques. Latence de l'aperçu : 20 candidats par appel, pages de 10, squelette pendant le chargement.

### 5d-2. Éditeur unique (G)

Objectif. Un seul parcours d'édition (décision 2), derrière le drapeau.

Écrans et comportements. L'onglet « Étapes » devient l'éditeur.
- Le fil : liste `<ol>`, une liste imbriquée par branche, une carte par étape.
- Palette « Ajouter une étape » : onglets « Actions LinkedIn » et « Conditions et attentes » ; une entrée impossible à cet endroit reste visible, grisée, avec sa raison (`isStepAllowedAt`).
- Panneau d'étape, à droite :
  - versions A, B et C ;
  - « Je rédige » ou « L'IA rédige pour chaque candidat ». Cette seconde option porte toujours : « Chaque message sera généré et relu avant l'inscription. Un message non relu ne part pas. » Elle n'est proposée qu'avec la relecture par inscrit de 5a-2 (décision 5) ;
  - champs selon le type d'étape ;
  - « Plus d'options » : Délai, Créneau d'envoi, Faire cette étape seulement si, Après cette étape, Répartition A/B.
- Variables : puces en français qui écrivent les clés du moteur ; texte de secours ; variable inconnue signalée.
- Aperçu réel sous le message, par `preview_values` (5d-1) :
  - candidats dans l'ordre : inscrits, puis Retenus de la mission, puis l'exemple ;
  - ‹ › pour passer de l'un à l'autre ; donnée absente surlignée ; compteur de 300 caractères pour une note d'invitation ;
  - étape IA : « Rédigé et relu pour chaque candidat avant l'inscription. » et le modèle comme structure.
- Barre de vérification collante ; `validateSequence` reste la seule règle.
- Enregistrement :
  - explicite, par le bouton ou Ctrl/Cmd+S ; brouillon local (`editorDraft`) ;
  - fenêtres « Enregistrer malgré ces points ? » et « Quitter sans enregistrer ? » ;
  - bandeau quand des candidats sont inscrits ;
  - aucune restriction nouvelle sur le réordonnancement (les règles existantes, dont `STEP_HAS_HISTORY`, s'appliquent).
- Création : `/sequences/nouvelle?mission=<id>&depart=zero|modele:<clé>|copie:<id>`. Rien n'est écrit avant « Enregistrer ». `NewSequenceDialog` et `TemplatesGallery` remplacent `SequenceTemplateSelector` sous drapeau.
- Séquences existantes : le `check_connection` à deux branches, les variantes, les replis au délai dépassé et la fin de séquence restent lisibles et modifiables. Les types fermés (e-mail, WhatsApp, branchement, attente de visite) ne sont pas proposés à l'ajout, mais restent signalés là où ils existent.
- Drapeau allumé : « Modifier les étapes » ouvre l'éditeur unique. Éteint : `SequenceBuilder` reste.

Appels serveur. `preview_values` (5d-1) ; écriture par `save_sequence_steps`, via `useSequenceSave` (5c-1).

Migration. Aucune.

Fichiers.
- Créés : `src/components/sequences/editor/` (`SequenceFlow`, `StepCard`, `DelayPill`, `BranchColumns`, `AddStepButton`, `AddStepPalette`, `EndMarker`, `StepPanel`, `MessageEditor`, `VariableMenu`, `MessagePreview`, `ValidationBar`), `NewSequenceDialog`, `TemplatesGallery`, `src/lib/sequenceVariables.ts`.
- Modifiés : `sequenceGraph.ts` (`isStepAllowedAt`), `SequenceDetailPage.tsx`, `SequencesPage.tsx`.
- Retirés : aucun.

Tests à écrire.
- `tests/ux/seq-v2-editeur.test.mjs` :
  - aucun import de `@xyflow/react` sous `src/components/sequences` ;
  - `validateSequence` seule règle ; enregistrement par `useSequenceSave` ;
  - les puces écrivent les clés de `SEQUENCE_TEMPLATE_KEYS` ;
  - valeurs d'aperçu jamais écrites en stockage local ;
  - « Guidé », « Expert », « Liste » et « Visuel » absents ;
  - l'option IA porte toujours la phrase de relecture.
- `tests/ux/seq-v2-charge-utile.test.mjs` : pour chaque type d'étape et pour la Séquence recommandée, charge envoyée à `save_sequence_steps` identique à celle de `SequenceBuilder` (jeux de référence) ; aller-retour par `rowToSequenceStep` sans perte.
- `e2e/flows/seq-v2-editeur.spec.ts` : créer de zéro ; invitation puis attente, branche « Connecté / Non connecté », version B ; variable inconnue bloquante ; enregistrer puis rouvrir ; aperçu sur un Retenu ; refus `STEP_HAS_HISTORY` ; modification concurrente refusée.

Tests existants à adapter. Aucun : l'ancien éditeur reste.

Critère de fin. Drapeau allumé : chaque forme de séquence des données de test s'ouvre, se modifie et s'enregistre sans perte ; charges identiques. Drapeau éteint : rien ne change.

Risques. Champs perdus à l'aller-retour (cc, signature, délais dépassés, poids A/B) : jeux de référence. Lisibilité d'une séquence de 17 étapes : recette visuelle.

### 5e. Rédaction par l'assistant (G)

Objectif. L'aspect agent. L'assistant rédige la séquence de la mission à partir du poste, à la demande, jamais en tâche de fond (décision 13). Une personne relit, enregistre, puis inscrit par un geste distinct.

Écrans et comportements (sous drapeau).
- Quatre portes, une seule rédaction :
  1. état vide de l'onglet Séquences du panneau : « Rédiger une séquence pour cette mission » ;
  2. « Rédiger avec l'IA à partir du poste », marqué « Recommandé », dans « Nouvelle séquence » ;
  3. « + Rédiger une séquence pour cette mission » dans le menu de Contacter (branchée en 5f-2, retour à Contacter, sélection intacte) ;
  4. la conversation de l'assistant, par `create_sequence`.
- Écran « Le poste » : arguments retirables, « + Ajouter un argument », « Vos messages » repris du Cadrage, nombre de relances (1 à 3), premier contact par invitation (défaut) ou par InMail, coût « environ 7 crédits », « Rien ne part avant que vous inscriviez des candidats. »
- Écran « L'angle » : trois angles fixes, calculés sans IA, dont un « Recommandé », chacun avec son « Pourquoi ».
- Résultat : `/sequences/nouvelle?depart=ia` s'ouvre sur « Étapes », remplie et non enregistrée ; bandeau « Rédigée par l'IA Konekt à partir du poste : relisez chaque message sur un vrai candidat, puis enregistrez. Rien ne part avant l'inscription. » [Rédiger à nouveau] ; une étape signalée porte son avertissement ; une étape dont le texte a été retiré affiche « À rédiger » et bloque l'enregistrement.
- « Demander à l'IA » dans le panneau d'étape : Raccourcir, Plus direct, Plus chaleureux, Ajouter une accroche sur le parcours, Corriger l'orthographe, Rédiger à partir du poste ; résultat dans « Proposition de l'IA » avec [Remplacer], [Garder ma version] et le coût.
- Formule gratuite (décision 6) : portes ouvertes, dans la limite des crédits. À l'enregistrement, la séquence est créée désactivée (règle existante `createInactiveForPlan`), avec « Votre formule permet de préparer cette séquence. L'envoi automatique fait partie des formules payantes. » [Voir les offres].
- Poste non décrit (`canScoreProfiles`) : porte désactivée, « Décrivez d'abord le poste dans le Cadrage pour que l'IA puisse rédiger. » [Décrire le poste].
- Erreurs : textes de spec-cible 2.6.

Appels serveur.
- `_shared/sequence-draft.ts` :
  - `pickBriefFacts` : liste fermée des champs du poste ; jamais la rémunération, les critères internes, les profils de calibration, le brief brut, les contacts du manager ni les entreprises cibles ; alias à la place d'un client anonymisé ;
  - `buildDraftSkeleton` : forme fixée par le serveur (variante invitation : visite facultative, invitation, attente de connexion de 14 jours, messages « Si connecté » à 0, 4 et 7 jours ; variante InMail), `use_ai_personalization` toujours faux ;
  - `parseDraftResponse`, `fillSkeleton` ;
  - `checkDraftTexts` : rémunération (`detectSequenceViolations`), noms de prestataires, « Notion », liens, « Konekt » hors nom de l'organisation, variables hors liste et `{{client}}`, longueurs, formulations discriminatoires signalées.
- `draft-sequence`, deux actions de plus :
  - `prepare`, gratuite ;
  - `draft`, payante : `assertCredits` (402), appel par `call-claude.ts` (modèle par `getAnthropicModelId`, `fetchWithTimeout` à 30 s), une correction au plus s'il reste 30 s, `settleCredits`. Aucune garde d'offre (décision 6). N'écrit rien d'autre que le débit.
- Crédits : clé `sequence_draft` dans `_shared/ai-config.ts` et `src/types/aiCredits.ts`, plancher 3, environ 7 000 jetons.
- `text-action` : trois actions de plus (raccourcir, accroche, correction). Dans le contexte séquence (`context: 'sequence'`), les sorties passent par `checkDraftTexts` et le vouvoiement est imposé : le ton `casual` (tutoiement, `text-action/index.ts:451`) est refusé.
- `create_sequence`, réaligné, sans drapeau :
  - jamais automatique : `NEVER_AUTO_TOOLS`, et `autoEligible: false` à l'écran (`AgentPoliciesSettings.tsx`, l. 61) ;
  - entrée réduite (`mission_id`, `first_contact`, `relances`, `profile_visit`, textes) ; étapes par `buildDraftSkeleton` puis `fillSkeleton` ; refus par `checkDraftTexts`, raison rendue au modèle ;
  - écriture par `save_sequence_steps` (accordée à `service_role`) ; en gratuit, créée désactivée comme aujourd'hui ;
  - carte d'approbation : textes entiers, plus « Ouvrir la séquence », qui ouvre l'éditeur rempli et non enregistré et rejette la proposition avec la note « Reprise dans l'éditeur ».
- Consigne de l'assistant (`search-agent-chat`) mise à jour.

Migration. Aucune : le brouillon vit dans l'éditeur ; le débit dans `ai_credit_transactions`, avec l'identifiant de la mission dans la description.

Fichiers.
- Créés : `_shared/sequence-draft.ts` et son test Deno ; `src/components/sequences/ai/` (`AIDraftWizard`, `AskAIMenu`, `AIProposal`).
- Modifiés : `draft-sequence/index.ts`, `text-action/index.ts`, `agent-tools-mutations.ts` (`create_sequence`), `agent-tools.ts`, `AgentPoliciesSettings.tsx`, `AgentToolApprovalCard.tsx`, `search-agent-chat/index.ts`, les deux catalogues de crédits, CLAUDE.md (clé de crédits).
- Retirés : l'écriture directe de `sequence_steps` par `create_sequence`.

Tests à écrire.
- `_shared/sequence-draft.test.ts` (Deno, sans réseau) : liste fermée et anonymisation ; forme pour chaque combinaison ; réponse invalide ; chaque contrôle réagit quand il le faut, et pas sur « senior » ni « 5 ans d'expérience ».
- `tests/c1/lot5e-redaction.test.mjs` : ordre `assertCredits`, appel, `settleCredits` dans `draft` ; aucune écriture sur les tables de séquence, d'inscription, d'exécution, `inmail_queue` ni `job_candidate_status` ; aucun import d'`unipile` ; `create_sequence` par la forme commune et `save_sequence_steps`, dans `NEVER_AUTO_TOOLS` ; carte sans troncature ; `text-action` passe ses sorties de séquence par `checkDraftTexts`.
- `e2e/api/seq-draft.spec.ts` : gratuit avec crédits, 200, un débit, aucune ligne de séquence ; crédits à 0, 402 sans appel au faux modèle ; autre organisation, 404 ; payant, 200 ; rémunération citée par le faux modèle, étape « À rédiger » et débit ; `prepare` sans débit.
- `e2e/api/seq-draft-skeleton.spec.ts` (moteur, faux LinkedIn) : accepte puis relances, arrêt à la réponse ; n'accepte jamais, fin à 14 jours sans échec ni pause automatique ; déjà en relation, invitation sautée.
- `e2e/flows/seq-v2-redaction.spec.ts` : porte du panneau, « Le poste », « L'angle », Étapes non enregistrées, aperçu réel, « Enregistrer », séquence en base sans inscription ; en gratuit, séquence enregistrée désactivée.

Tests existants à adapter. Grep : `grep -rln "create_sequence\|text-action\|ai-config\|aiCredits" tests e2e`.
- `tests/ux/lot1-paiement-credits.test.mjs` (parité, nouvelle clé, `text-action`) ;
- `tests/ux/seq-audit-b5.test.mjs`, `seq-audit-b5-final.test.mjs` (blocs de `create_sequence`) ;
- `e2e/api/seq-assistant.spec.ts`, `seq-decisions-assistant.spec.ts` (`create_sequence`).

Recette locale ciblée sur le moteur, avec la forme rédigée et le faux modèle de `vendor-mock.mjs`.

Critère de fin. Les e2e verts ; dans `src/` et `supabase/functions/`, seule la RPC écrit `sequence_steps` ; une rédaction réelle sur cinq postes de test ne déclenche aucun contrôle bloquant.

Risques. Qualité des textes : relecture humaine imposée, « Rédiger à nouveau ». Coût affiché avant l'appel. Limite de 60 s : une seule correction. Usage gratuit : borné par les crédits.

### 5f-1. Extraction de l'inscription (M)

Objectif. Un seul chemin d'écriture des inscriptions côté navigateur, extrait des deux fenêtres actuelles, sans écran nouveau ni changement de comportement.

Contenu. `src/lib/enrollCandidates.ts` reprend tout ce que font `SequenceEnrollModal` (l. 380-520) et `EnrollmentPreviewModal` (`handleEnroll`, l. 546-810) :
- compatibilité avec le réseau ;
- anti-doublon de 90 jours (`find_recent_org_contacts`), bloquant si la vérification échoue ;
- compte d'envoi strictement celui de l'utilisateur ;
- insertion groupée, avec repli candidat par candidat sur `ENROLLMENT_GDPR_ERASED` et `ENROLLMENT_SAME_PERSON_IN_SEQUENCE` ;
- retouches et réglages par étape dans `tracking_data` (`message_overrides`, `step_config_overrides`) ;
- première exécution par `pickFirstStep`, inscription retirée si elle ne peut pas être planifiée ;
- `provider_id`, `email_used`, `phone_used` posés ; `job_id` sans « project: » ;
- aucune écriture dans le Pipeline (« Contacté » reste au serveur).

Les deux fenêtres l'appellent dans la même PR.

Migration. Aucune.

Fichiers. Créé : `src/lib/enrollCandidates.ts`, `tests/c1/lot5f-inscription.test.mjs`. Modifiés : `SequenceEnrollModal.tsx`, `EnrollmentPreviewModal.tsx`, `enrollment-preview/enrollmentHelpers.ts` si besoin. Retirée : la logique en double.

Tests à écrire. `tests/c1/lot5f-inscription.test.mjs` : un seul écrivain navigateur de `sequence_enrollments` (insert et upsert) ; aucun « Contacté » écrit ; aucune écriture d'exécution autre que la première étape.

Tests existants à adapter. Grep : `grep -rln "SequenceEnrollModal\|EnrollmentPreviewModal\|enrollmentHelpers\|handleEnroll" tests e2e`.
- `tests/c1/lot0b-ecrivains` (`enrollmentHelpers.ts` sans `job_candidate_status`, liste des écrivains), `lot0c-socle-ecrans`, `lot0c4-fiches`, `lot0c4-pipeline` ;
- `tests/ux/seq-audit-f4a`, `f4b`, `f4c`, `f4-final`, `f4-final2`, `lot6c-preparation`, `lot1-sequences`, `seq-audit-f5` (l. 90), `lot6b-sequences` ;
- e2e à rejouer : `seq-identity` (flows), `seq-last-enroll-batch`, `seq-ui-1`, `seq-ui-2` (Sourcing et menu Séquence), `seq-decisions-ui` (refus RGPD et même personne), `seq-ai-review`.

Recette locale complète : l'extraction touche le cœur des envois.

Critère de fin. Suites `e2e/api/seq-*` et specs d'inscription vertes ; recette : un envoi par candidat, aucun pour un exclu ; diff sans changement de logique.

Risques. Cœur des envois réels. Parades : bascule des deux fenêtres dans la même PR, aucune autre modification, recette complète.

### 5f-2. Contacter : panneau Prise de contact définitif (G)

Objectif. « Contacter » depuis toute sélection, séquence de la mission choisie d'avance, aperçu, case, « Inscrire N candidats » (décision 4, conception 5.3). Sous drapeau, sauf la règle Retenu.

Règle Retenu à l'inscription (sans drapeau, tous les appelants d'`enrollCandidates`).
- Une inscription réussie fait passer en Retenu un candidat À trier ou Écarté.
- Comme `handleShortlist` (`EnrollmentPreviewModal.tsx:818-909`) : ligne À trier créée si le profil n'en a pas dans la mission, lecture des lignes sous les deux formes de `job_id`, puis `setCandidateStages(ids, 'retained')`, origine `user`, `p_from_stages` to_sort et rejected, surface `enrollment`. Aucun site d'upsert nouveau hors de ce chemin.
- « Contacté » reste posé par le serveur au premier envoi.

Panneau `?panneau=contact&outreach=contactes|sequences` (drapeau allumé).
- Deux onglets, « Contactés » et « Séquences ». « Contactés » s'ouvre par défaut s'il a une ligne (mesures du 24/09, conséquences 10 et 11).
- Repères gardés : `data-panel="contact"` et le titre « Prise de contact ».
- « Contactés » : une ligne par candidat (dernière inscription de la mission, plus les Contacté hors séquence) ; groupes A répondu, Bloqués (dont message à relire), En attente, Sans suite (replié) ; visage sur chaque ligne ; menu : gestes de 5b, « Marquer comme ayant répondu », « Ouvrir la fiche ».
- « Séquences » : la séquence de la mission (`missionSequencePick`), les autres séquences de la mission, puis les partagées qui portent des candidats de la mission ; « + Créer une séquence », « Toutes les séquences de l'organisation » ; « Envoyer les actions du jour », limité à la mission.
- Bouton « Prise de contact » de `PipelineToolbar` : pastille « 2 réponses », « 1 bloqué », jamais de zéro.

ContactFlow, le mode Contacter, ouvert sans menu intermédiaire :
- par « Contacter » : barre d'actions du Pipeline et du Sourcing, fiche d'un Retenu, « Contacter les N » de Maintenant ;
- par « Inscrire des candidats » de la page séquence, à droite ;
- hors mission (`/sourcing/:id` : `SearchResultsPanel`, `CardActions`, `ProfileDetailSheet`) et depuis la messagerie (`MessagesInbox`), en panneau latéral avec les séquences de l'organisation.

Contenu de ContactFlow, de haut en bas :
1. La séquence, choisie d'avance ; menu « Séquences de la mission », « Autres séquences de l'organisation » (partagées comprises), « + Rédiger » (porte de 5e) ; phrase sur le compte d'envoi et la première action.
2. Les candidats : « 2 prêts · 1 à compléter · 2 exclus », chaque groupe avec sa raison exacte et sa dérogation. Le groupe s'appelle « Exclus » ; un exclu porte le nom de qui l'a contacté (S9).
3. L'aperçu du premier message par `preview_values`, note ou message selon la relation, ‹ › et compteur ; « Personnaliser pour Hervé », « Relire tous les messages ».
4. La jauge du plafond.
5. Le pied : `RecipientsConfirm` (seuil de 5, case de relecture IA de 5a-2), puis « Inscrire N candidats ».

Après le clic : le panneau passe sur « Contactés » ; toast sans « Annuler » (un premier envoi peut être parti, l'inscription compte pour l'anti-doublon), avec [Ouvrir la séquence].

« Relire les messages » ouvre `EnrollmentPreviewModal` sur la même sélection ; « Présélectionner sans message » y devient « Retenir sans contacter » (sous drapeau).

États vides et erreurs : textes de spec-cible, section 4.

Appels serveur. `enrollCandidates` (5f-1) ; `setCandidateStages` ; lectures existantes (`sequence_enrollments` par `job_id`, `mission_candidate_rows`).

Migration. Aucune.

Fichiers.
- Créés : `src/components/sequences/contact/` (`ContactFlow`, `RecipientGroups`, `FirstMessagePreview`, `QuotaGauge`, `ContactedList`), `src/lib/missionSequencePick.ts`.
- Modifiés :
  - `src/lib/enrollCandidates.ts` (règle Retenu) ;
  - dans `v3/` : `panels/ContactPanel.tsx`, `types.ts` (sélection dans `ContactPanelProps`), `MissionWorkspaceV3.tsx` (sélection gardée, `&contacter=1`), `pipeline/ContactSelectionButton.tsx`, `PipelineToolbar.tsx`, `PipelineScreen.tsx`, `panels/CandidatePanel.tsx`, `sourcing/SourcingResultsV3.tsx` ;
  - `outreach/search/SearchResultsPanel.tsx`, `result-card/CardActions.tsx`, `result-card/ProfileDetailSheet.tsx`, `outreach/MessagesInbox.tsx` (sous drapeau ; `SequenceEnrollButton` et `SequenceEnrollModal` restent drapeau éteint) ;
  - `EnrollmentPreviewModal.tsx` (libellé sous drapeau), `src/lib/missionBeta.ts`.
- Retirés : aucun (les anciens chemins restent drapeau éteint jusqu'à 5j).

Tests à écrire.
- `tests/ux/seq-v2-contacter.test.mjs` : seuil compté sur le nombre du bouton ; groupe « Exclus » ; aucun nom de prestataire ; pastille sans zéro ; les cinq points d'entrée hors panneau ouvrent ContactFlow drapeau allumé.
- `tests/c1/lot5f-retenu.test.mjs` : Retenu par `setCandidateStages`, origine `user`, `p_from_stages` to_sort et rejected ; aucun « Contacté » écrit.
- `e2e/flows/seq-v2-contacter.spec.ts` : Pipeline, Contacter, séquence choisie d'avance, aperçu ; 4 candidats sans case, 5 avec ; Contactés ; passage du moteur, un seul envoi par candidat ; doublon de 90 jours qui nomme le collègue ; compte déconnecté, séquence en pause ; hors mission et messagerie ; un À trier inscrit passe Retenu.

Tests existants à adapter. Grep : `grep -rln "ContactPanel\|ContactSelectionButton\|SequenceEnrollButton\|SourcingResultsV3\|SearchResultsPanel\|CardActions\|ProfileDetailSheet\|MessagesInbox\|handleShortlist" tests e2e`.
- `tests/c1/lot3-ecrans.test.mjs`, l. 114-116 (le panneau reçoit la sélection, sous drapeau) ;
- `tests/c1/lot0b-ecrivains.test.mjs`, l. 361-376 et liste blanche : Retenu autorisé dans `enrollCandidates`, « Contacté » toujours interdit ;
- `tests/c1/lot12-mission-v3`, `lot0c-socle-ecrans`, `lot0c4-fiches`, `lot0c4-pipeline` ;
- `tests/ux/lot12-panneaux` (l. 287-292, drapeau éteint inchangé), `fondations-simplicite` (l. 144-152), `lot12-coquille` (l. 185), `lot12-pipeline`, `lot12-sourcing` (l. 543-545), `seq-audit-f4b`, `lot1-sequences`, `lot6a-messagerie` ;
- e2e inchangés drapeau éteint : `seq-identity`, `seq-last-enroll-batch`, `seq-decisions-ui`, `mission-v3` (l. 704-708).

Recette locale complète, drapeau éteint et allumé.

Critère de fin. `seq-v2-contacter` et suites `e2e/api/seq-*` vertes ; anciennes specs d'inscription vertes drapeau éteint ; la recette prouve un envoi par candidat et aucun envoi pour un exclu.

Risques. Conflit avec le lot 4 sur `SourcingResultsV3`. Sélection de 400 retenus : aperçu par pages de 10, anti-doublon par lots. La règle Retenu change le Pipeline pour tous dès le merge : voulu (choix par défaut), recetté sur les deux fenêtres.

### 5f-3. Invitations dans la messagerie (P)

Objectif. Les invitations LinkedIn reçues quittent le panneau de mission pour la messagerie (conception, lot 5).

Comportements.
- Onglet « Invitations » (`InvitationsPanel`) dans `/inbox`, pour tous, sans drapeau. Les comptes viennent de la page (`Inbox.tsx:76`).
- Drapeau allumé : le panneau Prise de contact n'a plus cet onglet ; `?outreach=invitations` mène à `/inbox?onglet=invitations`.
- Drapeau éteint : le panneau provisoire garde son onglet.

Migration. Aucune.

Fichiers. Modifiés : `src/pages/Inbox.tsx`, `outreach/MessagesInbox.tsx` si l'onglet y vit, `v3/panels/ContactPanel.tsx`, `src/lib/missionBeta.ts`.

Tests. À écrire : `tests/ux/lot5f3-invitations.test.mjs` (onglet dans la messagerie, redirection drapeau allumé) ; un cas dans `seq-v2-contacter.spec.ts` (onglet de la messagerie). À adapter : `lot12-panneaux` (drapeau éteint inchangé), `lot6a-messagerie`, `barre-lot6-a-traiter` (lecteurs de `Inbox.tsx`).

Critère de fin. Invitations acceptées et refusées depuis la messagerie sur la stack locale ; panneau inchangé drapeau éteint.

Risques. Faibles.

### 5g. Un par un, formule gratuite (M)

Objectif. Décision 2 du 27/09. En formule gratuite, « Contacter » mène à l'écriture candidat par candidat, et non plus à un mur. Au 24/09, les 17 organisations sur 17 étaient en gratuit.

Écrans et comportements.
- Quand `hasPlanFeature(planId, 'sequences_send')` est faux, ContactFlow affiche `OneByOnePanel` : « Écrire à Hervé Dumas, 1 sur 2 ».
- Message tiré de la première étape de la séquence de la mission, rendu par `preview_values`, ou de « Demander à l'IA » (permis en gratuit dans la limite des crédits, décision 6), coût annoncé. Il reste modifiable. Boutons [Passer] et [Envoyer].
- Sans relation : note d'invitation de 300 caractères au plus. En relation : message.
- Chaque envoi est un clic sur « Envoyer », après lecture. Pas d'annulation d'envoi, pas d'enchaînement automatique.
- Avant l'envoi, l'écran annonce : un contact de l'organisation dans les 90 jours (exclusion, ou confirmation S9 « Contacté par Julie Garnier le 12/09 ») ; un candidat effacé ; un plafond atteint.
- Annonce une fois par personne : « Votre formule permet de préparer des séquences et d'écrire aux candidats un par un. L'envoi automatique, avec les relances, fait partie des formules payantes. » [Voir les offres] [Compris].
- Rang 7 en gratuit : « Écrire à Laure Michel (1 sur 4) » au lieu de « Voir les retenus » (`evalRetained`, `rowNextAction`).
- Cadre « un par un » : celui du lot 4 s'il est livré.

Appels serveur.
- Message : `unipile-search` `send_message`, qui porte déjà `project_id`, pose le marqueur et appelle `record_candidate_outbound`. Le refus d'un candidat effacé vaut pour tous les appelants depuis le correctif 4. Nouvelle option `contact_checks`, employée par ce mode : anti-doublon de 90 jours sauf `confirm_recent_contact`, et plafond.
- Invitation : action nouvelle `send_invitation` de `unipile-search`, note de 300 caractères au plus ; mêmes contrôles ; marqueur avant le POST, puis `record_candidate_outbound` ; compteur du plafond LinkedIn ; un envoi incertain (5xx, délai) n'est pas enregistré.

Migration. Aucune.

Fichiers. Créés : `src/components/sequences/contact/OneByOnePanel.tsx`, `e2e/api/seq-un-par-un.spec.ts`. Modifiés : `unipile-search/index.ts`, `ContactFlow`, `src/lib/missionNextAction.ts`, `useMissionNow.ts`, CLAUDE.md (action `send_invitation`).

Tests à écrire.
- `e2e/api/seq-un-par-un.spec.ts` : marqueur et « Contacté » posé par le serveur ; refus à 90 jours sans confirmation, envoi avec ; plafond atteint ; 5xx non enregistré ; journal du faux prestataire.
- `e2e/flows/seq-v2-un-par-un.spec.ts`, organisation gratuite : « 1 sur 2 », Envoyer, Passer, Contacté dans le Pipeline, aucune séquence activée.
- `tests/c1/lot5g-un-par-un.test.mjs` : chaque envoi derrière un clic, aucun envoi dans un effet ou un minuteur, aucun nom de prestataire.

Tests existants à adapter. `tests/ux/lot3-maintenant.test.mjs`, `tests/c1/lot3-ecrans.test.mjs`, `lot3-regle.test.mjs` (rang 7 en gratuit) ; `e2e/flows/mission-now.spec.ts`, l. 331-377.

Recette locale complète.

Critère de fin. Une organisation gratuite contacte 2 retenus en 4 clics au plus par candidat ; la recette prouve deux envois et zéro envoi pour un candidat effacé.

Risques. Plafond hebdomadaire des invitations. Deux chemins d'envoi manuel (fiche et un par un) : même fonction serveur. Coordination avec le lot 4.

### 5h. Bascule (M)

Objectif. Ouvrir le nouveau parcours à tous, avec un secours.

Comportements.
- Drapeau allumé par défaut ; `?sequences-v2=0` ou la clé à « 0 » rend l'ancien parcours jusqu'à 5j.
- Entrée « Séquences » de la barre latérale visible pour tous.
- Adresses :
  - `/outreach` mène à `/sequences` ;
  - les notifications d'une séquence sans mission mènent à `/sequences` au lieu de `/missions` (`process-sequences/index.ts:3417`, `unipile-webhook/index.ts:174, 2546, 2724`) ; `src/lib/notificationKinds.ts` (inventaire des liens, l. 11-21) inscrit `/sequences` ;
  - `?tab=outreach` mène toujours au panneau.
- `SequencesList` (panneau provisoire et ancienne page `?nouvelle-mission=0`) : « Créer une séquence » mène à `/sequences/nouvelle?mission=<id>`, « Modifier » à `/sequences/:id?depuis=mission:<id>`, « Dupliquer » à la copie puis à sa page. « Enregistrer comme modèle » garde `SaveAsTemplateModal`. `MissionOutreach.tsx` n'est pas modifié (garde `LEGACY_FILES`).

Fichiers. `sequencesBeta.ts`, `App.tsx`, `SidebarBottomRow.tsx`, `process-sequences/index.ts`, `unipile-webhook/index.ts`, `src/lib/notificationKinds.ts`, `SequencesList.tsx`, CLAUDE.md (routes `/sequences` dans la carte du code, barre latérale).

Migration. Aucune.

Tests.
- À écrire : `tests/ux/lot5h-bascule.test.mjs` (défaut allumé, secours, redirections, liens des notifications, entrée de la barre pour tous, « Créer » et « Modifier » de `SequencesList` vers les pages).
- À adapter :
  - `tests/ux/notification-kinds.test.mjs`, `lot2-parametres-coquille`, `barre-lot6-a-traiter`, `seq-audit-f5` (lecteurs de `notificationKinds.ts`) ; `e2e/api/seq-final-conv-privacy.spec.ts` (à relire) ;
  - `barre-lot56-coquille` (cinq liens sans condition) ;
  - specs de l'ancienne interface épinglées sur `?sequences-v2=0` jusqu'à 5j : `sequences`, `sequences-builder`, `seq-editor-canvas`, `seq-steps-1`, `seq-ui-1`, `seq-ui-2`, `sequences-enrollments`, `seq-decisions-ui`, `seq-identity`, `seq-last-enroll-batch`, `seq-actions-2`, `seq-late-reply`, `seq-reply-paths`, `seq-decisions-reply`, `seq-final-inmail-ui`, `seq-ai-review` ;
  - `mission-v3.spec.ts` (l. 704-708, onglet par défaut).

Recette locale complète, `qa.md` sur les quatre personas. Puis une semaine de surveillance en production : Journal et échecs d'envoi, messages à relire en attente, `jcs_direct_write_log` (aucune écriture directe nouvelle), retours des utilisateurs.

Critère de fin. Le tableau de la section 3 est vérifié ligne à ligne : chaque fonction a son remplaçant accessible sans le secours.

Risques. Régression visible pour tous. Parades : `?sequences-v2=0`, et la remise en production du déploiement précédent sur Vercel.

### 5i. Rang 9 et « Relance auto » (P)

Objectif. La carte Maintenant surveille les relances du jour (conception 4.3), selon le choix par défaut.

Comportements.
- `missionNextAction.ts` : `'9'` sort de `UNMONITORED_RANKS`, la mention des relances sort de `unmonitoredLine`.
- Phrase : « 2 relances prévues aujourd'hui ne partiront pas sans vous : 1 à relire, 1 en pause. » [Voir les relances]. Le bouton ouvre Contactés sur le groupe Bloqués.
- Comptées : échec, pause, plafond, message rédigé par l'IA à relire (raison de 5a-2). Jamais une relance qui partira seule, ni une relance annulée par un rendez-vous.
- `rowNextAction`, pour un Contacté qui a une étape prévue : « Relance auto aujourd'hui à 14 h 20 » ou « Relance auto le 02/10 », en gris ; information, pas action.

Appels serveur. Aucun. `useMissionRelaunchesDue` lit sous RLS les exécutions du jour des inscriptions de la mission (`job_id`) sur le compte de la personne. Clé hors de `['sidebar', …]`.

Migration. Aucune. Si la lecture coûte trop cher, un champ de `get_mission_attention` demanderait une migration, dans un autre sous-lot.

Tests. À écrire : `tests/ux/lot5i-rang9.test.mjs` (module pur : relance seule jamais comptée ; échec, pause, plafond et « à relire » comptés ; annulée par un rendez-vous non comptée). À adapter : `tests/ux/lot3-maintenant.test.mjs`, `tests/c1/lot3-regle`, `lot3-ecrans`, `lot3-liste` (une seule règle), `e2e/flows/mission-now.spec.ts` (un cas de plus).

Critère de fin. Le rang 9 est surveillé. La carte ne dit toujours pas « Rien ne presse » : les rangs 1 et 2 attendent le lot 6.

Risques. Faibles. Lecture bornée à la journée et au compte.

### 5j. Retraits (M)

Objectif. Supprimer l'ancien parcours, une semaine au moins après 5h et sans incident bloquant.

Préconditions, recopiées dans la PR :
- pour chaque fichier retiré, `grep -rn "<nom du fichier>" src supabase` ne rend que des fichiers retirés dans la même PR ;
- pour chaque fichier retiré, `grep -rln "<nom>" tests e2e`, avec le sort de chaque test trouvé.

Retirés.
- La branche drapeau éteint partout, `sequencesBeta.ts` et `?sequences-v2`.
- `SequenceBuilder.tsx` : ses types vivent dans `src/types/sequence.ts` depuis 5c-1 ; `SequencesList` ne le monte plus depuis 5h.
- Sous `outreach/sequence/` : `VisualSequenceEditor.tsx`, `WorkflowCanvas.tsx`, `nodes/*`, `edges/*`, `StepEditor.tsx`, `SequenceWizardStepper.tsx`, `SequenceValidationChecklist.tsx`, `VariableInserter.tsx` (chacun après grep).
- `SequenceTemplateSelector.tsx` : `SaveAsTemplateModal` vit dans son fichier depuis 5c-1 ; « Créer » de `SequencesList` mène à la page depuis 5h.
- `SequenceEnrollButton.tsx` : `ContactSelectionButton`, `SourcingResultsV3`, `SearchResultsPanel`, `CardActions` et `ProfileDetailSheet` ouvrent ContactFlow depuis 5f-2.
- `SequenceEnrollModal.tsx` : `MessagesInbox` ouvre ContactFlow depuis 5f-2.
- `resolveVariables`, s'il reste.
- La dépendance `@xyflow/react` (`package.json:59`).
- La branche provisoire de `ContactPanel` (`SequencesList` et `InvitationsPanel` tels quels).

Gardés.
- `SequencesList` pour l'ancienne page, jusqu'aux lots de retrait de celle-ci.
- `SaveAsTemplateModal`, `EditScheduledMessageModal`.
- `sequenceGraph.ts`, `conditionTypes.ts`, `messageTypeUtils.ts`.
- `StopConditionsSettings`, `MultiSenderSettings`, `SequenceAnalytics`, `SequenceActivityLog`, `SequenceDiagnostic`.
- `EnrollmentPreviewModal` (« Relire les messages ») et `BulkInMailModal`.

Tests (grep du 05/10).
- Supprimés :
  - `seq-audit-f1a`, `f1b`, `f1d` (leurs tests de `sequenceGraph.ts` sont portés depuis 5c-1) ;
  - `e2e/flows/seq-editor-canvas.spec.ts`, `sequences-builder.spec.ts` ;
  - les cas Expert, Visuel et modèles de `seq-steps-1`, `seq-ui-1`, `seq-ui-2` (l. 850, 883, 984-996), `seq-decisions-ui` (l. 687).
- Adaptés, lecteurs des fichiers retirés :
  - `SequenceBuilder` : `lot1-sequences`, `lot3-parametres-retraits` (l. 119), `lot6b-sequences` (D-39, D-42), `seq-audit-f1c`, `seq-audit-f2c` ;
  - `StepEditor` : `lot3-parametres-retraits` ;
  - `SequenceTemplateSelector`, `SequenceWizardStepper`, `SequenceValidationChecklist` : `lot6b-sequences`, `seq-audit-f1c` ;
  - `SequenceEnrollButton` : `lot12-sourcing` (l. 543-545) ; `seq-audit-f4b` le lit au chargement (l. 69) et tombe en entier : ses cas d'anti-doublon, d'offre, de bilans et de messagerie sont portés sur `enrollCandidates` et ContactFlow avant la suppression ;
  - `SequenceEnrollModal` : `lot1-sequences`, `lot6b-sequences`, `lot6c-preparation`, `seq-audit-f4a`, `f4-final`, `f4-final2`, `seq-audit-f5` (l. 90), `e2e/flows/seq-identity` ;
  - branche provisoire et drapeau : `lot12-panneaux`, `fondations-simplicite`, `seq-v2-*`, `lot5h-bascule`.
- Portés sur les nouveaux écrans, épinglage retiré : `seq-late-reply`, `seq-reply-paths`, `seq-decisions-reply`, `seq-identity`, `seq-last-enroll-batch`, `seq-actions-2`, `seq-final-inmail-ui`, `seq-ai-review`, `sequences`.

CLAUDE.md. Carte du code (routes, parcours mission, composants, hooks) mise à jour.

Migration. Aucune.

Critère de fin.
- `grep -rn "SequenceBuilder\|WorkflowCanvas\|xyflow\|sequences-v2\|SequenceEnrollButton\|SequenceEnrollModal\|SequenceTemplateSelector" src e2e tests` ne rend rien.
- `tsc` sous la baseline, `vite build` passe, toutes les suites vertes.
- Les `e2e/api/seq-*` sont inchangés.

Risques. Volume de portage e2e, réduit puisque chaque sous-lot a écrit ses cas v2.

### 5k. Mesurer (M, détachable)

Objectif. Les chiffres de la maquette, sans conditionner ni l'envoi ni la validation.

Comportements.
- Onglet « Statistiques » d'une séquence : par étape et par version, « réponses après cette étape » ; arrêts manuels distingués des fins sans réponse.
- Un taux ne s'affiche qu'à partir de 5 contactés ; on écrit « aucune réponse », jamais « 0 ».
- Onglet « Statistiques » de `/sequences` : classement des séquences et résultats des modèles.

Fichiers. `src/lib/sequenceStepStats.ts`, `src/hooks/useSequenceStepStats.ts`, `StatsTab`.

Migration. Aucune. Agrégation dans le navigateur, bornée. Une fonction SQL ne deviendrait utile qu'au-delà d'environ 5 000 exécutions par séquence : hors lot.

Tests. `tests/ux/lot5k-mesures.test.mjs` (module pur), un cas de plus dans `seq-v2-suivi.spec.ts`.

Critère de fin. Chiffres par étape identiques à un calcul SQL de contrôle sur la base de test.

Risques. Faibles. Livrable à tout moment après 5c-2.

### Correctifs à livrer à part

1. Fuite du nom d'un client anonymisé (P, dès que possible, recette locale ciblée).
   - `{{client}}` reçoit toujours le vrai nom (`template-interpolation.ts:225-227`). Un modèle écrit à la main l'envoie au candidat, même quand l'anonymisation est demandée.
   - Correctif : l'alias remplace le nom quand `anonymize_client` est actif, dans le moteur et dans les aperçus.
   - Tests : test Deno, et un cas `e2e/api` qui lit le journal du faux prestataire.
2. Rémunération dans les aperçus de `generate-outreach-message` (P, avant 5a-2).
   - Un aperçu validé part tel quel, alors que le moteur interdit la rémunération.
   - Correctif : retirer ces champs du prompt, puis passer `detectSequenceViolations` sur l'aperçu.
3. `draft_outreach_message` (P, avec 5e) : il impose le tutoiement, n'a pas de règle sur la rémunération, et ne contrôle pas les crédits avant l'appel.
4. Envoi à un candidat effacé par la fiche et la messagerie (P, avant 5g, recette locale ciblée).
   - `unipile-search` `send_message` saute seulement l'écriture pour un candidat effacé (l. 1914-1920) : le message part.
   - Correctif : refus de l'envoi pour tout appelant (fiche, messagerie, fenêtre de message, assistant), registre illisible compris, avec un message en français.
   - Tests : un cas `e2e/api` (journal du faux LinkedIn vide, erreur rendue), garde statique.

---

## 3. Ce qui est retiré et quand

Règle : rien n'est retiré avant que son remplaçant soit ouvert à tous (5h) et ait tourné une semaine, sauf les écarts de sécurité, corrigés tout de suite.

| Élément | Remplaçant | Disponible | Pour tous | Retiré du code |
|---|---|---|---|---|
| Politique « auto » de `enroll_in_sequence` et `resume_sequence` | Approbation obligatoire | sans drapeau | 5a | 5a |
| Aperçu tronqué ou absent sur la carte d'inscription de l'assistant | Premier message entier, candidat relu dans la mission | sans drapeau | 5a | 5a |
| Inscription de 5 candidats ou plus, ou de 5 InMails, sans confirmation | Case « Je confirme les destinataires » et aperçu | sans drapeau | 5a | 5a |
| Message rédigé par l'IA à l'envoi, sans relecture | Relecture avant l'inscription, garde du moteur, « Relire le message » | sans drapeau | 5a-2 | 5a-2 (la rédaction reste dans le code, injoignable à l'envoi) |
| AlertDialog de pause d'un candidat et de pause groupée | Geste immédiat, « Annuler » 8 s | sans drapeau | 5b | 5b |
| AlertDialog « Désactiver cette séquence ? » | « Mettre en pause la séquence », « Annuler » 8 s | sans drapeau | 5b | 5b |
| Pas d'arrêt d'un candidat | « Arrêter pour ce candidat » (clôture `completed`, `manual_stop`) | sans drapeau | 5b | sans objet |
| Types exportés par `SequenceBuilder.tsx` | `src/types/sequence.ts` | 5c-1 | 5c-1 | réexport retiré en 5j |
| `SaveAsTemplateModal` dans `SequenceTemplateSelector.tsx` | Son propre fichier, gardé | 5c-1 | 5c-1 | gardé |
| Dupliquer, Enregistrer comme modèle, Supprimer dans le menu de `SequencesList` | Menu « … » de la page séquence ; `SequencesList` les garde pour l'ancienne page | 5c-2 | 5h | gardé dans `SequencesList` |
| Fenêtre Diagnostic, Journal et Statistiques dans la liste | Onglets de la page séquence, carte « État de l'envoi » | 5c-2 | 5h | 5j dans la nouvelle page ; gardés dans l'ancienne |
| Aucune entrée de navigation vers les séquences de l'organisation | Entrée « Séquences » de la barre latérale, Ctrl J, « G puis S » | 5c-2 | 5h | sans objet |
| `resolveVariables` (aperçu divergent) | `preview_values` | sans drapeau | 5d-1 | 5d-1 ou 5j |
| Modes Guidé et Expert | Éditeur unique | 5d-2 | 5h | 5j |
| Vue Visuel (canevas, `@xyflow/react`, nœuds, arêtes) | Fil vertical avec branches | 5d-2 | 5h | 5j |
| `StepEditor` (second éditeur d'étape) | Panneau d'étape | 5d-2 | 5h | 5j |
| Aperçu fictif « Marie Dupont » | Aperçu réel ; l'exemple en dernier recours | 5d-2 | 5h | 5j |
| `SequenceTemplateSelector` | `NewSequenceDialog`, `TemplatesGallery` ; « Créer » de `SequencesList` vers la page | 5d-2 | 5h | 5j |
| Écriture directe des étapes par `create_sequence` | `save_sequence_steps` | sans drapeau | 5e | 5e |
| Inscription en double dans les deux fenêtres | `enrollCandidates` | sans drapeau | 5f-1 | 5f-1 |
| Inscrit qui reste À trier jusqu'au premier envoi | Retenu à l'inscription | sans drapeau | 5f-2 | sans objet |
| `SequenceEnrollButton` (Pipeline, Sourcing v3, Sourcing hors mission, cartes, fiche de profil) | ContactFlow, séquence choisie d'avance | 5f-2 | 5h | 5j |
| `SequenceEnrollModal` (inscription simple, messagerie) | ContactFlow et `enrollCandidates` | 5f-2 | 5h | 5j |
| `EnrollmentPreviewModal` | Gardé, il devient « Relire les messages » | 5f-2 | 5h | gardé |
| « Présélectionner sans message » | « Retenir sans contacter » | 5f-2 | 5h | 5j |
| Contenu provisoire du panneau Prise de contact | Onglets Contactés et Séquences | 5f-2 | 5h | 5j |
| Onglet Invitations du panneau | Onglet Invitations de la messagerie | messagerie dès 5f-3, pour tous | 5h (panneau) | 5j |
| « Envoyer les actions du jour » limité à la mission | Gardé dans le panneau ; version organisation dans `/sequences` | 5c-2 | 5h | gardé |
| « Voir les retenus » en gratuit (rang 7) | « Écrire à X (1 sur N) » | 5g | 5h | 5h |
| `/outreach` vers `/missions` | `/outreach` vers `/sequences` | sans objet | 5h | 5h |
| Ancienne page et `MissionOutreach.tsx` (`?nouvelle-mission=0`) | Nouvelle page ; elle ouvre `/sequences/:id` pour modifier dès 5h | existe | existe | lots de retrait de l'ancienne page, hors lot 5 |
| `ProjectCandidatesTableEnhanced` et sa fenêtre de pause | Nouvelle page | existe | existe | même règle que l'ancienne page |
| Liens `?tab=outreach` (notifications stockées) | Redirection vers le panneau | sans objet | sans objet | jamais retirés |

---

## 4. Décisions et points tranchés

Décisions du fondateur appliquées : les huit de la section 1.2, avec les choix par défaut retenus. Aucun point ne reste ouvert pour démarrer.

Points que le plan tranche seul, sur la conception, `06-simplicite.md` ou les règles du dépôt, modifiables sans changer le découpage :
- onglet « Contactés » par défaut quand il a une ligne ;
- trois angles fixes pour la rédaction, sans appel à l'IA ;
- InMail proposé au choix pour le premier contact ;
- option « Commencer par vérifier la relation » retirée de la rédaction : le moteur saute déjà l'invitation d'une personne en relation ;
- bouton final « Inscrire N candidats » ; groupe « Exclus » dans Contacter ;
- jeton d'annulation d'un arrêt valable 2 minutes, toast fermé d'office à 1 min 50 s ;
- étape IA non relue reportée d'une heure à chaque passage ;
- relecture après l'inscription par `final_message` (Journal), sans réécriture de `tracking_data` ;
- carte d'approbation : candidat absent de la mission annoncé, sans refus nouveau ;
- entrée « Séquences » placée entre Agenda et Marketplace.

---

## Annexe A. Traitement de la relecture adverse

Points bloquants :
1. Arrêt non compté par l'anti-doublon : l'arrêt clôt en `completed` avec `completion_reason = 'manual_stop'`, compté 90 jours partout sans migration ni liste à changer ; cas e2e qui le prouve (5b).
2. Messages IA partis sans relecture : sous-lot 5a-2 (garde du moteur qui reporte sans annuler, relecture obligatoire avant l'inscription, relecture après coup) ; l'outil de l'assistant refuse les séquences IA (5a) ; plus aucune phrase « au moment de l'envoi » ; option de l'éditeur liée à la relecture (5d-2).
3. 5j retirait des fichiers utilisés : types déplacés et `SaveAsTemplateModal` sorti en 5c-1 ; menu « … » avec Dupliquer, Enregistrer comme modèle et Supprimer en 5c-2 ; `SearchResultsPanel`, `CardActions`, `ProfileDetailSheet` et `MessagesInbox` passés à ContactFlow en 5f-2 ; « Créer », « Modifier » et « Dupliquer » de `SequencesList` rebranchés en 5h ; préconditions de grep en 5j ; tableau 3 complété.

Points importants :
4. Annulation d'un arrêt : passage serveur de `completed` à `paused`, puis `resumeOneEnrollment` (`planResume`), motif « Arrêt manuel » ; réponse détectée par le statut `replied`, `mission_conversations.last_inbound_at` et le `replied_at` des sœurs ; étape `sending` couverte par `schedule_next` ; contrôles RGPD, compte et séquence repris de la reprise (5b).
5. « Définitif » faux : aide « Vous pourrez le relancer plus tard », « Relancer la séquence » proposé après un arrêt (5b).
6. Fenêtre de 30 s contre toast au survol : jeton de 2 minutes, toast fermé d'office à 1 min 50 s (5b).
7. Listes de tests incomplètes : listes refaites par grep dans chaque sous-lot, dont tous les fichiers cités par la relecture ; règle du grep recopié dans chaque PR d'extraction ou de retrait (1.3).
8. `config.toml` absent pour `draft-sequence` : entrée `verify_jwt = false` en 5d-1, et test statique sur toutes les fonctions, `submit-application` exceptée (5d-1, règle en 1.3).
9. Gratuit tranché sans le fondateur : décision 6 appliquée (rédaction permise dans la limite des crédits, séquence enregistrée désactivée, envoi payant), y compris pour « Demander à l'IA » et `create_sequence` (5e, 5g).
10. InMail groupé hors case : case dès 5 et aperçu du premier InMail dans `BulkInMailModal`, en 5a (décision 7).
11. Sous-lots trop gros : 5c en 5c-1 et 5c-2, 5d en 5d-1 et 5d-2, 5f en 5f-1, 5f-2 et 5f-3 ; 5a passe en M, 5b en G ; l'extraction ne porte plus aucun écran nouveau.

Points mineurs :
12. Annulation de la pause de séquence : par les `enrollment_ids` rendus par la pause, jamais par séquence et raisons (5b).
13. `skip_reason` en anglais : « Arrêt manuel », lisible et déjà réarmable (5b).
14. Écriture de `tracking_data` : conditionnelle sur `updated_at` avec un nouvel essai (5b) ; la relecture après inscription écrit `final_message`, jamais `tracking_data` (5a-2).
15. `preview_values` : inscriptions lues sous la RLS de l'appelant, contexte construit avec le client admin après vérification de l'organisation (5d-1).
16. Retenu à l'inscription : ligne créée comme `handleShortlist`, puis `setCandidateStages` ; liste blanche de `lot0b-ecrivains` mise à jour (5f-2).
17. `notificationKinds.ts` : ajouté à 5h, liens `/sequences` inscrits, tests lecteurs listés.
18. `first_step_preview` : candidat relu dans la mission, mêmes champs écrits à l'inscription ; une première étape IA ne se présente plus, l'outil refuse ces séquences (5a).
19. `text-action` : sorties de séquence passées par `checkDraftTexts`, vouvoiement imposé, ton `casual` refusé (5e).
20. Restriction de réordonnancement : retirée, aucune règle nouvelle (5d-2).
21. Envoi à un candidat effacé par d'autres appelants de `send_message` : correctif indépendant 4, avant 5g.
