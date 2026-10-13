# Lot 5f-2c : ContactFlow depuis le Pipeline

Date : 13/10/2026. Auteur : Claude. Feu vert du propriétaire le 13/10/2026 sur les propositions de `lot5f2b-conception.md` (décisions 3 à 9). Ce document fixe la construction de 5f-2c et sert de contrat entre les fichiers.

## Ce que fait 5f-2c

Interrupteur des séquences allumé, le bouton « Contacter » de la barre d'actions du Pipeline (et celui de la fiche d'un Retenu, même composant) n'ouvre plus le menu « Séquence » : il ouvre le panneau Prise de contact en mode Contacter (`?panneau=contact&contacter=1`). Le panneau montre, de haut en bas :

1. La séquence, choisie d'avance (décision 5) : menu « Séquences de la mission », « Autres séquences de l'organisation », porte « Rédiger une séquence pour cette mission ». Phrase sur le compte d'envoi et la première action.
2. Les candidats en trois groupes : « 2 prêts · 1 à compléter · 2 exclus ». Chaque raison est écrite en toutes lettres, avec sa dérogation quand elle existe (décisions 3 et 4).
3. L'aperçu du premier message du candidat, par `preview_values`, avec ‹ › et compteur.
4. La jauge du plafond LinkedIn (décision 6).
5. Le pied : `RecipientsConfirm` (case des destinataires dès 5), puis « Inscrire N candidats ». Écriture par `enrollCandidates` (lot 5f-1), sans autre site d'écriture.

Interrupteur éteint (`?sequences-v2=0`) : l'ancien menu « Séquence » reste tel quel (décision 9).

## Décisions prises pour construire

Reprises des propositions de `lot5f2b-conception.md`, avec ces précisions.

- Séquences à message rédigé par l'IA : tous les candidats sont « à compléter » (raison : message à rédiger et relire). Le pied propose « Relire les messages », qui ouvre `EnrollmentPreviewModal` sur la même sélection (génération, relecture, inscription un par un avec retouches, comme aujourd'hui). ContactFlow n'inscrit jamais lui-même une séquence à message IA : le moteur n'enverrait rien sans texte relu.
- Séquences à message écrit ou sans message : « Inscrire N candidats » appelle `enrollCandidates` en mode `batch`, `firstStepTiming: 'business_hours'` (comme l'inscription simple d'aujourd'hui). Pas de retouche par candidat dans le panneau ; « Relire les messages » reste disponible pour personnaliser (même fenêtre).
- Dérogations par catégorie, comme les deux fenêtres d'aujourd'hui : « Inscrire quand même » pour les contacts de moins de 90 jours (propriétaire et administrateur seulement), « Inclure quand même » pour les hors réseau et les « une invitation seule déjà en relation ». Aucune dérogation pour « déjà dans la séquence », « déjà passé par la séquence » et « données effacées ».
- Un candidat sans lien de profil LinkedIn est « à compléter » (jamais laissé de côté en silence) avec « Ouvrir la fiche ». Les raisons sont posées dans cet ordre : sans profil LinkedIn, déjà dans la séquence ou déjà passé, effacé, contacté depuis moins de 90 jours, incompatible, message IA à relire. La première qui s'applique décide du groupe.
- Les lignes du Pipeline n'ont ni identifiant de fournisseur ni distance de réseau : ContactFlow relit les lignes sélectionnées (lecture bornée, `mission_candidate_rows`, `provider_id` et `network_distance` extraits côté base) pour que la compatibilité, l'aperçu et l'anti-doublon voient les mêmes données que les fenêtres d'aujourd'hui. Les lignes sont relues à chaque ouverture : un lien LinkedIn ajouté entre-temps est vu.
- Sélection : état de la page mission, au-dessus de l'écran et du panneau (contexte dédié, pas le contexte de la mission : 19 composants s'y abonnent). Perdue au rechargement : `&contacter=1` sans sélection ouvre l'onglet « Contactés ». Quitter le Pipeline panneau fermé vide la sélection, comme avant. 400 candidats au plus par inscription (`CONTACT_FLOW_MAX`), les suivants restent sélectionnés. Aperçu relu par pages de 10, une page à la fois.
- « Rédiger une séquence pour cette mission » s'ouvre dans un nouvel onglet : la sélection du Pipeline ne survit pas à un changement de route (elle est en mémoire), et le plan demandait « sélection intacte ». La liste des séquences se relit au retour sur l'onglet (focus de la fenêtre) ; la séquence rédigée, plus récente, devient le choix d'avance.
- Après l'inscription : toast « N candidats inscrits dans la séquence « X » » avec l'action « Ouvrir la séquence », sans « Annuler » (un premier envoi peut déjà être parti). Puis les avertissements des fenêtres actuelles (profil effacé, même personne, déjà passés, déjà dans la séquence, Retenu en échec). Les candidats traités quittent la sélection ; le panneau passe sur « Contactés ».
- Formule gratuite : la séquence ne peut pas partir. ContactFlow montre l'invitation à passer à un plan payant (`UpgradePrompt`), comme le menu d'aujourd'hui. Le lot 5g ajoutera le parcours un par un.
- Collaborateur : voit et inscrit dans ses séquences seulement (la lecture est bornée par la RLS). Si aucune ne convient, la porte « Rédiger » s'affiche.

