import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { CreditCostBadge } from '@/components/ai/CreditCostBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalyzeCall, useCallInsightDetail, useCallTranscript } from '@/hooks/useCallInsights';
import { isInsufficientCreditsError } from '@/lib/invokeEdgeFunction';
import {
  OWNER_LABEL,
  canRetryInsight,
  formatOffset,
  insightStateText,
  isInsightInProgress,
  type CallInsight,
} from '@/lib/phoneCallInsightModel';
import type { PhoneCall } from '@/lib/phoneCalls';

/** Un appel décroché de moins de 30 secondes n'a pas de quoi être transcrit : on ne propose rien. */
const MIN_TALK_FOR_TRANSCRIPT = 30;

const REASON_TEXT: Record<string, string> = {
  no_credentials: "Reliez d'abord Aircall dans les réglages.",
  none: "Aircall n'a pas de transcription pour cet appel.",
  transient: "Aircall ne répond pas pour l'instant. Réessayez dans quelques minutes.",
};

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>
);

/**
 * L'analyse d'un appel dans sa fiche : ce qui s'est dit, les étiquettes, les
 * suites à donner, le lien avec la mission du candidat, et la transcription.
 * L'analyse part toute seule quand Aircall envoie la transcription. Ici, on la
 * relit, on la relance si elle a échoué, ou on va chercher la transcription d'un
 * appel passé avant la mise en service.
 */
export const CallInsightSection = ({ call }: { call: PhoneCall }) => {
  const detail = useCallInsightDetail(call.id);
  const analyze = useAnalyzeCall(call.id);
  const [showTranscript, setShowTranscript] = useState(false);
  const transcript = useCallTranscript(call.id, showTranscript);

  const insight: CallInsight | null = detail.data?.insight ?? null;
  const hasTranscript = detail.data?.hasTranscript ?? false;

  const run = async (options: { force?: boolean; fetchTranscript?: boolean }) => {
    try {
      const result = await analyze.mutateAsync(options);
      if (result.status === 'no_transcript') toast.info(REASON_TEXT[result.reason ?? 'none'] ?? REASON_TEXT.none);
      else if (result.status === 'failed') toast.error("L'analyse n'a pas pu se faire. Réessayez dans un instant.");
      else if (result.status === 'busy') toast.info('Une analyse est déjà en cours pour cet appel.');
    } catch (error) {
      // Le refus de crédits a déjà son message, avec le lien pour en acheter.
      if (!isInsufficientCreditsError(error)) toast.error("L'analyse n'a pas pu se faire. Réessayez dans un instant.");
    }
  };

  if (detail.isLoading) {
    return (
      <div className="mt-8 space-y-2" role="status" aria-label="Chargement de l'analyse">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (detail.isError) {
    return <p className="mt-8 text-sm text-muted-foreground">L'analyse de l'appel n'est pas disponible pour l'instant.</p>;
  }

  // Rien à analyser : pas de transcription, et un appel trop court ou sans réponse pour en avoir une.
  if (!insight && !hasTranscript) {
    if (call.outcome !== 'done' || call.talkSeconds < MIN_TALK_FOR_TRANSCRIPT) return null;
    return (
      <section className="mt-8 space-y-3" aria-label="Analyse de l'appel">
        <Heading>Analyse</Heading>
        <p className="text-sm text-muted-foreground">Aucune transcription reçue pour cet appel.</p>
        <Button type="button" variant="secondary" size="sm" disabled={analyze.isPending} onClick={() => run({ fetchTranscript: true })}>
          {analyze.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Récupérer la transcription et l'analyser
          <CreditCostBadge actionId="phone_call_analysis" className="ml-1" />
        </Button>
      </section>
    );
  }

  const stateText = insight ? insightStateText(insight.status, insight.reason) : null;
  const done = insight?.status === 'done';
  const retryable = !!insight && canRetryInsight(insight.status) && !(insight.status === 'skipped' && insight.reason === 'too_short');

  return (
    <section className="mt-8 space-y-5" aria-label="Analyse de l'appel">
      {stateText && (
        <div className="space-y-2">
          <Heading>Analyse</Heading>
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            {isInsightInProgress(insight?.status) && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {stateText}
          </p>
          {retryable && (
            <Button type="button" variant="secondary" size="sm" disabled={analyze.isPending} onClick={() => run({ force: false })}>
              {analyze.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {insight?.status === 'failed' ? 'Réessayer' : 'Analyser'}
              <CreditCostBadge actionId="phone_call_analysis" className="ml-1" />
            </Button>
          )}
        </div>
      )}

      {done && insight && (
        <>
          <div className="space-y-2">
            <Heading>Ce qui s'est dit</Heading>
            <p className="whitespace-pre-wrap text-sm text-foreground">{insight.summary}</p>
            {insight.tags.length > 0 && (
              <p className="flex flex-wrap gap-1.5">
                {insight.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs">{tag}</span>
                ))}
              </p>
            )}
          </div>

          {insight.facts.length > 0 && (
            <dl className="space-y-3">
              {insight.facts.map((fact) => (
                <div key={fact.key} className="space-y-0.5">
                  <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                  <dd className="text-sm text-foreground">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {detail.data?.missionName && (
            <div className="space-y-1">
              <Heading>Mission concernée</Heading>
              <p className="text-sm text-foreground">{detail.data.missionName}</p>
              {insight.missionFit && <p className="text-sm text-muted-foreground">{insight.missionFit}</p>}
            </div>
          )}

          {insight.nextSteps.length > 0 && (
            <div className="space-y-2">
              <Heading>Suites à donner</Heading>
              <ul className="space-y-1.5">
                {insight.nextSteps.map((step, index) => (
                  <li key={`${index}-${step.action}`} className="text-sm text-foreground">
                    {step.action}
                    {(step.owner || step.when) && (
                      <span className="text-muted-foreground">
                        {' '}({[step.owner ? OWNER_LABEL[step.owner] : null, step.when].filter(Boolean).join(', ')})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {hasTranscript && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" aria-expanded={showTranscript} onClick={() => setShowTranscript((v) => !v)}>
              {showTranscript ? 'Masquer la transcription' : 'Voir la transcription'}
            </Button>
            {done && (
              <Button type="button" variant="ghost" size="sm" disabled={analyze.isPending} onClick={() => run({ force: true })}>
                {analyze.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                Analyser à nouveau
                <CreditCostBadge actionId="phone_call_analysis" className="ml-1" />
              </Button>
            )}
          </div>
          {showTranscript && (
            transcript.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : transcript.isError ? (
              <p className="text-sm text-muted-foreground">La transcription n'a pas pu être chargée.</p>
            ) : (
              <ol className="space-y-3">
                {(transcript.data ?? []).map((line, index) => (
                  <li key={index} className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">
                      {line.who === 'agent' ? 'Recruteur' : line.who === 'contact' ? 'Correspondant' : 'Interlocuteur'}
                      {line.start !== null ? ` · ${formatOffset(line.start)}` : ''}
                    </p>
                    <p className="text-sm text-foreground">{line.text}</p>
                  </li>
                ))}
              </ol>
            )
          )}
        </div>
      )}
    </section>
  );
};
