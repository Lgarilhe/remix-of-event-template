# Lot 5f-2d : les autres entrées de ContactFlow

Date : 13/10/2026. Suite de `lot5f2c-conception.md` (panneau Contacter du Pipeline). Ce lot branche sur le même flux d'inscription les entrées qui passaient encore par le menu « Séquence » et la fenêtre `SequenceEnrollModal`, quand l'interrupteur des séquences est allumé (`useSequencesBeta()`). Interrupteur éteint (`?sequences-v2=0`) : l'ancien comportement, inchangé, jusqu'au lot 5j.

Sources : cinq cartographies en lecture seule du 13/10/2026 (Sourcing, recherche et fiches, messagerie, page séquence et carte Maintenant, généralisation de ContactFlow).

## 1. Périmètre

1. Toutes les entrées de `SequenceEnrollButton` : les deux boutons de `SourcingResultsV3`, la carte de résultat (`CardActions`), la fiche (`ProfileDetailSheet`, panneau et feuille), les deux boutons de `SearchResultsPanel` (ancienne page). Un seul changement dans le bouton.
2. Messagerie (`MessagesInbox`) : « Inscrire dans une séquence » ouvre une feuille avec le choix de la mission, puis ContactFlow.
3. Page séquence : « Inscrire des candidats » mène au Pipeline de la mission avec la séquence demandée proposée d'avance.
4. Carte Maintenant : « Contacter les N » ouvre le panneau Contacter au lieu de donner le focus au bouton de la barre.
5. Renommage de « Présélectionner sans message » en « Retenir sans contacter » dans `EnrollmentPreviewModal` (interrupteur allumé seulement).

Hors périmètre : `SequencesList` (panneau Séquences de la mission, « Inscrire des candidats » vers `?tab=sourcing`), `CandidateDetailModal` du Pipeline global (reste sur `job = null`, inchangé), retrait de l'ancien flux (lot 5j), fusion des doublons (lot 4).

## 2. Décisions

D1. Hôte pour les profils de recherche : une feuille latérale (`Sheet`, côté droit) tenue par `SequenceEnrollButton`, chargée à la demande (`React.lazy`) pour ne pas alourdir les chunks de la messagerie et du Pipeline. Les profils sont figés à l'ouverture (une sélection qui change pendant que la feuille est ouverte ne modifie pas la liste montrée). Le bouton garde sa signature, ses classes et son libellé ; seul son comportement change (il ouvre la feuille au lieu du menu).

D2. Candidats sans ligne de Pipeline : `FlowCandidate.rowId` et `candidateId` peuvent valoir `null`. La clé rendue par `onEnrolled` est `rowId ?? id` (l'identifiant du profil quand il n'y a pas de ligne). L'appelant sait ce qu'il a donné. Le panneau de la mission ne change pas (`ContactPanel` passe toujours des lignes).

D3. Compte d'envoi : `ContactFlow` accepte un `accountId` imposé (le compte du point d'entrée, parité avec l'ancien `accountId` du bouton et de la messagerie). Absent : le compte propre de la personne, comme au Pipeline. Un compte de collègue reste bloqué par `useSendingAccount`.

D4. Sans mission : `missionId` et `job` peuvent valoir `null`. Aucune ligne n'est écrite dans le Pipeline (`enrollCandidates` et `retainEnrolled` le gèrent déjà), aucune séquence n'est présélectionnée, la porte « Rédiger une séquence pour cette mission » est masquée, « Ouvrir la séquence » mène à `/sequences/<id>?onglet=candidats`.

D5. Messagerie : feuille `InboxContactSheet` avec le Select de mission au-dessus du flux. Poste transmis `{ id: 'project:<uuid>', title: nom de la mission }` (préfixe comme au Pipeline et au Sourcing, titre inchangé). Profil mince de la conversation (parité avec l'ancien flux : la règle Retenu s'appliquait déjà avec ce profil). Sans mission choisie : `job = null`, rien d'écrit dans le Pipeline. L'avertissement « Relation LinkedIn non vérifiée » se calcule dans ContactFlow à partir de la séquence choisie (`notice` en fonction des étapes).

D6. Page séquence : le lien mène à `/missions/<mission>?sequence=<id>` (écran Pipeline), sans `panneau` ni `contacter` (la garde de rechargement de `ContactPanel` renvoie sur « Contactés » un mode Contacter ouvert sans sélection). `sequence` est un paramètre local de la mission, comme `contacter` : hors de `V3_PARAM`, hors de `PANEL_PARAMS`. Le Pipeline affiche une ligne d'indication tant que rien n'est coché. `ContactPanel` le lit et le passe à `ContactFlow` (`preferredSequenceId`), il est retiré quand le mode Contacter est quitté. Une séquence demandée qui n'est pas dans le menu (en pause, sans étape, hors de la vue) n'est jamais remplacée en silence par une autre : aucune séquence choisie et une phrase. Séquence sans mission : le lien reste `/sourcing`.

