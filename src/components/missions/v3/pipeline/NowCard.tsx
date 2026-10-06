// Refonte mission, lot 3 : la carte « Maintenant » en tête de l'écran Pipeline,
// au-dessus des deux vues (conception 4.2, zone 2) et sa ligne « Ensuite ».
//
// Une carte, une action : la phrase (noms et nombres), un seul bouton plein, et
// deux petits liens. Design simplifié (retour du 04/10/2026, « trop chargé ») :
// ce qui explique l'action (ce que l'on propose, la donnée qui la justifie, la
// règle appliquée, la liste « Ensuite », ce qui n'est pas suivi) ne s'affiche
// qu'à la demande, sous « Pourquoi maintenant ? ». « Plus tard » reporte
// l'action au lendemain matin, pour la personne seulement, et fait monter la
// suivante ; il n'écrit jamais dans les notifications ni sur le chiffre
// d'À traiter. Une source qui ne répond pas est dite « indisponible » avec
// « Réessayer », jamais lue comme zéro. Pas de barre fixe sur téléphone (lot 10).
//
// Accessibilité : région nommée, zone annoncée présente dès le montage (aria-live
// poli), focus gardé dans la carte après « Plus tard » (sur le titre si le
// bouton a disparu), « Plus tard » grisé sans perdre le focus pendant l'écriture.

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ListChecks, RefreshCw, Search, Send, FileText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { HourglassIcon, TypingIcon } from '@/components/ui/animated-icons';
import { IconTile } from '@/components/ui/IconTile';
import { texturedCard } from '@/components/layout/texturedCard';
import { Skeleton } from '@/components/ui/skeleton';
import { useMissionNow } from '@/hooks/useMissionNow';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { LATER_LABEL, RESUME_LABEL, WHY_LABEL, type ActionIntent, type NextAction, type RankId } from '@/lib/missionNextAction';
import { cn } from '@/lib/utils';
import { ThenLine } from './ThenLine';

/** Bande douce, sans filet : la carte se distingue du fond sans second cadre (design simplifié, règle 3). */
const CARD = 'rounded-xl bg-muted/50 px-4 py-3.5 sm:px-5';
/** Carte de l'action à faire : texturée (bleue, chaude quand quelque chose bloque), même gabarit que la bande. */
const ACTION_CARD = 'rounded-xl px-4 py-3.5 sm:px-5';
/** Bouton grisé sans quitter l'ordre de tabulation : le focus reste dessus pendant l'écriture (libellé gris, sans opacité). */
const SOFT_DISABLED = 'aria-disabled:pointer-events-none aria-disabled:text-muted-foreground';
/** Cible de 44 px sur téléphone. */
const TOUCH = 'max-sm:min-h-11';

interface NowCardProps {
  project: SourcingProject;
  /** Mission de l'organisation active : sinon aucune carte. */
  isOwnMission: boolean;
  /** L'écran traduit l'intention d'un bouton en geste (fiche, panneau, navigation). */
  onIntent: (intent: ActionIntent) => void;
}

/** Ce qui doit se passer à l'arrivée du résultat suivant, après un « Plus tard » ou un « Les reprendre ». */
interface Pending {
  kind: 'later' | 'resume';
  /** Signature de la carte au moment du geste ; un résultat différent déclenche le focus et l'annonce. */
  from: string;
}

function signatureOf(state: string, main: NextAction | null): string {
  return `${state}|${main?.key ?? ''}`;
}

function CardLoading() {
  return (
    <div className={cn(CARD, 'flex flex-col gap-3 sm:flex-row sm:items-center')} aria-busy="true" data-testid="now-card-loading">
      <div className="flex flex-1 items-center gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
        <Skeleton className="h-5 w-3/4" />
      </div>
      <Skeleton className="h-10 w-full sm:w-36" />
    </div>
  );
}

/** Icône de la pastille : celle qui bouge annonce une personne qui attend (réponse, entretien sans nouvelles). Le ton dit l'urgence par la couleur de la carte, pas par la pastille. */
function RankTile({ rank }: { rank: RankId }) {
  const STATIC: Partial<Record<RankId, LucideIcon>> = { '0': AlertTriangle, '7': Send, '8': ListChecks, '8b': Search, '10': Search, '11': FileText };
  const Icon = STATIC[rank];
  return (
    <IconTile tone="default" size="md" aria-hidden="true" icon={Icon}>
      {rank === '3' ? <TypingIcon className="size-5" /> : rank === '6' ? <HourglassIcon className="size-5" /> : null}
    </IconTile>
  );
}

