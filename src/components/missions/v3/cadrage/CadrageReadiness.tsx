// Refonte mission, écran Cadrage : bandeau de complétude (conception 5.6).
// Un seul calcul (cadrageReadiness), l'état de l'enregistrement et la dictée.
// La dictée enregistre un texte libre du poste (raw_brief), lu par la notation ;
// elle ne remplit pas les champs : il faudrait une structuration côté serveur.
import { useCallback, useId, useState } from 'react';
import { AlertCircle, Check, CircleDashed, CheckCircle2, Loader2, Mic, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { VoiceDictation } from '@/components/missions/VoiceDictation';
import type { JobDetails } from '@/types/jobDetails';
import type { JobDetailsSaveStatus } from '@/hooks/useJobDetailsAutosave';
import { cn } from '@/lib/utils';
import { cadrageReadiness, type StepsState } from './cadrageModel';

export interface CadrageReadinessProps {
  jd: JobDetails;
  stepCount: number;
  stepsState: StepsState;
  saveStatus: JobDetailsSaveStatus;
  onRetry: () => void;
  /** Dictée permise (brief modifiable). */
  canDictate: boolean;
  updateField: (patch: Partial<JobDetails>) => void;
}

function SaveState({ status, onRetry }: { status: JobDetailsSaveStatus; onRetry: () => void }) {
  return (
    <div aria-live="polite" className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
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
          <Button type="button" variant="outline" size="xs" onClick={onRetry}>
            Réessayer
          </Button>
        </>
      )}
    </div>
  );
}

export function CadrageReadiness({ jd, stepCount, stepsState, saveStatus, onRetry, canDictate, updateField }: CadrageReadinessProps) {
  const { markers, status, title } = cadrageReadiness(jd, stepCount, stepsState);
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
    <div className="flex flex-col gap-2">
      <div className="flex min-h-[50px] flex-wrap items-center gap-x-[18px] gap-y-2 rounded-xl border border-border bg-card py-2 pl-4 pr-2.5">
        <span
          className={cn(
            'flex items-center gap-2 whitespace-nowrap text-sm font-semibold',
            status === 'ready' ? 'text-success' : status === 'incomplete' ? 'text-warning' : 'text-muted-foreground',
          )}
        >
          {status === 'ready' ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <CircleDashed className="h-4 w-4" aria-hidden="true" />
          )}
          <span>{title}</span>
        </span>
        <ul aria-label="Repères de complétude" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[18px] gap-y-1.5">
          {markers.map((m) => (
            <li
              key={m.id}
              className={cn('flex items-center gap-1.5 text-[12.5px]', m.state === 'done' ? 'text-foreground' : 'text-muted-foreground')}
            >
              {m.state === 'done' ? (
                <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
              ) : m.state === 'pending' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : m.state === 'unavailable' ? (
                <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <span className="h-3 w-3 rounded-full border-[1.5px] border-muted-foreground" aria-hidden="true" />
              )}
              <span>{m.label}</span>
              <span className="sr-only">
                {m.state === 'done' ? ', fait' : m.state === 'todo' ? ', à compléter' : m.state === 'pending' ? ', vérification en cours' : ''}
              </span>
            </li>
          ))}
        </ul>
        <SaveState status={saveStatus} onRetry={onRetry} />
        {canDictate && (
          <Button
            type="button"
            variant="outline"
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
            className={cn('shrink-0', dictating && 'border-foreground/40 bg-accent')}
          >
            {dictating ? <X aria-hidden="true" /> : <Mic aria-hidden="true" />}
            {dictating ? 'Fermer la dictée' : 'Dicter'}
          </Button>
        )}
      </div>

      {canDictate && dictating && (
        <div id={panelId} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <p className="text-[12.5px] text-muted-foreground">
            Votre dictée est enregistrée comme description libre du poste, à la place de la précédente. Elle sert à la
            notation des profils ; elle ne remplit pas les champs.
          </p>
          <VoiceDictation
            onRecordingChange={onRecordingChange}
            onTranscript={(chunk) => setTranscript((prev) => (prev ? `${prev} ` : '') + chunk)}
            onComplete={(fullText) => {
              updateField({ voice_transcript: fullText, raw_brief: fullText, brief_source: 'voice' });
              toast.success('Dictée enregistrée.');
            }}
          />
          {transcript && (
            <p className="max-h-[150px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-[12.5px] leading-relaxed">
              {transcript}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