D7. Carte Maintenant : `PipelineScreen` appelle `openContactFlow()` après avoir posé la sélection des retenus, interrupteur allumé et au moins un retenu. Éteint : l'ancien geste (focus sur le bouton de la barre).

D8. « Retenir sans contacter » dans la feuille : la feuille reste ouverte (comme le panneau du Pipeline) mais l'appelant est prévenu par `onChanged` pour relire ses statuts.

D9. Distance de réseau : les profils vivants de la recherche gardent `network_distance` et `provider_id` (parité avec l'ancien bouton, y compris les Retenus réhydratés). Limite connue, non aggravée.

## 3. Interfaces

### 3.1 `src/components/sequences/contact/types.ts`

```ts
export interface FlowCandidate extends FlowEntryInput {
  id: string;                    // profile.id
  rowId: string | null;          // ligne du Pipeline, null pour un profil sans ligne
  candidateId: string | null;
  headline: string | null;
  pictureUrl: string | null;
  profile: LinkedInProfile;
}

/** Avertissement du point d'entrée : texte fixe, ou calculé à partir des étapes de la séquence choisie. */
export type FlowNotice = string | ((steps: readonly SequenceStepRow[]) => string | null);

export interface ContactFlowProps {
  missionId: string | null;
  job: SequenceEnrollJob | null;
  candidates: readonly FlowCandidate[];
  candidatesStatus: FlowCandidatesStatus;
  overflow?: number;                               // défaut 0
  refreshing?: boolean;
  onRetryCandidates?: () => void;                  // absent : pas de bouton « Réessayer »
  onEnrolled: (handledIds: readonly string[]) => void;   // rowId ?? id
  onOpenCandidate?: (rowId: string) => void;       // absent ou rowId nul : pas de bouton « Ouvrir la fiche »
  onLeave: () => void;
  // 5f-2d, tous facultatifs, défaut = comportement de 5f-2c
  accountId?: string | null;                       // compte d'envoi imposé
  notice?: FlowNotice | null;
  leaveLabel?: string | null;                      // défaut « Voir les contactés » ; null : pas de bouton
  emptyHint?: string;                              // défaut « Cochez des candidats dans la liste, puis « Contacter ». »
  onBusyChange?: (busy: boolean) => void;          // vrai pendant l'écriture
  onChanged?: () => void;                          // la fenêtre de relecture a retenu sans inscrire
  preferredSequenceId?: string | null;             // séquence proposée d'avance (page séquence)
}
```

`ContactPanel.tsx` garde sa balise `<ContactFlow ...>` telle quelle, plus `preferredSequenceId` (lot D). Le test 5F2C-P8 fige cette balise : le test est mis à jour avec la nouvelle prop, aucune autre prop n'est ajoutée.

### 3.2 Modifications de ContactFlow

| Lieu | Changement |
|---|---|
| props | déstructurer les nouvelles props avec leurs défauts |
| compte | `useFilteredLinkedInAccounts()` reste appelé ; `accountId = imposedAccountId ?? selectedAccount` ; `accountsLoading` ne bloque que sans compte imposé |
| `job.title` | `job?.title ?? null` |
| `openSequence` | sans mission : `` `${sequencePath(selectedId)}?onglet=candidats` ``, avec mission : la ligne actuelle, telle quelle |
| clé de sortie | `candidate.rowId ?? candidate.id` à la fin de `handleEnroll` et de `handleReviewDone` |
| `handleReviewDone` | aucun inscrit : `retryEligibility()` puis `onChanged?.()` |
| portes | `LeaveButton` sans libellé : absent ; « Réessayer » seulement avec `onRetryCandidates` ; `emptyHint` |
| notice | calculée hors des hooks de portes, affichée en `role="note"` sous le sélecteur de séquence, transmise à `EnrollmentPreviewModal` (`notice`) |
| occupé | effet `onBusyChange?.(enrolling)` avant les portes |
| séquence demandée | `useState(preferredSequenceId ?? null)` ; si le choix est la séquence demandée et qu'elle n'est pas dans le menu : `selected` vaut `null` et une phrase l'explique (pas de repli sur `menu.pick`) |

Ne bougent pas : l'ordre des cinq portes (E7), l'appel `enrollCandidates({ ... })` (E2), `refreshing = false`, `retryEligibility(); sequencesRead.refetch();`.

### 3.3 Autres fichiers de `contact/`

- `useContactSequences.ts` : `enabled: !!organizationId` (la clé garde `missionId`).
- `SequencePicker.tsx` : `missionId: string | null`. Sans mission : état vide « Aucune séquence prête à l'emploi dans votre organisation. », aucune porte « Rédiger », libellé de menu « Séquences de l'organisation ». Le littéral « Autres séquences de l'organisation » reste dans le source. Aucun import ajouté (liste blanche C3), exactement deux balises `<a`.
- `RecipientGroups.tsx` : `onOpenCandidate?` optionnel, bouton seulement si `onOpenCandidate && entry.source.rowId`. La ligne `onClick={() => onOpenCandidate(entry.source.rowId)}` reste littérale (C8).
- `flowCandidates.ts` (nouveau, pur) :

```ts
export const FLOW_MAX = 400;
export function profileToFlowCandidate(profile: LinkedInProfile, options?: { rowId?: string | null; hasLinkedIn?: boolean }): FlowCandidate;
// id = profile.id ; candidateId = profile.id ; rowId = options.rowId ?? null ;
// hasLinkedIn = options.hasLinkedIn ?? !!(profile.profile_url || profile.public_profile_url) ;
// name = profile.name, sinon prénom et nom, sinon « Profil sans nom » ; headline, pictureUrl = profile.profile_picture_url.
export function profilesToFlowCandidates(profiles: readonly LinkedInProfile[]): { candidates: FlowCandidate[]; overflow: number };
// dédoublonné par id (ordre gardé), coupé à FLOW_MAX, overflow = reste.
```

- `ContactFlowSheet.tsx` (nouveau) :

```ts
export interface ContactFlowSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;                 // défaut « Prise de contact »
  subtitle?: string | null;
  above?: ReactNode;              // entre l'en-tête et le flux (Select de mission de la messagerie)
  missionId: string | null;
  job: SequenceEnrollJob | null;
  candidates: readonly FlowCandidate[];   // figés par l'appelant à l'ouverture
  overflow?: number;
  accountId?: string | null;
  notice?: FlowNotice | null;
  preferredSequenceId?: string | null;
  emptyHint?: string;
  onEnrolled: (handledIds: readonly string[]) => void;   // la feuille se ferme après
  onChanged?: () => void;
  onOpenCandidate?: (rowId: string) => void;
}
export function ContactFlowSheet(props: ContactFlowSheetProps): JSX.Element;
```

Mécanique : `Sheet` côté droit (`w-full sm:max-w-md`, `hideClose`), en-tête calqué sur `ContactPanel` (titre avec `tabIndex={-1}` qui reçoit le focus à l'ouverture, croix de 44 px sur téléphone, `aria-label="Fermer le panneau"`), corps défilant, `SectionErrorBoundary`, `candidatesStatus="ready"`, `leaveLabel={null}`, `onLeave` ferme. Fermeture refusée pendant l'écriture (`onBusyChange`). `onEnrolled` informe l'appelant puis ferme (sans passer par le garde d'occupation).

### 3.4 `SequenceEnrollButton`

```ts
onSuccess?: (enrolledProfileIds?: readonly string[]) => void;
```

Interrupteur allumé : le bouton (mêmes classes, même `title`, même icône, sans chevron) ouvre `ContactFlowSheet` ; `missionId = missionIdOf(selectedJob)`, `job = selectedJob`, `accountId` du bouton, profils figés par `profilesToFlowCandidates`, pas de `onOpenCandidate`. `onEnrolled(ids)` appelle `onSuccess(ids)` ; `onChanged` appelle `onSuccess([])`. Interrupteur éteint : le composant actuel, déplacé tel quel dans un composant interne (`LegacySequenceEnrollButton`), le littéral `quiet = false` et `variant={quiet ? 'ghost' : 'outline'}` restent dans le fichier. Le bouton rend aussi la feuille ouverte quand la sélection tombe à vide (la feuille ne disparaît pas sous les mains de la personne).

`LinkedInSearch.handleSequenceEnrollSuccess(enrolledIds?)` : avec des identifiants, retire de la sélection ces seuls profils (`dropFromSelection`) ; sans argument (ancien flux), vide la sélection comme avant. Dans les deux cas : `invalidateQueries(['job-candidate-status'])`, `candidateStatus.refresh()`, `refreshProjectEnrollments()`. Les types `onSequenceEnrollSuccess` de `SearchResultsPanel` et `SourcingResultsV3` passent à `(enrolledIds?: readonly string[]) => void`.

### 3.5 Messagerie

`src/components/outreach/inbox/InboxContactSheet.tsx` (nouveau), monté par `MessagesInbox.tsx` sous `useSequencesBeta()` (jamais dans `pages/Inbox.tsx`). L'ancien bloc (Dialog « Choisir une séquence », `SequenceEnrollModal`) reste verbatim dans la branche éteinte. Rien entre `const externalCounts =` et `const { addReaction` (tranche évaluée par `messagerie-onglets`). Le candidat est construit sur des valeurs simples (identifiant, nom, titre, adresse, photo, distance), `hasLinkedIn = !!identifiant`. Sans identifiant ou sans compte : une phrase et un bouton Fermer à la place du flux (fin de l'impasse silencieuse). `onEnrolled` : ferme et relit `inbox.fetchEnrollments()`. Aucune mention de `/sequences` dans le nouveau fichier.

