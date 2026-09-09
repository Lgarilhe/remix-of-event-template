# 00 — Cartographie de l'application (générée)

> Fichier **généré** par `node scripts/audit-ux/inventory.mjs`. Ne pas éditer à la main.
> Regénérer après chaque lot : si une ligne bouge, la couverture correspondante est à revalider.

Chaque route est parcourue par son graphe d'imports (profondeur 6, hors `components/ui`).
Les colonnes comptent ce qui casse une expérience quand c'est mal fait :

- **Écrit** : appels qui modifient des données (`insert`, `update`, `upsert`, `delete`) plus les appels de fonctions serveur. C'est là qu'un « c'est enregistré » peut être faux.
- **Surfaces** : fenêtres bloquantes et `createPortal` maison. Un portail maison ne gère ni le focus ni la touche Échap.
- **Saisie / Libellés** : champs de formulaire, et libellés associés. Un écart fort entre les deux signale des champs sans repère persistant.
- **Succès / Erreur** : messages de confirmation contre messages d'échec. Beaucoup de succès pour peu d'écritures vérifiées annonce des confirmations trompeuses.

| Route | Écran | Fichiers | Écrit | Surfaces | Saisie / Libellés | Succès / Erreur | Pièges |
|---|---|--:|--:|--:|--:|--:|---|
| `/` | SkalrLanding | 15 | 2 | · | 4 / · | · / · | maybeSingle x1, localStorage x1 |
| `/index` | Navigate | 0 | · | · | · / · | · / · | · |
| `/auth` | Auth | 20 | 9 | 1 | 3 / · | 6 / 6 | maybeSingle x4, localStorage x4 |
| `/onboarding` | Onboarding | 35 | 13 | 1 | 5 / · | 7 / 13 | maybeSingle x4, localStorage x5 |
| `/portal/:token` | CandidatePortal | 5 | · | · | · / · | · / · | · |
| `/client/:token` | ClientPortalPage | 5 | · | · | · / · | 1 / 2 | localStorage x2 |
| `/mission-invite/:token` | AcceptMissionInvite | 10 | 10 | · | · / · | 9 / 8 | maybeSingle x6, localStorage x1 |
| `/unsubscribe` | UnsubscribePage | 4 | 1 | · | · / · | · / · | · |
| `/privacy` | PrivacyPage | 2 | · | · | · / · | · / · | · |
| `/privacy-extension` | PrivacyExtensionPage | 2 | · | · | · / · | · / · | · |
| `/r/:slug` | RecruiterPublicProfile | 5 | · | · | · / · | · / · | maybeSingle x1 |
| `/candidates` | Navigate | 0 | · | · | · / · | · / · | · |
| `/missions` | Outreach | 31 | 12 | 2 | 1 / · | 20 / 25 | maybeSingle x6, localStorage x6 |
| `/missions/:id` | MissionWorkspace | 229 | 135 | 40 | 112 / 59 | 133 / 235 | maybeSingle x19, portail x2, window.confirm x1, localStorage x38 |
| `/sourcing` | SourcingSearches | 15 | 11 | 1 | · / · | 8 / 8 | maybeSingle x6, localStorage x1 |
| `/sourcing/:id` | SourcingSearchPage | 175 | 55 | 20 | 97 / 33 | 60 / 131 | maybeSingle x13, portail x1, window.confirm x1, localStorage x31 |
| `/agents` | AgentsPage | 13 | 8 | · | · / · | 6 / 5 | maybeSingle x4, localStorage x1 |
| `/pipeline` | ATS | 138 | 72 | 10 | 26 / 3 | 56 / 80 | maybeSingle x21, portail x1, localStorage x3 |
| `/inbox` | Inbox | 117 | 55 | 15 | 25 / 11 | 56 / 98 | maybeSingle x21, portail x1, localStorage x23 |
| `/calendar` | CalendarPage | 36 | 17 | 4 | 21 / · | 13 / 17 | maybeSingle x6, localStorage x5 |
| `/tasks` | TasksPage | 31 | 15 | 2 | 10 / · | 11 / 13 | maybeSingle x6, localStorage x1 |
| `/outreach` | Navigate | 0 | · | · | · / · | · / · | · |
| `/ats` | Navigate | 0 | · | · | · / · | · / · | · |
| `/dashboard` | Dashboard | 141 | 75 | 13 | 21 / 3 | 61 / 90 | maybeSingle x22, portail x1, localStorage x8 |
| `/qualification/:id` | Qualification | 10 | 2 | · | 2 / · | 1 / 2 | maybeSingle x1 |
| `/pipeline/scorecard/:candidateId` | ScorecardFullPage | 108 | 66 | 10 | 14 / 3 | 53 / 77 | maybeSingle x24, portail x1, localStorage x4 |
| `/ats/scorecard/:candidateId` | ScorecardFullPage | 108 | 66 | 10 | 14 / 3 | 53 / 77 | maybeSingle x24, portail x1, localStorage x4 |
| `/settings` | Settings | 90 | 59 | 20 | 68 / 34 | 73 / 106 | maybeSingle x14, window.confirm x1, localStorage x6 |
| `/pricing` | Pricing | 15 | 8 | · | · / · | 6 / 9 | maybeSingle x4, localStorage x1 |
| `/marketplace` | Marketplace | 26 | 8 | 3 | 5 / · | 14 / 16 | maybeSingle x5, localStorage x1 |
| `*` | NotFound | 2 | · | · | · / · | · / · | · |