## Hors périmètre (5f-2d)

Sourcing de la mission, « Contacter les N » de Maintenant (qui garde le focus sur le bouton de la barre), page séquence, hors mission et messagerie. Le bouton « Contacter » de la fiche d'un Retenu emprunte le même composant que la barre : en 5f-2c il remplace la sélection par ce candidat puis ouvre le panneau. 5f-2d reprendra les autres entrées.

## Contrat entre les fichiers

### Modules purs (lisibles par Node 22 sans compilation : imports relatifs avec extension `.ts` seulement)

`src/lib/missionSequencePick.ts`

```ts
export interface PickableSequence { id: string; name: string; is_active: boolean; project_id: string | null; created_at: string; stepCount: number }
export interface SequenceMenu<T extends PickableSequence = PickableSequence> { mission: T[]; others: T[]; pick: T | null }
export function bareMissionId(jobId: string | null | undefined): string | null; // retire « project: »
export function missionSequenceMenu<T extends PickableSequence>(list: readonly T[], missionId: string | null): SequenceMenu<T>;
```

Utilisable : `is_active` et `stepCount > 0`. `mission` : `project_id === missionId`, du plus récent au plus ancien (`created_at`, puis `id`). `others` : les autres utilisables, même tri. `pick` : `mission[0] ?? null`.

`src/lib/contactFlowGroups.ts`

```ts
export type ContactReason = 'no_linkedin' | 'ai_review' | 'in_sequence' | 'passed_sequence' | 'erased' | 'recent_contact' | 'too_far' | 'connection_only';
export type ContactOverride = 'recent_contact' | 'incompatible';
export interface FlowEntryInput { id: string; name: string; hasLinkedIn: boolean }
export interface ContactEligibility {
  blocking: ReadonlyMap<string, 'in_sequence' | 'passed'>;
  erased: ReadonlySet<string>;
  recent: ReadonlyMap<string, string>; // id vers le libellé exact « Déjà contacté par Marie le 03/10/2026 »
  incompatible: ReadonlyMap<string, 'too_far' | 'connection_only_already_connected'>;
  warnings: ReadonlyMap<string, 'connection_already_connected' | 'inmail_wasted'>;
}
export interface ContactClassifyOptions { aiReview: boolean; canOverrideRecent: boolean; overrides: ReadonlySet<ContactOverride> }
export interface ContactEntry<T extends FlowEntryInput> {
  source: T; reason: ContactReason | null; label: string | null; override: ContactOverride | null; overridden: boolean;
}
export interface ContactGroups<T extends FlowEntryInput> { ready: ContactEntry<T>[]; incomplete: ContactEntry<T>[]; excluded: ContactEntry<T>[]; notes: string[] }
export function classifyContactEntries<T extends FlowEntryInput>(entries: readonly T[], eligibility: ContactEligibility, options: ContactClassifyOptions): ContactGroups<T>;
export function contactSummary(groups: ContactGroups<FlowEntryInput>): string;
export const OVERRIDE_LABEL: Record<ContactOverride, string>; // « Inscrire quand même » / « Inclure quand même »
```

