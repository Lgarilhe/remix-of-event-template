// Refonte mission, écran Cadrage : bandeau de complétude (conception 5.6).
// Un seul calcul (cadrageReadiness), l'état de l'enregistrement et la dictée.
// La dictée enregistre un texte libre du poste (raw_brief), lu par la notation ;
// elle ne remplit pas les champs : il faudrait une structuration côté serveur.
//
// Design simplifié (04/10/2026) : une seule ligne calme, sans cadre. Un anneau
// d'avancement, un titre et une phrase qui nomme ce qu'il reste à faire ; ce qui
// est déjà complet ne s'écrit plus en coches (la liste reste pour les lecteurs
// d'écran). « Dicter » est un bouton discret. « Aller au sourcing » ferme la
// ligne : plein quand le poste est prêt, teinté sinon (les écrans ne sont jamais
// verrouillés, conception 3.1).
import { useCallback, useId, useState } from 'react';
import { AlertCircle, ArrowRight, Check, Loader2, Mic, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { VoiceDictation } from '@/components/missions/VoiceDictation';
import type { JobDetails } from '@/types/jobDetails';
import type { JobDetailsSaveStatus } from '@/hooks/useJobDetailsAutosave';
import { cn } from '@/lib/utils';
import { cadrageReadiness, type StepsState } from './cadrageModel';
import { TOUCH } from './sectionUi';

export interface CadrageReadinessProps {
  jd: JobDetails;
  stepCount: number;
  stepsState: StepsState;
  saveStatus: JobDetailsSaveStatus;
  onRetry: () => void;
  /** Dictée permise (brief modifiable). */
  canDictate: boolean;
  updateField: (patch: Partial<JobDetails>) => void;
  /** Passe à l'écran Sourcing. */
  onContinue: () => void;
}

function SaveState({ status, onRetry }: { status: JobDetailsSaveStatus; onRetry: () => void }) {
  return (
    <div aria-live="polite" className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
      {status === 'saving' && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <span>Enregistrement…</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          <span>Enregistré</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
          <span className="text-foreground">Échec de l'enregistrement</span>
          <Button type="button" variant="ghost" size="xs" onClick={onRetry} className={cn('text-foreground', TOUCH)}>
            Réessayer
          </Button>
        </>
      )}
    </div>
  );
}

/** Anneau d'avancement : couleur de marque (comme l'anneau de la note), le compte au centre, une coche quand tout est fait. */
const RING_SIZE = 40;
const RING_RADIUS = 16;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function ProgressRing({ done, total, ready }: { done: number; total: number; ready: boolean }) {
  const share = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
  return (
    <span
      role="img"
      aria-label={`Avancement du poste : ${done} sur ${total}`}
      className="relative inline-flex shrink-0 items-center justify-center text-xs font-semibold tabular-nums text-foreground"
      style={{ width: RING_SIZE, height: RING_SIZE }}
    >
      <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" strokeWidth={3} className="stroke-foreground/15" />
        {share > 0 && (
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${RING_LENGTH * share} ${RING_LENGTH}`}
            className="stroke-brand"
          />
        )}
      </svg>
      {ready ? (
        <Check className="relative h-4 w-4" aria-hidden="true" />
      ) : done > 0 ? (
        <span className="relative" aria-hidden="true">
          {done}/{total}
        </span>
      ) : null}
    </span>
  );
}

export function CadrageReadiness({ jd, stepCount, stepsState, saveStatus, onRetry, canDictate, updateField, onContinue }: CadrageReadinessProps) {
  const { markers, status, title, sentence, done, total } = cadrageReadiness(jd, stepCount, stepsState);
  const [dictating, setDictating] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const panelId = useId();
  // Une session d'écoute repart d'un texte vide : seul le texte de la dernière
  // session est enregistré. Pendant l'écoute, la dictée ne se ferme pas (le
  // texte en cours serait perdu) : il faut d'abord l'arrêter.
  const onRecordingChange = useCallback((active: boolean) => {
    setListening(active);
    if (active) setTranscript('');
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ProgressRing done={done} total={total} ready={status === 'ready'} />
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-md font-semibold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{sentence}</p>
        </div>
        <SaveState status={saveStatus} onRetry={onRetry} />
        {canDictate && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={dictating}
            aria-controls={panelId}
            aria-disabled={dictating && listening}
            title={dictating && listening ? 'Arrêtez la dictée pour la fermer.' : undefined}
            onClick={() => {
              if (dictating && listening) {
                toast.info('Arrêtez la dictée pour la fermer : le texte en cours sera enregistré.');
                return;
              }
              setDictating((v) => !v);
            }}
            className={cn('shrink-0', TOUCH, dictating && 'bg-muted')}
          >
            {dictating ? <X aria-hidden="true" /> : <Mic aria-hidden="true" />}
            {dictating ? 'Fermer la dictée' : 'Dicter'}
          </Button>
        )}
        <Button
          type="button"
          variant={status === 'ready' ? 'primary' : 'secondary'}
          size="sm"
          onClick={onContinue}
          className={cn('shrink-0', TOUCH)}
        >
          Aller au sourcing
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>

      {/* Les repères, pour les lecteurs d'écran : la phrase dit ce qui manque, la liste dit aussi ce qui est fait. */}
      <ul aria-label="Repères de complétude" className="sr-only">
        {markers.map((m) => (
          <li key={m.id}>
            {m.label}
            {m.state === 'done' ? ', fait' : m.state === 'todo' ? ', à compléter' : m.state === 'pending' ? ', vérification en cours' : ''}
          </li>
        ))}
      </ul>

      {canDictate && dictating && (
        <div id={panelId} className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            Votre dictée est enregistrée comme description libre du poste, à la place de la précédente. Elle sert à la
            notation des profils ; elle ne remplit pas les champs.
          </p>
          <VoiceDictation
            variant="mission-v3"
            onRecordingChange={onRecordingChange}
            onTranscript={(chunk) => setTranscript((prev) => (prev ? `${prev} ` : '') + chunk)}
            onComplete={(fullText) => {
              updateField({ voice_transcript: fullText, raw_brief: fullText, brief_source: 'voice' });
              toast.success('Dictée enregistrée.');
            }}
          />
          {transcript && (
            <p className="max-h-[150px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-sm leading-relaxed">
              {transcript}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
