import React, { useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFirstSearch, type PreviewResults } from '@/hooks/onboarding/useFirstSearch';
import type { OnboardingLinkedInAccount } from '@/lib/onboarding/linkedin';
import { CandidateRow } from '../parts/CandidateRow';
import { NavRow } from '../parts/NavRow';
import { SceneHeading } from '../parts/SceneHeading';
import { CountUp } from '../stage/CountUp';
import { SPRING_SOFT } from '../stage/springs';
import { useDelay } from '../stage/useDelay';

interface Props {
  missionId: string;
  account: OnboardingLinkedInAccount;
  results: PreviewResults | null;
  onResults: (results: PreviewResults) => void;
  onWriteFirst: () => void;
  onSkip: () => void;
  onBack: () => void;
  /** Le bureau suit : la loupe cherche pendant l'attente, se pose sur les fiches ensuite. */
  onScanning: (scanning: boolean) => void;
}

const VISIBLE = 6;

/**
 * Les premiers candidats : la vraie recherche, sur le vrai compte, avec les
 * filtres du brief. Les cartes arrivent d'abord, les scores ensuite, et les
 * cartes se réordonnent quand ils tombent.
 */
export const SceneCandidates: React.FC<Props> = ({ missionId, account, results, onResults, onWriteFirst, onSkip, onBack, onScanning }) => {
  const { state, retry } = useFirstSearch({ missionId, account: { id: account.id, subscriptions: account.subscriptions }, initial: results, onResults });

  useEffect(() => {
    onScanning(state.status === 'loading');
  }, [state.status, onScanning]);
  // Quitter la scène pendant la recherche ne laisse pas la loupe tourner sur le bureau.
  useEffect(() => () => onScanning(false), [onScanning]);

  const d = useDelay();
  const ready = state.status === 'ready' ? state.results : null;
  const ordered = useMemo(() => {
    if (!ready) return [];
    const list = ready.candidates.slice(0, VISIBLE);
    if (ready.scoring !== 'done') return list;
    return [...list].sort((a, b) => (ready.scores[b.id]?.score ?? -1) - (ready.scores[a.id]?.score ?? -1));
  }, [ready]);

  const total = ready?.total ?? null;
  const count = ready?.candidates.length ?? 0;

  return (
    <div className="space-y-6">
      {state.status === 'loading' && (
        <>
          <SceneHeading eyebrow="Premiers résultats" title="Je cherche vos premiers candidats." accent={['premiers']}>
            <p>Recherche sur LinkedIn avec les filtres du brief. Quelques secondes.</p>
          </SceneHeading>
          <ul className="space-y-3" aria-busy="true" aria-label="Recherche en cours">
            {[0, 1, 2, 3].map((i) => (
              <motion.li key={i} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_SOFT, delay: d(0.4 + i * 0.1) }} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </motion.li>
            ))}
          </ul>
        </>
      )}

      {state.status === 'error' && (
        <>
          <SceneHeading eyebrow="Premiers résultats" title="La recherche n'a pas abouti." accent={['abouti']}>
            <p>{state.message}</p>
          </SceneHeading>
          <div className="flex flex-wrap gap-2">
            {state.kind !== 'quota' && (
              <Button variant="outline" onClick={() => void retry()}>
                <RefreshCw aria-hidden="true" />
                Réessayer
              </Button>
            )}
            <Button variant="primary" onClick={onSkip}>
              Continuer sans l'aperçu
            </Button>
          </div>
        </>
      )}

      {ready && (
        <>
          {count > 0 ? (
            <header>
              <p className="eyebrow">Premiers résultats</p>
              <h1 className="mt-3 font-brand text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
                {total && total > count ? (
                  <>
                    <CountUp value={total} className="text-brand" /> profils ressemblent à ce poste.
                  </>
                ) : (
                  <>
                    Voici vos <span className="text-brand">premiers candidats</span>.
                  </>
                )}
              </h1>
              <p className="mt-4 max-w-lg text-md text-foreground-secondary" aria-live="polite">
                {ready.scoring === 'pending'
                  ? "L'IA Konekt lit les profils et les note par rapport au brief…"
                  : ready.scoring === 'done'
                    ? 'Classés par adéquation avec votre brief, avec la raison en une ligne.'
                    : `Aperçu des ${count} premiers résultats.`}
              </p>
            </header>
          ) : (
            <SceneHeading eyebrow="Premiers résultats" title="Aucun profil avec ces filtres." accent={['Aucun']}>
              <p>Rien d'anormal : le brief est peut-être trop précis. Vous pourrez l'élargir depuis la mission.</p>
            </SceneHeading>
          )}

          {ordered.length > 0 && (
            <ul className="space-y-2.5" aria-label="Premiers candidats">
              <AnimatePresence initial>
                {ordered.map((c, i) => (
                  <CandidateRow key={c.id} candidate={c} index={i} score={ready.scores[c.id]} scoring={ready.scoring} />
                ))}
              </AnimatePresence>
            </ul>
          )}

          <NavRow
            onBack={onBack}
            onNext={count > 0 ? onWriteFirst : onSkip}
            nextLabel={count > 0 ? 'Voir un premier message' : 'Continuer'}
            skipLabel={count > 0 ? 'Terminer' : undefined}
            onSkip={count > 0 ? onSkip : undefined}
          />
        </>
      )}
    </div>
  );
};
