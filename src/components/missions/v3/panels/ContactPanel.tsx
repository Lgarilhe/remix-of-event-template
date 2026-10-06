// Refonte mission, lot 1 : panneau Prise de contact (conception 5.3, accès
// provisoire). Les séquences de la mission et les invitations, avec les
// composants d'aujourd'hui tels quels (SequencesList, InvitationsPanel). Pas de
// bandeau « candidats Go » ni de chiffres d'inscriptions : la conception les
// retire. MissionOutreach reste pour l'ancienne page.
// En-tête : titre, poste et client ; pied collé en bas : comment contacter.
import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { EmptyLinkedInAccountState } from '@/components/missions/EmptyLinkedInAccountState';
import { SequencesList } from '@/components/outreach/SequencesList';
import { InvitationsPanel } from '@/components/outreach/InvitationsPanel';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { useOrganization } from '@/hooks/useOrganization';
import { cn } from '@/lib/utils';
import { useMissionV3 } from '../MissionV3Context';
import { ArchivedNotice } from '../shell/ArchivedNotice';
import { PANEL_FULLSCREEN_QUERY, useMediaQuery } from '../shell/useMediaQuery';
import type { ContactPanelProps } from '../types';

type ContactTab = 'sequences' | 'invitations';

const TABS: readonly { key: ContactTab; label: string }[] = [
  { key: 'sequences', label: 'Séquences' },
  { key: 'invitations', label: 'Invitations' },
];

/** Paramètre d'onglet repris de l'ancienne vue Prise de contact. */
const OUTREACH_PARAM = 'outreach';

export function ContactPanel({ titleId, onClose }: ContactPanelProps): JSX.Element | null {
  const { project, isArchived } = useMissionV3();
  const { organizationId } = useOrganization();
  const { accounts, accountsLoading, selectedAccount, setSelectedAccount } = useFilteredLinkedInAccounts();
  const navigate = useNavigate();
  const location = useLocation();
  const baseId = useId();
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  // Panneau plein écran (sous lg) : le bandeau « Réactiver » de la page est derrière lui, inerte.
  const fullscreen = useMediaQuery(PANEL_FULLSCREEN_QUERY);

  const [tab, setTabState] = useState<ContactTab>(() =>
    new URLSearchParams(location.search).get(OUTREACH_PARAM) === 'invitations' ? 'invitations' : 'sequences',
  );

  // L'onglet suit l'adresse (?outreach=invitations), par remplacement et sans
  // perdre le marqueur d'historique du panneau (Retour le ferme toujours).
  const setTab = useCallback(
    (next: ContactTab) => {
      setTabState(next);
      const params = new URLSearchParams(location.search);
      if (next === 'sequences') params.delete(OUTREACH_PARAM);
      else params.set(OUTREACH_PARAM, next);
      const query = params.toString();
      const to = `${location.pathname}${query ? `?${query}` : ''}`;
      if (to !== `${location.pathname}${location.search}`) navigate(to, { replace: true, state: location.state });
    },
    [location.pathname, location.search, location.state, navigate],
  );

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length];
    setTab(next.key);
    buttons.current[next.key]?.focus();
  };

  let body: JSX.Element;
  if (isArchived) {
    body = (
      <div className="px-4 py-4 sm:px-5">
        <ArchivedNotice
          text="La prise de contact est fermée. Réactivez la mission pour gérer ses séquences et ses invitations."
          withAction={fullscreen}
        />
      </div>
    );
  } else if (accountsLoading) {
    body = (
      <div className="space-y-3 px-4 py-4 sm:px-5" aria-busy="true" aria-label="Chargement des comptes LinkedIn">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  } else if (accounts.length === 0) {
    body = (
      <div className="px-4 py-4 sm:px-5">
        <EmptyLinkedInAccountState message="Pour gérer vos séquences, reliez d'abord un compte LinkedIn." />
      </div>
    );
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          role="tablist"
          aria-label="Prise de contact"
          className="sticky top-0 z-10 flex shrink-0 gap-1 border-b border-border bg-background px-3 sm:px-4"
        >
          {TABS.map((item, index) => {
            const selected = item.key === tab;
            return (
              <button
                key={item.key}
                ref={(el) => {
                  buttons.current[item.key] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${item.key}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${item.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(item.key)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                className={cn(
                  'relative h-10 shrink-0 px-2.5 text-sm transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  selected ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {item.label}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-colors duration-150',
                    selected ? 'bg-brand' : 'bg-transparent',
                  )}
                />
              </button>
            );
          })}
        </div>
        {/* Les deux onglets restent montés : changer d'onglet ne perd ni la liste ni un brouillon. */}
        <div
          role="tabpanel"
          id={`${baseId}-panel-sequences`}
          aria-labelledby={`${baseId}-tab-sequences`}
          hidden={tab !== 'sequences'}
          className="min-w-0 px-4 py-4 sm:px-5"
        >
          <SectionErrorBoundary fallbackTitle="Les séquences n'ont pas pu s'afficher">
            <SequencesList
              accounts={accounts}
              selectedAccount={selectedAccount}
              isVisible={tab === 'sequences'}
              projectId={project.id}
              createRequestId={0}
              layout="compact"
            />
          </SectionErrorBoundary>
        </div>
        <div
          role="tabpanel"
          id={`${baseId}-panel-invitations`}
          aria-labelledby={`${baseId}-tab-invitations`}
          hidden={tab !== 'invitations'}
          className="min-w-0 px-4 py-4 sm:px-5"
        >
          <SectionErrorBoundary fallbackTitle="Les invitations n'ont pas pu s'afficher">
            <InvitationsPanel
              accounts={accounts}
              selectedAccount={selectedAccount}
              onAccountChange={setSelectedAccount}
              organizationId={organizationId || null}
            />
          </SectionErrorBoundary>
        </div>
      </div>
    );
  }

  const subtitle = [project.job_details?.title || project.name, project.client_name].filter(Boolean).join(' · ');

  return (
    <div className="flex min-h-full min-w-0 flex-col">
      <div className="flex min-h-[52px] shrink-0 items-center gap-2 border-b border-border py-2 pl-5 pr-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={titleId} tabIndex={-1} className="text-md font-semibold leading-tight text-foreground outline-none">
            Prise de contact
          </h2>
          {subtitle && (
            <span title={subtitle} className="truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Fermer le panneau"
          title="Fermer (Échap)"
          className="min-h-11 min-w-11 shrink-0 lg:min-h-0 lg:min-w-0"
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {body}
      {!isArchived && (
        <div className="sticky bottom-0 mt-auto flex shrink-0 items-start gap-2 border-t border-border bg-background px-5 py-3.5 text-xs text-muted-foreground">
          <Info className="mt-px h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
          <span>Pour contacter des candidats, cochez-les dans la liste puis « Contacter ».</span>
        </div>
      )}
    </div>
  );
}
