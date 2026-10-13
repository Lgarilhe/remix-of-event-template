// Refonte mission, lot 5f-2c : les candidats du panneau Contacter, en trois
// groupes (Prêts, À compléter, Exclus) avec la raison écrite en toutes lettres.
//
// Présentation seulement : ce composant ne lit aucune donnée et n'écrit rien.
// Les groupes viennent de classifyContactEntries (src/lib/contactFlowGroups.ts),
// les dérogations sont tenues par le conteneur (ContactFlow), qui reçoit
// onToggleOverride. Une catégorie dérogée fait passer ses candidats dans Prêts :
// elle n'apparaît plus dans Exclus, d'où le lien « Annuler la dérogation ».
import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { OVERRIDE_LABEL } from '@/lib/contactFlowGroups';
import type { ContactEntry, ContactGroups, ContactOverride } from '@/lib/contactFlowGroups';
import { cn } from '@/lib/utils';
import type { FlowCandidate } from './types';

type GroupKey = 'ready' | 'incomplete' | 'excluded';

interface RecipientGroupsProps<T extends FlowCandidate> {
  groups: ContactGroups<T>;
  /** Seuls les propriétaires et les administrateurs peuvent inscrire un contact récent. */
  canOverrideRecent: boolean;
  /** Catégories de dérogation choisies. */
  overrides: ReadonlySet<ContactOverride>;
  onToggleOverride: (override: ContactOverride) => void;
  /** Ouvre la fiche d'un candidat avec ligne (lien LinkedIn à compléter). Absent, ou candidat sans ligne : pas de bouton. */
  onOpenCandidate?: (rowId: string) => void;
  /**
   * Faux pour une séquence à message rédigé par l'IA : l'inscription passe par « Relire les
   * messages », dont la fenêtre propose ses propres dérogations. Aucun bouton ici, une phrase le dit.
   */
  overridesEnabled?: boolean;
}

const TOUCH = 'max-lg:min-h-11';

/** Au-delà de ce nombre de candidats prêts, la section Prêts démarre repliée. */
const READY_OPEN_MAX = 5;

const GROUP_TITLE: Record<GroupKey, string> = {
  ready: 'Prêts',
  incomplete: 'À compléter',
  excluded: 'Exclus',
};

const AI_REVIEW_SENTENCE =
  "Cette séquence contient des messages rédigés par l'IA Konekt pour chaque candidat. Relisez-les avant l'inscription.";
const RECENT_ADMINS_ONLY = 'Seuls les propriétaires et administrateurs peuvent les inscrire quand même.';
const OVERRIDE_IN_REVIEW = 'Vous pourrez les inclure depuis « Relire les messages ».';
const RECENT_SUBTITLE = 'Déjà contactés depuis moins de 90 jours';
const ENROLLED_ANYWAY = 'Inscrit quand même';
const INCLUDED_ANYWAY = 'Inclus quand même';
const UNDO_OVERRIDE = 'Annuler la dérogation';

/** Ce que la dérogation d'une catégorie lève, pour nommer le lien d'annulation. */
const OVERRIDE_SUBJECT: Record<ContactOverride, string> = {
  recent_contact: 'contacts de moins de 90 jours',
  incompatible: 'candidats incompatibles avec la séquence',
};

const OVERRIDE_ORDER: readonly ContactOverride[] = ['recent_contact', 'incompatible'];

/** Ordre des raisons dans Exclus : celles qui offrent une dérogation d'abord, pour que le bouton soit sous les yeux. */
const EXCLUDED_ORDER: readonly string[] = [
  'recent_contact',
  'too_far',
  'connection_only',
  'in_sequence',
  'passed_sequence',
  'erased',
];

interface ReasonBlock<T extends FlowCandidate> {
  reason: string;
  subtitle: string;
  entries: ContactEntry<T>[];
}

function excludedByReason<T extends FlowCandidate>(entries: readonly ContactEntry<T>[]): ReasonBlock<T>[] {
  const byReason = new Map<string, ContactEntry<T>[]>();
  for (const entry of entries) {
    const key = entry.reason ?? 'other';
    const list = byReason.get(key);
    if (list) list.push(entry);
    else byReason.set(key, [entry]);
  }
  const rank = (reason: string): number => {
    const index = EXCLUDED_ORDER.indexOf(reason);
    return index === -1 ? EXCLUDED_ORDER.length : index;
  };
  return [...byReason.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([reason, list]) => ({
      reason,
      // Le libellé d'un contact récent nomme la personne et la date : il reste sur la ligne.
      subtitle: reason === 'recent_contact' ? RECENT_SUBTITLE : list[0].label ?? '',
      entries: list,
    }));
}

