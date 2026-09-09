# 01 — Matrice de couverture

> Tableau **généré** par `node scripts/audit-ux/inventory.mjs`.
> Les lignes viennent du code : une route ajoutée apparaît toute seule en « à faire ».
> L'état de chaque case se modifie dans `docs/audit-ux/coverage.json`, jamais ici.

Quatre axes, parce qu'un écran peut être lu sans être testé, et testé sans que ses pannes le soient :

1. **Code lu** : les fichiers qui écrivent des données ont été relus.
2. **Écran testé** : le parcours a été fait dans l'application, connecté.
3. **Cas d'erreur** : réseau coupé, droit refusé, ligne absente, quota atteint.
4. **Mobile / clavier** : téléphone, navigation au clavier seul, zoom 200 %.

Une route n'est **complète** que si les quatre axes sont faits. Tant qu'une case reste à faire, la couverture de cette route ne peut pas être annoncée.

| Route | Écran | Écrit | Code lu | Écran testé | Cas d’erreur | Mobile / clavier | État | Note |
|---|---|--:|---|---|---|---|---|---|
| `/` | SkalrLanding | 2 | partiel | partiel | à faire | à faire | partiel | page publique parcourue |
| `/auth` | Auth | 9 | fait | fait | partiel | à faire | partiel | parcours essai et mot de passe oublie observes dans le navigateur |
| `/onboarding` | Onboarding | 13 | fait | à faire | à faire | à faire | partiel |  |
| `/portal/:token` | CandidatePortal | 0 | à faire | à faire | à faire | à faire | à faire |  |
| `/client/:token` | ClientPortalPage | 0 | partiel | à faire | à faire | à faire | partiel | revue ponctuelle seulement |
| `/mission-invite/:token` | AcceptMissionInvite | 10 | à faire | à faire | à faire | à faire | à faire |  |
| `/unsubscribe` | UnsubscribePage | 1 | à faire | à faire | à faire | à faire | à faire |  |
| `/privacy` | PrivacyPage | 0 | à faire | à faire | à faire | à faire | à faire |  |
| `/privacy-extension` | PrivacyExtensionPage | 0 | à faire | à faire | à faire | à faire | à faire |  |
| `/r/:slug` | RecruiterPublicProfile | 0 | à faire | à faire | à faire | à faire | à faire |  |
| `/missions` | Outreach | 12 | fait | à faire | à faire | à faire | partiel |  |
| `/missions/:id` | MissionWorkspace | 135 | fait | à faire | partiel | à faire | partiel | echec de sauvegarde reproduit en local, pas en environnement connecte |
| `/sourcing` | SourcingSearches | 11 | fait | à faire | à faire | à faire | partiel |  |
| `/sourcing/:id` | SourcingSearchPage | 55 | fait | à faire | partiel | à faire | partiel | shortlist et selection reproduites en local |
| `/agents` | AgentsPage | 8 | à faire | à faire | à faire | à faire | à faire |  |
| `/pipeline` | ATS | 72 | fait | à faire | à faire | à faire | partiel |  |
| `/inbox` | Inbox | 44 | fait | à faire | partiel | à faire | partiel | brouillons reproduits en local, superposition mobile non reproduite |
| `/calendar` | CalendarPage | 17 | partiel | à faire | à faire | à faire | partiel | revue ponctuelle seulement |
| `/tasks` | TasksPage | 15 | partiel | à faire | à faire | à faire | partiel | revue ponctuelle seulement |
| `/dashboard` | Dashboard | 75 | partiel | à faire | à faire | à faire | partiel | revue ponctuelle seulement |
| `/qualification/:id` | Qualification | 2 | à faire | à faire | à faire | à faire | à faire |  |
| `/pipeline/scorecard/:candidateId` | ScorecardFullPage | 66 | à faire | à faire | à faire | à faire | à faire |  |
| `/ats/scorecard/:candidateId` | ScorecardFullPage | 66 | à faire | à faire | à faire | à faire | à faire |  |
| `/settings` | Settings | 59 | partiel | à faire | à faire | à faire | partiel | revue ponctuelle seulement |
| `/pricing` | Pricing | 8 | partiel | à faire | à faire | à faire | partiel | revue ponctuelle seulement |
| `/marketplace` | Marketplace | 8 | partiel | à faire | à faire | à faire | partiel | revue ponctuelle seulement |

**Couverture : 0 route complète sur 26.**

## Critère de fin

L'audit est complet sur le périmètre annoncé quand les quatre axes sont faits pour chaque route de ce tableau, que chaque constat porte une preuve et une priorité, et que les scénarios bout en bout de `03-scenarios.md` sont passés. Une zone bloquée reste bloquée : elle ne se déclare pas couverte.