## Points chauds par route

Les fichiers qui écrivent réellement. Ce sont eux qu'un test de résultat doit couvrir.

### `/` — SkalrLanding

- `src/pages/SkalrLanding.tsx` : écrit 1, succès 0, erreur 0
- `src/hooks/use-toast.ts` : écrit 1, succès 0, erreur 0
- `src/lib/orgContext.ts` : écrit 0, succès 0, erreur 0 — attention : maybeSingle

### `/auth` — Auth

- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/hooks/useAuthReady.ts` : écrit 1, succès 0, erreur 0
- `src/hooks/use-toast.ts` : écrit 1, succès 0, erreur 0
- `src/lib/orgContext.ts` : écrit 0, succès 0, erreur 0 — attention : maybeSingle

### `/onboarding` — Onboarding

- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/pages/Onboarding.tsx` : écrit 2, succès 0, erreur 1
- `src/components/onboarding/SceneOrganization.tsx` : écrit 2, succès 0, erreur 4
- `src/components/onboarding/SceneSpecializations.tsx` : écrit 1, succès 0, erreur 0
- `src/hooks/useAuthReady.ts` : écrit 1, succès 0, erreur 0
- `src/lib/orgContext.ts` : écrit 0, succès 0, erreur 0 — attention : maybeSingle

### `/mission-invite/:token` — AcceptMissionInvite

- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/hooks/useMissionInvitations.ts` : écrit 2, succès 3, erreur 3 — attention : maybeSingle
- `src/hooks/useAuthReady.ts` : écrit 1, succès 0, erreur 0
- `src/lib/orgContext.ts` : écrit 0, succès 0, erreur 0 — attention : maybeSingle

### `/unsubscribe` — UnsubscribePage

- `src/pages/Unsubscribe.tsx` : écrit 1, succès 0, erreur 0

### `/r/:slug` — RecruiterPublicProfile

- `src/pages/RecruiterPublicProfile.tsx` : écrit 0, succès 0, erreur 0 — attention : maybeSingle

### `/missions` — Outreach

- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/hooks/useSourcingProjects.ts` : écrit 3, succès 2, erreur 3 — attention : maybeSingle
- `src/components/outreach/projects/ProjectsListV2.tsx` : écrit 1, succès 0, erreur 2
- `src/hooks/useAuthReady.ts` : écrit 1, succès 0, erreur 0
- `src/lib/orgContext.ts` : écrit 0, succès 0, erreur 0 — attention : maybeSingle

### `/missions/:id` — MissionWorkspace

