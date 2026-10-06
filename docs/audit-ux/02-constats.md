# 02 — Registre des constats

Registre unique de l'audit UX. Un constat y entre avec une preuve, en sort avec un correctif et un test.

**Statut de vérification** (colonne « Vérifié ») :

- **oui** : relu sur `origin/main` au commit audité, le code fait bien ce que le constat décrit.
- **structurel** : le code établit la condition du défaut, mais l'effet visible n'a pas été observé dans l'application connectée.
- **à confirmer** : plausible, pas encore vérifié.

Le code audité est le commit `02155d27` du 8 septembre 2026, qui était la tête de `main` au moment de l'audit.

## Origine

Deux passes ont produit ce registre :

1. Un audit externe du 9 septembre 2026 (20 constats, UX01 à UX20).
2. Une contre-vérification Claude du 9 septembre 2026, qui a relu le code de production pour chaque constat P1 et pour les constats les plus concrets.

La contre-vérification n'a infirmé aucun constat P1.

## Constats

| ID | Prio | Constat | Vérifié | Preuve | Lot |
|---|---|---|---|---|---|
| UX01 | P1 ✅ | « Shortlister » écrit le statut `discovered`, alors que le filtre Shortlist cherche `shortlisted` | oui | `LinkedInSearch.tsx` handleBulkAddToProject, `useJobCandidateStatus.ts` batchDiscover, `useFilteredResults.ts` cas `shortlisted` | 1 |
| UX01b | P1 ✅ | Le même appel ignore les profils déjà connus et avale ses erreurs, sans jamais le dire | oui | `batchDiscover` filtre sur `statuses`, `ignoreDuplicates: true`, `return` silencieux sur erreur | 1 |
| UX02 | P1 ✅ | Les actions groupées résolvent les profils dans les résultats de recherche seuls, alors que la liste affichée y ajoute le vivier | oui | résolution via `search.results.find`, fusion via `mergedResults` | 1 |
| UX03 | P1 ✅ | Une sauvegarde qui ne renvoie aucune ligne est présentée comme réussie | oui | `useSourcingProjects.ts` : `maybeSingle()` puis `data \|\| { id, ...payload }` | 1 |
| UX04 | P1 ✅ | Le brouillon perd la dernière frappe à la sortie, et un texte effacé peut revenir | oui | nettoyage du minuteur sans enregistrement, garde `if (!newMessage) return` dans `MessageView` | 1 |
| UX05 | P1 ✅ | Choisir une séquence dans la messagerie inscrit le candidat immédiatement | oui | `MessagesInbox.tsx` : `onClick={() => inbox.enrollInSequence(sequence)}` | 1 |
| UX06 | P1 ✅ | Fermer un éditeur long peut effacer un travail non enregistré | oui | `CreateMissionV2.tsx` remettait les champs à vide 200 ms après la fermeture, `SequenceBuilder.tsx` perdait son état au démontage | 1 |
| UX07 | P1 ✅ | Le choix de séquence passe sous la conversation mobile | structurel | même composant : conversation `z-[2100]`, sélecteur `z-50`. Corrigé par le dialogue partagé, **reste à confirmer sur un vrai téléphone** | 1 |
| UX08 | P2 | Un échec de chargement s'affiche comme « rien à voir » ou comme une suppression | à confirmer | `SourcingSearches.tsx`, `MissionWorkspace.tsx` | 2 |
| UX09 | P2 | Le compteur Messages tombe à zéro à l'ouverture de la page, sans lecture | oui | `Inbox.tsx` marque lues toutes les notifications `new_message` au montage | 2 |
| UX10 | P2 | « Rechercher » ouvre l'assistant, les raccourcis ne sont pas cohérents | à confirmer | `AppSidebar.tsx`, `NavigationPalette.tsx` | 2 |
| UX11 | P2 | Revenir à une phase de mission rouvre son premier onglet, pas le dernier utilisé | à confirmer | `MissionWorkspaceV2.tsx` | 2 |
| UX12 | P2 | Le choix de séquence ne montre que les 20 plus récentes | à confirmer | `SequenceEnrollButton.tsx` | 2 |
| UX13 | P2 | Des boutons ne déclenchent pas l'action qu'ils annoncent | à confirmer | `MissionOutreach.tsx`, `SearchResultsPanel.tsx`, `CandidateDetailModal.tsx` | 2 |
| UX14 | P2 | L'onboarding annonce « connecté » sur la seule présence d'un compte | à confirmer | `SceneLinkedIn.tsx`, `LinkedInAccountsContext.tsx` | 2 |
| UX15 | P2 | « Retour à la connexion » ouvre l'inscription, et le bouton d'essai ouvre la connexion | oui | `Auth.tsx` : `setIsLogin(!isLogin)` depuis l'écran mot de passe oublié, `SkalrLanding.tsx` navigue vers `/auth` sans mode | 2 |
| UX16 | P2 | Des champs n'ont pas de libellé persistant ni d'association explicite | oui | cartographie : `/calendar` 21 champs et aucun libellé, `/tasks` 10 et aucun, `/marketplace` 5 et aucun, `/auth` 3 et aucun, `/onboarding` 5 et aucun | 2 |
| UX17 | P2 | Des surfaces maison perdent le clavier et le focus | structurel | 6 `createPortal` hors bibliothèque partagée | 3 |
| UX18 | P2 | La vérification d'une séquence et sa sauvegarde ne disent pas la même chose | à confirmer | `SequenceBuilder.tsx`, `SequenceValidationChecklist.tsx` | 3 |
| UX19 | P3 | Des hauteurs calculées et des densités fragilisent les petits écrans | structurel | `Inbox.tsx` retranche 124 px sur la base d'un en-tête de 64 px, `AppHeader` en fait 48 | 3 |
| UX20 | P2 | Les tests protègent le rendu plus que le résultat métier | à confirmer | `e2e/flows/sourcing-linkedin.spec.ts` en `test.fixme`, `e2e/mobile.spec.ts` sans assertion garantie | 3 |

