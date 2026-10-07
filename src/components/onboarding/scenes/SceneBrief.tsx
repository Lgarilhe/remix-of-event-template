import React, { useCallback, useEffect, useId, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useBriefGeneration, type BriefRequest } from '@/hooks/onboarding/useBriefGeneration';
import { emptyBrief, type BriefDraft } from '@/lib/onboarding/brief';
import type { ProcessKey } from '@/lib/onboarding/mission';
import { ChipEditor } from '../parts/ChipEditor';
import { NavRow } from '../parts/NavRow';
import { ProcessPicker } from '../parts/ProcessPicker';
import { SceneHeading } from '../parts/SceneHeading';
import { YearsRange } from '../parts/YearsRange';

interface Props {
  request: BriefRequest;
  /** Brief en cours, gardé par le parcours : revenir sur la scène ne relance pas l'analyse. */
  draft: BriefDraft | null;
  onDraft: (draft: BriefDraft | null) => void;
  processKey: ProcessKey;
  onProcessKey: (key: ProcessKey) => void;
  /** Mission déjà créée : le brief se relit, il ne se refait pas ici. */
  locked: boolean;
  creating: boolean;
  onCreate: () => void;
  onContinue: () => void;
  onBack: () => void;
}

const Reading: React.FC<{ title: string }> = ({ title }) => (
  <div className="space-y-5 rounded-xl border border-border bg-card p-5" aria-busy="true">
    <p className="text-lg font-semibold text-foreground">{title}</p>
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {[88, 64, 104, 72, 96, 60].map((w, i) => (
          <Skeleton key={i} className="h-7 rounded-full" style={{ width: w }} />
        ))}
      </div>
      <Skeleton className="h-4 w-2/3" />
    </div>
    <p role="status" className="text-xs text-muted-foreground">
      Lecture du poste et préparation des critères de recherche. De 5 à 15 secondes.
    </p>
  </div>
);

/**
 * Le brief, lu par l'IA puis rendu corrigeable : titres, compétences, expérience,
 * lieu, viviers, format des entretiens. La mission naît de ce qui est à l'écran.
 */
export const SceneBrief: React.FC<Props> = ({ request, draft, onDraft, processKey, onProcessKey, locked, creating, onCreate, onContinue, onBack }) => {
  const { state, generate } = useBriefGeneration(onDraft);
  const startedRef = useRef(false);
  const ids = { titles: useId(), skills: useId(), location: useId() };

  // Une seule analyse par passage : sans brief gardé, on lance la lecture à l'arrivée.
  useEffect(() => {
    if (draft || startedRef.current) return;
    startedRef.current = true;
    void generate(request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phase: 'loading' | 'ready' | 'failed' = draft ? 'ready' : state.status === 'failed' ? 'failed' : 'loading';

  const retry = useCallback(() => void generate(request), [generate, request]);
  const patch = (next: Partial<BriefDraft>) => draft && onDraft({ ...draft, ...next });

  const failureReason = state.status === 'failed' ? state.reason : 'other';

  return (
    <div className="space-y-7">
      {phase === 'loading' && (
        <>
          <SceneHeading title="Je lis le poste.">
            <p>Konekt en tire ce que la recherche va chercher.</p>
          </SceneHeading>
          <Reading title={request.title} />
        </>
      )}

      {phase === 'failed' && (
        <>
          <SceneHeading title="L'analyse n'a pas abouti.">
            <p>
              {failureReason === 'credits'
                ? 'Les crédits IA de votre espace sont épuisés. Vous pouvez écrire le brief vous-même : la mission fonctionne de la même façon.'
                : "Le service n'a pas répondu. Vous pouvez réessayer, ou écrire le brief vous-même."}
            </p>
          </SceneHeading>
          <div className="flex flex-wrap gap-2">
            {failureReason !== 'credits' && (
              <Button variant="outline" onClick={retry}>
                <RefreshCw aria-hidden="true" />
                Réessayer
              </Button>
            )}
            <Button variant="primary" onClick={() => onDraft(emptyBrief(request.title))}>
              Écrire le brief moi-même
            </Button>
          </div>
          <NavRow onBack={onBack} onNext={() => onDraft(emptyBrief(request.title))} nextLabel="Écrire le brief" />
        </>
      )}

      {phase === 'ready' && draft && (
        <>
          <SceneHeading title={locked ? 'Le brief est enregistré.' : 'Voici le brief.'}>
            <p>
              {locked
                ? 'La mission existe. Vous pourrez encore ajuster le brief depuis son onglet.'
                : draft.rationale ?? 'Corrigez ce qui ne vous convient pas : la recherche suivra vos corrections.'}
            </p>
          </SceneHeading>

          <div className="space-y-5 rounded-xl border border-border bg-card p-5">
            <ChipEditor id={ids.titles} label="Intitulés recherchés" values={draft.titles} onChange={(titles) => patch({ titles })} addLabel="Ajouter un intitulé" suggestions={draft.altTitles} max={6} readOnly={locked} />
            <ChipEditor id={ids.skills} label="Compétences" values={draft.skills} onChange={(skills) => patch({ skills })} addLabel="Ajouter une compétence" suggestions={draft.altSkills} readOnly={locked} />
            <YearsRange min={draft.xpMin} max={draft.xpMax} onChange={({ min, max }) => patch({ xpMin: min, xpMax: max })} readOnly={locked} />
            <div>
              <label htmlFor={ids.location} className="mb-2 block text-xs font-medium text-muted-foreground">
                Lieu
              </label>
              <Input
                id={ids.location}
                value={draft.location}
                onChange={(e) => patch({ location: e.target.value })}
                placeholder="Paris, Lyon, France entière…"
                maxLength={80}
                disabled={locked}
                className="h-9 max-w-xs"
              />
            </div>
            {draft.feeders.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Souvent en poste chez</p>
                <p className="text-sm text-foreground-secondary">{draft.feeders.join(', ')}</p>
              </div>
            )}
            <ProcessPicker value={processKey} onChange={onProcessKey} readOnly={locked} />
          </div>

          <NavRow
            onBack={onBack}
            onNext={locked ? onContinue : onCreate}
            nextLabel={locked ? 'Continuer' : creating ? 'Création de la mission…' : 'Créer la mission'}
            nextDisabled={!locked && (draft.titles.length === 0 || draft.title.trim().length < 2)}
            loading={creating}
          />
        </>
      )}
    </div>
  );
};