- `src/components/outreach/SequenceEnrollmentsPanel.tsx` : écrit 11, succès 7, erreur 10
- `src/components/ats/ScorecardTab.tsx` : écrit 10, succès 4, erreur 4 — attention : maybeSingle
- `src/hooks/useJobCandidateStatus.ts` : écrit 10, succès 1, erreur 5
- `src/components/outreach/SequencesList.tsx` : écrit 8, succès 5, erreur 6
- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/hooks/useMissionProcess.ts` : écrit 7, succès 3, erreur 8
- `src/components/outreach/projects/ProjectCandidatesTableEnhanced.tsx` : écrit 7, succès 6, erreur 5
- `src/hooks/useCandidateEnrollments.ts` : écrit 6, succès 3, erreur 3
- `src/components/ats/CandidateDetailModal.tsx` : écrit 5, succès 5, erreur 7 — attention : maybeSingle
- `src/hooks/useEmailSignatures.ts` : écrit 5, succès 3, erreur 3
- `src/lib/cvStorage.ts` : écrit 4, succès 0, erreur 0
- `src/hooks/useSourcingProjects.ts` : écrit 3, succès 2, erreur 3 — attention : maybeSingle

### `/sourcing` — SourcingSearches

- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/hooks/useSourcingProjects.ts` : écrit 3, succès 2, erreur 3 — attention : maybeSingle
- `src/hooks/useAuthReady.ts` : écrit 1, succès 0, erreur 0
- `src/lib/orgContext.ts` : écrit 0, succès 0, erreur 0 — attention : maybeSingle

### `/sourcing/:id` — SourcingSearchPage

- `src/hooks/useJobCandidateStatus.ts` : écrit 10, succès 1, erreur 5
- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/components/outreach/EnrollmentPreviewModal.tsx` : écrit 6, succès 2, erreur 5 — attention : maybeSingle, portail maison
- `src/hooks/useSourcingProjects.ts` : écrit 3, succès 2, erreur 3 — attention : maybeSingle
- `src/hooks/useClientCompetitors.ts` : écrit 3, succès 0, erreur 2
- `src/components/outreach/result-card/ProfileDetailSheet.tsx` : écrit 3, succès 4, erreur 0 — attention : maybeSingle, succès sans branche erreur
- `src/hooks/useATSData.ts` : écrit 3, succès 1, erreur 2
- `src/components/outreach/SequenceEnrollModal.tsx` : écrit 3, succès 1, erreur 4
- `src/hooks/useSearchHistory.ts` : écrit 2, succès 1, erreur 0 — attention : succès sans branche erreur
- `src/hooks/useLinkedInScoring.ts` : écrit 2, succès 2, erreur 11
- `src/components/outreach/projects/AddToProjectButton.tsx` : écrit 2, succès 1, erreur 1 — attention : maybeSingle
- `src/hooks/useMemberLinkedInAccounts.ts` : écrit 2, succès 2, erreur 4

### `/agents` — AgentsPage

- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/hooks/useAuthReady.ts` : écrit 1, succès 0, erreur 0
- `src/lib/orgContext.ts` : écrit 0, succès 0, erreur 0 — attention : maybeSingle

### `/pipeline` — ATS

- `src/components/ats/ScorecardTab.tsx` : écrit 10, succès 4, erreur 4 — attention : maybeSingle
- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/components/outreach/EnrollmentPreviewModal.tsx` : écrit 6, succès 2, erreur 5 — attention : maybeSingle, portail maison
- `src/hooks/useCandidateEnrollments.ts` : écrit 6, succès 3, erreur 3
- `src/pages/ATS.tsx` : écrit 5, succès 0, erreur 0
- `src/components/ats/CandidateDetailModal.tsx` : écrit 5, succès 5, erreur 7 — attention : maybeSingle
- `src/lib/cvStorage.ts` : écrit 4, succès 0, erreur 0
- `src/hooks/useATSData.ts` : écrit 3, succès 1, erreur 2
- `src/components/outreach/result-card/ProfileDetailSheet.tsx` : écrit 3, succès 4, erreur 0 — attention : maybeSingle, succès sans branche erreur
- `src/hooks/useSourcingProjects.ts` : écrit 3, succès 2, erreur 3 — attention : maybeSingle
- `src/components/outreach/SequenceEnrollModal.tsx` : écrit 3, succès 1, erreur 4
- `src/components/outreach/projects/AddToProjectButton.tsx` : écrit 2, succès 1, erreur 1 — attention : maybeSingle

### `/inbox` — Inbox

- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/components/outreach/EnrollmentPreviewModal.tsx` : écrit 6, succès 2, erreur 5 — attention : maybeSingle, portail maison
- `src/hooks/useMessagesInbox.ts` : écrit 4, succès 8, erreur 14 — attention : maybeSingle
- `src/hooks/useChatStatus.ts` : écrit 4, succès 3, erreur 3
- `src/hooks/useChatCategories.ts` : écrit 4, succès 1, erreur 1
- `src/hooks/useMessageTemplates.ts` : écrit 4, succès 3, erreur 3
- `src/hooks/useSourcingProjects.ts` : écrit 3, succès 2, erreur 3 — attention : maybeSingle
- `src/components/outreach/SequenceEnrollModal.tsx` : écrit 3, succès 1, erreur 4
- `src/hooks/useUserTemplateVariables.ts` : écrit 3, succès 3, erreur 3
- `src/hooks/useMemberLinkedInAccounts.ts` : écrit 2, succès 2, erreur 4
- `src/hooks/useEnrollmentPreview.ts` : écrit 2, succès 0, erreur 0 — attention : maybeSingle
- `src/components/outreach/inbox/MessageView.tsx` : écrit 2, succès 2, erreur 2