export function NowCard({ project, isOwnMission, onIntent }: NowCardProps): JSX.Element | null {
  const { result, online, busy, retry, snooze, resume } = useMissionNow({ project, isOwnMission });
  const { state, main } = result;
  const signature = signatureOf(state, main);

  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pending = useRef<Pending | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [whyOpen, setWhyOpen] = useState(false);

  // « Pourquoi maintenant ? » se replie quand l'action change.
  const mainKey = main?.key ?? null;
  useEffect(() => {
    setWhyOpen(false);
  }, [mainKey]);

  // Après un report ou une reprise : la carte a changé. Le focus reste dans la
  // carte (le bouton cliqué a pu disparaître) et la nouvelle action est annoncée.
  useEffect(() => {
    const p = pending.current;
    if (!p || p.from === signature) return;
    pending.current = null;
    const active = document.activeElement;
    if (!active || active === document.body || !sectionRef.current?.contains(active)) {
      titleRef.current?.focus({ preventScroll: true });
    }
    const next = state === 'action' && main ? `Maintenant : ${main.phrase}` : result.stateLine ?? '';
    setAnnouncement(`${p.kind === 'later' ? 'Reporté à demain.' : 'Actions reprises.'} ${next}`.trim());
  }, [signature, state, main, result.stateLine]);

  if (state === 'hidden') return null;

  // Une écriture réussie qui ne change pas la carte (rien à annoncer) ne laisse pas d'annonce en attente.
  const settle = () => {
    window.setTimeout(() => {
      pending.current = null;
    }, 1500);
  };

  const later = async () => {
    if (!main || main.snoozeKey === null || busy || !online) return;
    pending.current = { kind: 'later', from: signature };
    // Erreur d'écriture : le message est déjà affiché, l'action reste.
    if (!(await snooze(main))) pending.current = null;
    else settle();
  };

  const resumeAll = async () => {
    if (busy || !online) return;
    pending.current = { kind: 'resume', from: signature };
    if (!(await resume(result.snoozedKeys))) pending.current = null;
    else settle();
  };

  const button = main?.button ?? null;
  const mail = button !== null && button.intent.type === 'mailto';

  return (
    <section ref={sectionRef} data-testid="now-card" aria-labelledby="now-card-title" className="space-y-2">
      <h2
        id="now-card-title"
        ref={titleRef}
        tabIndex={-1}
        className="sr-only"
      >
        Maintenant
      </h2>
      {/* Zone annoncée présente dès le montage : la première annonce est lue. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {state === 'loading' && <CardLoading />}

      {state === 'action' && main && (
        <Collapsible open={whyOpen} onOpenChange={setWhyOpen} className={texturedCard(main.rank === '0' ? 'warm' : 'teal', ACTION_CARD)}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <RankTile rank={main.rank} />
              <div className="min-w-0 flex-1">
                <p className="text-md font-semibold text-foreground">
                  {main.rank === '0' && <span className="sr-only">Blocage : </span>}
                  {main.phrase}
                </p>
                {main.summary && (
                  <p className="mt-0.5 text-sm text-foreground-secondary">
                    <span className="font-medium text-foreground">Résumé : </span>
                    {main.summary}
                  </p>
                )}
                <div className="-ml-2.5 mt-0.5 flex flex-wrap items-center gap-x-1">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className={TOUCH}>
                      {WHY_LABEL}
                      <ChevronDown
                        className={cn('h-3.5 w-3.5 transition-transform duration-150', whyOpen && 'rotate-180')}
                        aria-hidden="true"
                      />
                    </Button>
                  </CollapsibleTrigger>
                  {main.snoozeKey !== null && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-disabled={busy || !online}
                      title={online ? 'Retire cette action de votre vue jusqu\'à demain matin' : undefined}
                      onClick={() => void later()}
                      className={cn(TOUCH, SOFT_DISABLED)}
                    >
                      {LATER_LABEL}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {button && (
              <Button
                type={mail ? undefined : 'button'}
                variant="primary"
                size="lg"
                asChild={mail}
                className="w-full max-sm:h-11 sm:w-auto sm:shrink-0"
                onClick={mail ? undefined : () => onIntent(button.intent)}
              >
                {button.intent.type === 'mailto' ? <a href={button.intent.href}>{button.label}</a> : button.label}
              </Button>
            )}
          </div>
          {!online && main.snoozeKey !== null && (
            <p className="mt-2 text-xs text-muted-foreground">Hors ligne : « {LATER_LABEL} » n'est pas disponible. Réessayez à la reconnexion.</p>
          )}

          <CollapsibleContent>
            {/* `why` reprend déjà la donnée (`detail`) : on ne l'écrit pas deux fois. Lignes de 65 caractères au plus. */}
            <div className="mt-3 max-w-[65ch] space-y-3 border-t border-border pt-3 text-sm text-foreground-secondary">
              <p className="text-foreground">{main.proposal}</p>
              <p className="text-muted-foreground">{main.why}</p>
              <ThenLine actions={result.then} loading={result.thenLoading} onRun={onIntent} />
              <p className="text-muted-foreground">{`Non suivi : ${result.unmonitoredLine}`}</p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {(state === 'clear' || state === 'all_snoozed') && (
        <div className={CARD}>
          <p className="text-md font-semibold text-foreground">{result.stateLine}</p>
          {state === 'all_snoozed' ? (
            <div className="mt-2 -ml-2.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-disabled={busy || !online}
                onClick={() => void resumeAll()}
                className={cn(TOUCH, SOFT_DISABLED)}
              >
                {RESUME_LABEL}
              </Button>
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{result.unmonitoredLine}</p>
          )}
        </div>
      )}

      {result.unavailableLine && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/50 px-3 py-2"
        >
          <p className="text-sm text-muted-foreground">{result.unavailableLine}</p>
          <Button variant="outline" size="xs" onClick={retry} className={TOUCH}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Réessayer
          </Button>
        </div>
      )}
    </section>
  );
}