## Constats ajoutés par la contre-vérification

| ID | Prio | Constat | Vérifié | Preuve | Lot |
|---|---|---|---|---|---|
| KX01 | P1 | Le dépôt local de travail avait 162 commits de retard sur la production. Tout correctif écrit dessus visait du code mort | oui | `git rev-list --count HEAD..origin/main` = 162 le 9 septembre 2026 | fait |
| KX02 | P2 | 686 points d'écriture répartis sur 26 routes, dont 134 sur la seule fiche mission. Aucune interface commune ne dit ce qu'une écriture a vraiment produit | oui | `docs/audit-ux/00-cartographie.md` | 1 |
| KX03 | P3 | `maybeSingle` est utilisé 46 fois dans 25 fichiers, mais un seul endroit fabrique un objet de succès quand la ligne manque. UX03 est bien un cas isolé, pas un motif répandu | oui | `useSourcingProjects.ts:147` est le seul `data \|\| { ... }` de l'application | 2 |
| KX04 | P2 | En changeant de conversation, le texte non envoyé de la précédente peut être rangé sous la nouvelle. Trouvé en corrigeant UX04, contourné pour l'instant par un saut de passage, pas réglé au fond | oui | `MessageView.tsx` restaure le brouillon seulement si le composeur est vide, donc le texte de l'ancienne conversation y reste | 2 |

Légende : ✅ signifie corrigé et couvert par un test de non-régression (`npm run test:ux`).

## Ce qu'on ne sait pas encore

Aucun écran connecté n'a été testé dans l'application réelle, par aucune des deux passes. Toutes les colonnes « Écran testé » de la matrice sont donc à faire. C'est la plus grosse zone d'ombre du chantier, et elle demande un environnement de test avec des comptes des différents rôles.