### `/calendar` — CalendarPage

- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/hooks/useSourcingProjects.ts` : écrit 3, succès 2, erreur 3 — attention : maybeSingle
- `src/components/calendar/CreateEventModal.tsx` : écrit 2, succès 1, erreur 3
- `src/hooks/useAllReminders.ts` : écrit 2, succès 2, erreur 2
- `src/hooks/useAuthReady.ts` : écrit 1, succès 0, erreur 0
- `src/components/calendar/useCalendarConflicts.ts` : écrit 1, succès 0, erreur 0
- `src/components/tasks/CreateTaskModal.tsx` : écrit 1, succès 1, erreur 3
- `src/lib/orgContext.ts` : écrit 0, succès 0, erreur 0 — attention : maybeSingle

### `/tasks` — TasksPage

- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/hooks/useSourcingProjects.ts` : écrit 3, succès 2, erreur 3 — attention : maybeSingle
- `src/hooks/useAllReminders.ts` : écrit 2, succès 2, erreur 2
- `src/pages/Tasks.tsx` : écrit 1, succès 0, erreur 0
- `src/hooks/useAuthReady.ts` : écrit 1, succès 0, erreur 0
- `src/components/tasks/CreateTaskModal.tsx` : écrit 1, succès 1, erreur 3
- `src/lib/orgContext.ts` : écrit 0, succès 0, erreur 0 — attention : maybeSingle

### `/dashboard` — Dashboard

- `src/components/ats/ScorecardTab.tsx` : écrit 10, succès 4, erreur 4 — attention : maybeSingle
- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/components/outreach/EnrollmentPreviewModal.tsx` : écrit 6, succès 2, erreur 5 — attention : maybeSingle, portail maison
- `src/hooks/useCandidateEnrollments.ts` : écrit 6, succès 3, erreur 3
- `src/components/ats/CandidateDetailModal.tsx` : écrit 5, succès 5, erreur 7 — attention : maybeSingle
- `src/lib/cvStorage.ts` : écrit 4, succès 0, erreur 0
- `src/hooks/useATSData.ts` : écrit 3, succès 1, erreur 2
- `src/hooks/useSourcingProjects.ts` : écrit 3, succès 2, erreur 3 — attention : maybeSingle
- `src/components/outreach/result-card/ProfileDetailSheet.tsx` : écrit 3, succès 4, erreur 0 — attention : maybeSingle, succès sans branche erreur
- `src/components/outreach/SequenceEnrollModal.tsx` : écrit 3, succès 1, erreur 4
- `src/hooks/useAllReminders.ts` : écrit 2, succès 2, erreur 2
- `src/hooks/useMemberEmailAccounts.ts` : écrit 2, succès 2, erreur 3

### `/qualification/:id` — Qualification

- `src/pages/Qualification.tsx` : écrit 2, succès 1, erreur 2
- `src/lib/orgContext.ts` : écrit 0, succès 0, erreur 0 — attention : maybeSingle

### `/pipeline/scorecard/:candidateId` — ScorecardFullPage

- `src/components/ats/ScorecardTab.tsx` : écrit 10, succès 4, erreur 4 — attention : maybeSingle
- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/components/outreach/EnrollmentPreviewModal.tsx` : écrit 6, succès 2, erreur 5 — attention : maybeSingle, portail maison
- `src/hooks/useCandidateEnrollments.ts` : écrit 6, succès 3, erreur 3
- `src/components/ats/CandidateDetailModal.tsx` : écrit 5, succès 5, erreur 7 — attention : maybeSingle
- `src/lib/cvStorage.ts` : écrit 4, succès 0, erreur 0
- `src/hooks/useATSData.ts` : écrit 3, succès 1, erreur 2
- `src/components/outreach/result-card/ProfileDetailSheet.tsx` : écrit 3, succès 4, erreur 0 — attention : maybeSingle, succès sans branche erreur
- `src/hooks/useSourcingProjects.ts` : écrit 3, succès 2, erreur 3 — attention : maybeSingle
- `src/components/outreach/SequenceEnrollModal.tsx` : écrit 3, succès 1, erreur 4
- `src/components/outreach/projects/AddToProjectButton.tsx` : écrit 2, succès 1, erreur 1 — attention : maybeSingle
- `src/lib/candidateContacts.ts` : écrit 2, succès 0, erreur 0 — attention : maybeSingle