interface CandidateRowProps {
  source: FlowCandidate;
  /** « Inscrit quand même » ou « Inclus quand même » : une raison a été levée. */
  note: string | null;
  /** Raison écrite sous le nom, ou null quand le sous-titre la dit déjà. */
  reason: string | null;
  action?: ReactNode;
}

function CandidateRow({ source, note, reason, action }: CandidateRowProps): JSX.Element {
  return (
    <li data-contact-row={source.id} className="flex items-start gap-3 py-3">
      <PersonAvatar name={source.name} src={source.pictureUrl} candidateId={source.candidateId} size={32} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{source.name}</p>
            {source.headline && <p className="truncate text-xs text-muted-foreground">{source.headline}</p>}
          </div>
          {action}
        </div>
        {(note || reason) && (
          <p className="mt-1 text-xs text-muted-foreground">
            {note && <span className="font-medium text-warning">{note}</span>}
            {note && reason ? ' · ' : null}
            {reason}
          </p>
        )}
      </div>
    </li>
  );
}

interface SectionProps {
  headingId: string;
  bodyId: string;
  groupKey: GroupKey;
  count: number;
  open: boolean;
  onToggle: () => void;
  /** Toujours visible, sous le titre (annulation d'une dérogation). */
  pinned?: ReactNode;
  /** Visible quand la section est ouverte, au-dessus de la liste (phrase d'explication). */
  intro?: ReactNode;
  /** Toujours visible, sous la liste (informations sur les candidats prêts). */
  after?: ReactNode;
  /** Défilement interne de la liste (faux quand chaque bloc défile seul). */
  scroll?: boolean;
  children: ReactNode;
}