Avertissement : `"Relation LinkedIn non vérifiée : si vous êtes déjà en relation, l'invitation sera sautée."` quand la distance du candidat est inconnue et que la séquence choisie a une étape d'invitation. Fonction pure `unverifiedRelationNotice(steps, distance)` testée sous Node.

### 3.6 Page séquence et Maintenant

- `src/lib/sequencesBeta.ts` : `sequenceEnrollPath(sequence: { id; project_id }): string` rend `missionV3Path(mission, 'pipeline', { sequence: id })` avec la mission nue (`bareMissionId`), sinon `/sourcing`. `SequenceDetailPage` la calcule une fois et la passe aux deux sites (`SequenceHeader` et `CandidatesTab`).
- `SEQUENCE_PARAM = 'sequence'` : lu par `PipelineScreen` (indication, interrupteur allumé, mission non archivée, aucune ligne cochée) et par `ContactPanel` (prop `preferredSequenceId`, seulement en mode Contacter). Retiré dans `setTab` de `ContactPanel`, à une place qui garde le motif de 5F2C-P9.
- Indication : « Cochez les candidats à inscrire, puis « Contacter » : la séquence demandée sera proposée d'avance. »
- `PipelineScreen` : `const { openContactFlow } = ctx;` ; fin de l'effet des retenus : `if (sequencesV2 && picked.length > 0) openContactFlow(); else setFocusContact(picked.length > 0);` (dépendances mises à jour).