`src/lib/quotaGauge.ts`

```ts
export interface QuotaFigures { usedToday: number; capToday: number; usedWeekInvitations: number; capWeekInvitations: number }
export type GaugeKind = 'invitations' | 'actions';
export type GaugeLevel = 'ok' | 'warning' | 'critical';
export interface QuotaGaugeModel { kind: GaugeKind; remaining: number; cap: number; used: number; count: number; percent: number; level: GaugeLevel; text: string; warning: string | null }
export function gaugeKindOf(firstActionType: string | null | undefined): GaugeKind | null;
export function quotaGauge(firstActionType: string | null | undefined, figures: QuotaFigures, count: number): QuotaGaugeModel | null;
```

### Types partagés

`src/components/sequences/contact/types.ts`

```ts
export interface FlowCandidate extends FlowEntryInput {
  id: string;            // profile.id : clé des inscriptions et des aperçus
  rowId: string;         // ligne du Pipeline (ouvre la fiche)
  candidateId: string;
  headline: string | null;
  pictureUrl: string | null;
  profile: LinkedInProfile; // prêt pour enrollCandidates, avec provider_id et network_distance quand connus
}
export type FlowCandidatesStatus = 'loading' | 'error' | 'ready';
```

### Composants et hooks

- `src/components/missions/v3/shell/missionSelectionContext.ts` et `missionSelection.tsx` : `MissionSelectionProvider` (monté dans `MissionShell`) et `useMissionSelection(): { selection: ReadonlyMap<string, MissionCandidateRow>; setSelection: Dispatch<SetStateAction<Map<string, MissionCandidateRow>>> }`.
- `src/components/missions/v3/pipeline/useContactCandidates.ts` : `CONTACT_FLOW_MAX = 400`, `useContactCandidates(project, rows, enabled)` rend `{ candidates: FlowCandidate[]; status: FlowCandidatesStatus; refetch(): void; overflow: number }`.
- `src/components/sequences/contact/ContactFlow.tsx` : `ContactFlow(props: ContactFlowProps)`, voir le fichier. Il écrit seulement par `enrollCandidates`.
- `RecipientGroups.tsx`, `SequencePicker.tsx`, `QuotaGauge.tsx` : présentation seulement, sans lecture de données.
- `useContactSequences.ts`, `useSequenceSteps.ts`, `useContactEligibility.ts` (lectures) ; `announceEnrollOutcome.ts` (toasts) ; `flowSteps.ts` (étapes brutes vers la forme de l'aperçu, même correspondance que `mapSteps` de `EnrollmentPreviewModal`).
- Panneau : `ContactPanel.tsx` ajoute une branche `asksFlow` avant `} else if (sequencesV2) {` (les gardes 5F3-3 et 5F2B-10 découpent le source autour de cette ligne : ne pas la modifier).
- Adresse : paramètre `contacter` (constante locale, comme `outreach`), retiré par `closePanel`, `openCandidate`, `openContactPanel` et par le choix d'un onglet.

## Gardes à respecter

- `src/lib/enrollCandidates.ts` reste le seul écrivain de `sequence_enrollments` et `sequence_step_executions` ; ContactFlow ne lit que (`select`). Il n'appelle pas `retainCandidates` (la règle Retenu passe par `enrollCandidates`).
- Aucun tiret long ni `(s)` dans les fichiers nouveaux et dans `ContactPanel.tsx`, commentaires compris. Pluriels par `plural` de `@/lib/plural`.
- Aucun `<button>` brut (cliquet design) : `Button` du kit. Un seul `variant="primary"` par zone.
- Aucun `any` nouveau, aucun `@ts-ignore`, dépendances d'effet complètes (le cliquet ESLint compte les avertissements).
- Un lien vers `/sequences` se fait par `newSequencePath` ou `sequencePath` dans `components/sequences/**` (zone exemptée de la garde de l'interrupteur de `seq-v2-socle`, qui s'applique aux fichiers hors de cette zone) ; ContactFlow ne se monte que interrupteur allumé.
- Les tests qui lisent le source de `PipelineScreen`, `ContactPanel`, `ContactSelectionButton` et `MissionWorkspaceV3` figent des phrases exactes : voir le plan du lot, section 5f-2.