function Section({ headingId, bodyId, groupKey, count, open, onToggle, pinned, intro, after, scroll = true, children }: SectionProps): JSX.Element {
  return (
    <section data-contact-group={groupKey} aria-labelledby={headingId}>
      <h4 id={headingId} className="text-sm font-semibold text-foreground">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
          className={cn('-ml-2.5 h-auto justify-start gap-1.5 text-sm font-semibold', TOUCH)}
        >
          {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          <span>{`${GROUP_TITLE[groupKey]} (${count})`}</span>
        </Button>
      </h4>
      {pinned}
      {open && (
        <div id={bodyId}>
          {intro}
          <div className={scroll ? 'max-h-64 overflow-y-auto' : undefined}>{children}</div>
        </div>
      )}
      {after}
    </section>
  );
}

export function RecipientGroups<T extends FlowCandidate>({
  groups,
  canOverrideRecent,
  overrides,
  onToggleOverride,
  onOpenCandidate,
  overridesEnabled = true,
}: RecipientGroupsProps<T>): JSX.Element | null {
  const baseId = useId();
  // Un choix de la personne l'emporte ; sinon Prêts s'ouvre ou se replie selon le nombre vu à la première lecture.
  const [chosen, setChosen] = useState<Partial<Record<GroupKey, boolean>>>({});
  const readyStartsOpen = useRef<boolean | null>(null);
  if (readyStartsOpen.current === null && groups.ready.length > 0) {
    readyStartsOpen.current = groups.ready.length <= READY_OPEN_MAX;
  }
  const isOpen = (key: GroupKey): boolean => chosen[key] ?? (key === 'ready' ? readyStartsOpen.current ?? true : true);
  const toggle = (key: GroupKey) => setChosen((prev) => ({ ...prev, [key]: !isOpen(key) }));

  const { ready, incomplete, excluded, notes } = groups;
  if (ready.length === 0 && incomplete.length === 0 && excluded.length === 0) return null;

  // Le lien « Annuler la dérogation » vit dans la première section qui montre des candidats inscrits quand même.
  const anyOverridden = [...ready, ...incomplete].some((entry) => entry.overridden);
  const undoable = anyOverridden
    ? OVERRIDE_ORDER.filter((category) => overrides.has(category) && (category !== 'recent_contact' || canOverrideRecent))
    : [];
  const undoLinks: ReactNode = undoable.length > 0 && (
    <div className="flex flex-wrap items-center gap-x-4">
      {undoable.map((category) => (
        <Button
          key={category}
          type="button"
          variant="link"
          size="xs"
          aria-label={`${UNDO_OVERRIDE} : ${OVERRIDE_SUBJECT[category]}`}
          onClick={() => onToggleOverride(category)}
          className={cn('h-auto p-0 text-xs underline', TOUCH)}
        >
          {UNDO_OVERRIDE}
        </Button>
      ))}
    </div>
  );
  const undoInReady = ready.length > 0;

  const hasAiReview = incomplete.some((entry) => entry.reason === 'ai_review');

  const excludedBlocks = excludedByReason(excluded);
  const firstBlockOf = new Map<ContactOverride, string>();
  const categoryTotal = new Map<ContactOverride, number>();
  for (const block of excludedBlocks) {
    const override = block.entries[0].override;
    if (!override) continue;
    if (!firstBlockOf.has(override)) firstBlockOf.set(override, block.reason);
    categoryTotal.set(override, (categoryTotal.get(override) ?? 0) + block.entries.length);
  }

  return (
    <div className="space-y-5">
      {ready.length > 0 && (
        <Section
          headingId={`${baseId}-ready-title`}
          bodyId={`${baseId}-ready`}
          groupKey="ready"
          count={ready.length}
          open={isOpen('ready')}
          onToggle={() => toggle('ready')}
          pinned={undoInReady ? undoLinks : null}
          after={notes.length > 0 ? (
            <div className="mt-2 space-y-1">
              {notes.map((note) => (
                <p key={note} className="text-xs text-muted-foreground">{note}</p>
              ))}
            </div>
          ) : null}
        >
          <ul className="divide-y divide-border">
            {ready.map((entry) => (
              <CandidateRow
                key={entry.source.id}
                source={entry.source}
                note={entry.overridden ? (entry.reason === 'too_far' || entry.reason === 'connection_only' ? INCLUDED_ANYWAY : ENROLLED_ANYWAY) : null}
                reason={entry.label}
              />
            ))}
          </ul>
        </Section>
      )}

      {incomplete.length > 0 && (
        <Section
          headingId={`${baseId}-incomplete-title`}
          bodyId={`${baseId}-incomplete`}
          groupKey="incomplete"
          count={incomplete.length}
          open={isOpen('incomplete')}
          onToggle={() => toggle('incomplete')}
          pinned={undoInReady ? null : undoLinks}
          intro={hasAiReview ? <p className="mt-1 text-xs text-muted-foreground">{AI_REVIEW_SENTENCE}</p> : null}
        >
          <ul className="divide-y divide-border">
            {incomplete.map((entry) => (
              <CandidateRow
                key={entry.source.id}
                source={entry.source}
                note={null}
                reason={entry.label}
                action={entry.reason === 'no_linkedin' && onOpenCandidate && entry.source.rowId ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    aria-label={`Ouvrir la fiche de ${entry.source.name}`}
                    onClick={() => onOpenCandidate(entry.source.rowId)}
                    className={cn('shrink-0', TOUCH)}
                  >
                    Ouvrir la fiche
                  </Button>
                ) : null}
              />
            ))}
          </ul>
        </Section>
      )}

      {excluded.length > 0 && (
        <Section
          headingId={`${baseId}-excluded-title`}
          bodyId={`${baseId}-excluded`}
          groupKey="excluded"
          count={excluded.length}
          open={isOpen('excluded')}
          onToggle={() => toggle('excluded')}
          scroll={false}
        >
          <div className="divide-y divide-border">
            {excludedBlocks.map((block) => {
              const override = block.entries[0].override;
              // Un seul bouton par catégorie de dérogation, sur son premier bloc : la dérogation lève tous ses blocs.
              const showButton = overridesEnabled && !!override && firstBlockOf.get(override) === block.reason;
              return (
                <div key={block.reason} data-contact-reason={block.reason} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="text-xs font-semibold text-foreground">{`${block.subtitle} (${block.entries.length})`}</h5>
                    {showButton && override && (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        aria-label={`${OVERRIDE_LABEL[override]} : ${OVERRIDE_SUBJECT[override]} (${categoryTotal.get(override) ?? 0})`}
                        onClick={() => onToggleOverride(override)}
                        className={cn('shrink-0', TOUCH)}
                      >
                        {OVERRIDE_LABEL[override]}
                      </Button>
                    )}
                  </div>
                  {block.reason === 'recent_contact' && !canOverrideRecent && (
                    <p className="mt-1 text-xs text-muted-foreground">{RECENT_ADMINS_ONLY}</p>
                  )}
                  {!overridesEnabled && !!override && !(block.reason === 'recent_contact' && !canOverrideRecent) && (
                    <p className="mt-1 text-xs text-muted-foreground">{OVERRIDE_IN_REVIEW}</p>
                  )}
                  <ul className="max-h-64 divide-y divide-border overflow-y-auto">
                    {block.entries.map((entry) => (
                      <CandidateRow
                        key={entry.source.id}
                        source={entry.source}
                        note={null}
                        reason={entry.label && entry.label !== block.subtitle ? entry.label : null}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