## 4. Tests

À adapter : `lot5f2c-plomberie` (P3 : `openContactFlow` apparaît une fois dans `PipelineScreen`, P8 : balise `ContactFlow` avec `preferredSequenceId`, P9 : place du retrait de `sequence`), `lot5f2c-ecran` (E8 : branche hors mission avant la ligne `navigate` conservée), `lot5f2c-composants` (C9 et états vides si leur texte change), `tests/c1/lot3-ecrans` (titre et commentaire de la carte Maintenant), `e2e/flows/mission-now.spec.ts` cas 3a (panneau ouvert, et doublon `?sequences-v2=0` pour le focus), `e2e/flows/seq-v2-suivi.spec.ts` (adresse du lien), et les e2e qui cliquaient le menu « Séquence » avec l'interrupteur par défaut.

À écrire : `tests/ux/lot5f2d-generalisation.test.mjs` (sept sites nuls de ContactFlow, SequencePicker sans mission, RecipientGroups sans ligne, adaptateur, feuille), `tests/ux/lot5f2d-entrees.test.mjs` (bouton, `LinkedInSearch`, messagerie, page séquence, renommage), `e2e/flows/seq-v2-contacter.spec.ts` (page séquence vers Pipeline, feuille du Sourcing, messagerie si le faux transport le permet), ajouts à `.github/workflows/ci.yml` (job Node 22).

## 5. Limites connues, non traitées

- `strict` est faux dans `tsconfig.app.json` : le ratchet tsc ne voit aucun accès nul. Les sites nuls de ContactFlow sont protégés par des tests de comportement.
- Les cartes de résultat n'appellent pas `onSequenceEnroll` : le badge « En séquence » d'une carte reste périmé après une inscription depuis cette carte (écart d'avant le lot).
- Profil mince de la messagerie : la ligne créée par la règle Retenu porte un profil réduit (écart d'avant le lot).
- Mission avec `job_id` d'un ancien format : `missionIdOf` rend `null`, les séquences ne sont pas groupées par mission dans la feuille.
- Une séquence choisie est perdue si la personne quitte la feuille (« Ouvrir la fiche » n'existe pas dans la feuille).
- Les gardes de l'ancien flux de la messagerie (lot1, f4b, f4-final, lot13, lot6a) ne tournent pas dans la CI ; `seq-audit-f4b` SEQ-145 est déjà rouge avant ce lot.