### `/ats/scorecard/:candidateId` — ScorecardFullPage

- `src/components/ats/ScorecardTab.tsx` : écrit 10, succès 4, erreur 4 — attention : maybeSingle
- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/components/outreach/EnrollmentPreviewModal.tsx` : écrit 6, succès 2, erreur 5 — attention : maybeSingle, portail maison
- `src/hooks/useCandidateEnrollments.ts` : écrit 6, succès 3, erreur 3
- `src/components/ats/CandidateDetailModal.tsx` : écrit 5, succès 5, erreur 7 — attention : maybeSingle
- `src/lib/cvStorage.ts` : écrit 4, succès 0, erreur 0
- `src/hooks/useATSData.ts` : écrit 3, succès 1, erreur 2
- `src/components/outreach/result-card/ProfileDetailSheet.tsx` : écrit 3, succès 4, erreur 0 — attention : maybeSingle, succès sans branche erreur
- `src/hooks/useSourcingProjects.ts` : écrit 3, succès 2, erreur 3 — attention : maybeSingle
- `src/components/outreach/SequenceEnrollModal.tsx` : écrit 3, succès 1, erreur 4
- `src/components/outreach/projects/AddToProjectButton.tsx` : écrit 2, succès 1, erreur 1 — attention : maybeSingle
- `src/lib/candidateContacts.ts` : écrit 2, succès 0, erreur 0 — attention : maybeSingle

### `/settings` — Settings

- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/hooks/useEmailSignatures.ts` : écrit 5, succès 3, erreur 3
- `src/components/settings/AgentConnectorsSettings.tsx` : écrit 4, succès 3, erreur 10
- `src/components/settings/NotionConnectionCard.tsx` : écrit 4, succès 2, erreur 3
- `src/hooks/useMessageTemplates.ts` : écrit 4, succès 3, erreur 3
- `src/hooks/usePedigreePresets.ts` : écrit 3, succès 3, erreur 4
- `src/components/settings/OrgLogoEditor.tsx` : écrit 3, succès 3, erreur 5
- `src/hooks/useUserTemplateVariables.ts` : écrit 3, succès 3, erreur 3
- `src/hooks/useSourcingProjects.ts` : écrit 3, succès 2, erreur 3 — attention : maybeSingle
- `src/pages/Settings.tsx` : écrit 2, succès 1, erreur 1
- `src/components/settings/AgentActionsSettings.tsx` : écrit 2, succès 5, erreur 3
- `src/hooks/useAiContext.ts` : écrit 2, succès 2, erreur 2 — attention : maybeSingle

### `/pricing` — Pricing

- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/hooks/useAuthReady.ts` : écrit 1, succès 0, erreur 0
- `src/lib/orgContext.ts` : écrit 0, succès 0, erreur 0 — attention : maybeSingle

### `/marketplace` — Marketplace

- `src/hooks/useOrganization.ts` : écrit 7, succès 6, erreur 5 — attention : maybeSingle
- `src/hooks/useAuthReady.ts` : écrit 1, succès 0, erreur 0
- `src/lib/orgContext.ts` : écrit 0, succès 0, erreur 0 — attention : maybeSingle
- `src/components/marketplace/PartnerCircleCard.tsx` : écrit 0, succès 0, erreur 3 — attention : maybeSingle
