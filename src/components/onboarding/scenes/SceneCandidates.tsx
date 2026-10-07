import React, { useMemo } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFirstSearch, type PreviewResults } from '@/hooks/onboarding/useFirstSearch';
import type { OnboardingLinkedInAccount } from '@/lib/onboarding/linkedin';
import { CandidateRow } from '../parts/CandidateRow';
import { NavRow } from '../parts/NavRow';
import { SceneHeading } from '../parts/SceneHeading';

interface Props {
  missionId: string;
  account: OnboardingLinkedInAccount;
  results: PreviewResults | null;
  onResults: (results: PreviewResults) => void;
  /** Nombre de compétences retenues au brief et lieu cherché : ce que l'assistant a fait, en toutes lettres. */
  skillsCount: number;
  location: string | null;
  onWriteFirst: () => void;
  onSkip: () => void;
  onBack: () => void;
}

const VISIBLE = 6;

const formatCount = (n: number) => n.toLocaleString('fr-FR');

/**
 * Les premiers candidats : la vraie recherche, sur le vrai compte, avec les
 * filtres du brief. Les cartes arrivent d'abord, les scores ensuite, et les
 * cartes se réordonnent quand ils tombent.
 */
export const SceneCandidates: React.FC<Props> = ({ missionId, account, results, onResults, skillsCount, location, onWriteFirst, onSkip, onBack }) => {
  const { state, retry } = useFirstSearch({ missionId, account: { id: account.id, subscriptions: account.subscriptions }, initial: results, onResults });

  const ready = state.status === 'ready' ? state.results : null;
  const ordered = useMemo(() => {
    if (!ready) return [];
    if (ready.scoring !== 'done') return ready.candidates.slice(0, VISIBLE);
    return [...ready.candidates].sort((a, b) => (ready.scores[b.id]?.score ?? -1) - (ready.scores[a.id]?.score ?? -1)).slice(0, VISIBLE);
  }, [ready]);

  const total = ready?.total ?? null;
  const count = ready?.candidates.length ?? 0;

  // Ce que Konekt a fait, sans rien inventer : chaque ligne repose sur un chiffre réel de la recherche.
  const done: string[] = [];
  if (skillsCount > 0) done.push(`A lu le poste et retenu ${skillsCount} compétence${skillsCount > 1 ? 's' : ''}`);
  if (ready && count > 0) {
    done.push(
      total && total > count
        ? `A cherché sur LinkedIn${location ? ` autour de ${location}` : ''} : ${formatCount(total)} profils correspondent`
        : `A cherché sur LinkedIn${location ? ` autour de ${location}` : ''} : ${count} profil${count > 1 ? 's' : ''} trouvé${count > 1 ? 's' : ''}`,
    );
    if (ready.scoring === 'done') done.push(`A noté les ${Object.keys(ready.scores).length} profils par rapport au brief`);
  }

  return (
    <div className="space-y-6">
      {state.status === 'loading' && (
        <>
          <SceneHeading title="Je cherche vos premiers candidats.">
            <p>Recherche sur LinkedIn avec les filtres du brief. Quelques secondes.</p>
          </SceneHeading>
          <ul className="space-y-3" aria-busy="true" aria-label="Recherche en cours">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {state.status === 'error' && (
        <>
          <SceneHeading title="La recherche n'a pas abouti.">
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
            <SceneHeading title={total && total > count ? `${formatCount(total)} profils ressemblent à ce poste.` : 'Voici vos premiers candidats.'}>
              <p aria-live="polite">
                {ready.scoring === 'pending'
                  ? "L'IA Konekt lit les profils et les note par rapport au brief…"
                  : ready.scoring === 'done'
                    ? 'Classés par adéquation avec votre brief, avec la raison en une ligne.'
                    : `Aperçu des ${count} premiers résultats.`}
              </p>
            </SceneHeading>
          ) : (
            <SceneHeading title="Aucun profil avec ces filtres.">
              <p>Rien d'anormal : le brief est peut-être trop précis. Vous pourrez l'élargir depuis la mission.</p>
            </SceneHeading>
          )}

          {done.length > 0 && (
            <ul className="space-y-1.5 text-sm text-foreground-secondary" aria-label="Ce que Konekt a fait">
              {done.map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}

          {ordered.length > 0 && (
            <ul className="space-y-2.5" aria-label="Premiers candidats">
              {ordered.map((c) => (
                <CandidateRow key={c.id} candidate={c} score={ready.scores[c.id]} scoring={ready.scoring} />
              ))}
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
