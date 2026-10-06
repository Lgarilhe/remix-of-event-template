import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  acceptCallTaskSuggestion,
  dismissCallTaskSuggestion,
  requestCallInsights,
  type CallInsight,
  type CallTaskSuggestion,
} from '@/lib/phoneCallInsights';
import { canRequestInsights, insightNotice, suggestionDueLabel } from '@/lib/callTaskSuggestion';

interface PhoneCallInsightsProps {
  callId: string;
  /** Résumé déjà lu pour cet appel (usePhoneCallInsights), absent s'il n'y en a pas. */
  insight: CallInsight | undefined;
  /** Issue de l'appel (PhoneCall.outcome) et durée : seul un appel décroché peut avoir une transcription. */
  outcome?: string;
  talkSeconds?: number;
  callStartedAt?: string | null;
  /** Candidat de la fiche : les tâches créées lui sont rattachées. */
  candidate?: { id: string; name?: string | null } | null;
}

const SPEAKER_LABEL = { agent: 'Recruteur', contact: 'Interlocuteur', unknown: 'Voix' } as const;

/**
 * Résumé, tâches proposées et transcription sous un appel. Rien n'est affiché
 * pour un appel sans transcription, sauf un bouton discret sur un appel décroché.
 */
export const PhoneCallInsights: React.FC<PhoneCallInsightsProps> = ({
  callId, insight, outcome, talkSeconds, callStartedAt = null, candidate = null,
}) => {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['phone-call-insights'] });

  const request = async (force: boolean) => {
    setBusy('request');
    try {
      await requestCallInsights(callId, force);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Le résumé n'a pas pu être demandé. Réessayez.");
    } finally {
      setBusy(null);
    }
  };

  const accept = async (s: CallTaskSuggestion) => {
    setBusy(s.id);
    try {
      const result = await acceptCallTaskSuggestion({ suggestion: s, callStartedAt, candidate });
      if (result === 'already') toast.info('Cette tâche a déjà été traitée.');
      else toast.success('Tâche créée', { description: `${s.title}, ${suggestionDueLabel(s.dueInDays)}.` });
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: ['all-reminders'] }),
        queryClient.invalidateQueries({ queryKey: ['auto-task-suggestions'] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "La tâche n'a pas pu être créée. Réessayez.");
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (s: CallTaskSuggestion) => {
    setBusy(s.id);
    try {
      await dismissCallTaskSuggestion(s.id);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "La suggestion n'a pas pu être ignorée. Réessayez.");
    } finally {
      setBusy(null);
    }
  };

  if (!insight) {
    if (!canRequestInsights(outcome, talkSeconds)) return null;
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => request(false)}
        disabled={busy !== null}
        className="h-5 px-1.5 text-xs text-muted-foreground gap-1"
      >
        {busy === 'request' ? <Loader2 className="w-2.5 h-2.5 animate-spin" aria-hidden="true" /> : <Sparkles className="w-2.5 h-2.5" aria-hidden="true" />}
        Résumé et transcription
      </Button>
    );
  }

  const notice = insightNotice(insight.status, insight.errorCode, !!insight.summary);
  const proposed = insight.suggestions.filter((s) => s.state === 'proposed');
  const created = insight.suggestions.filter((s) => s.state === 'accepted');

  return (
    <div className="mt-1.5 space-y-2 border-t border-border/60 pt-2">
      {insight.summary && (
        <div>
          <p className="flex items-center gap-1 text-2xs font-semibold text-muted-foreground" title="Généré par l'IA Konekt">
            <Sparkles className="w-2.5 h-2.5" aria-hidden="true" />
            Résumé
          </p>
          <p className="mt-0.5 whitespace-pre-line text-xs text-foreground-secondary">{insight.summary}</p>
        </div>
      )}

      {notice && (
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          {notice.text}
          {notice.canRetry && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => request(false)}
              disabled={busy !== null}
              className="h-5 px-1.5 text-xs gap-1"
            >
              {busy === 'request' && <Loader2 className="w-2.5 h-2.5 animate-spin" aria-hidden="true" />}
              Réessayer
            </Button>
          )}
        </p>
      )}

      {proposed.length > 0 && (
        <div>
          <p className="text-2xs font-semibold text-muted-foreground">Tâches proposées</p>
          <ul className="mt-1 space-y-1.5">
            {proposed.map((s) => (
              <li key={s.id} className="flex items-start gap-2 border border-border/60 bg-background/60 p-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">{s.title}</p>
                  <p className="text-2xs text-muted-foreground">
                    {s.reason ? `${s.reason} ` : ''}Échéance proposée : {suggestionDueLabel(s.dueInDays)}.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => accept(s)}
                    disabled={busy !== null}
                    className="h-6 px-2 text-xs gap-1"
                  >
                    {busy === s.id ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Check className="w-3 h-3" aria-hidden="true" />}
                    Créer la tâche
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Ignorer la tâche « ${s.title} »`}
                    title="Ignorer"
                    onClick={() => dismiss(s)}
                    disabled={busy !== null}
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {created.length > 0 && (
        <p className="text-2xs text-muted-foreground">
          {created.length === 1 ? 'Tâche créée' : `${created.length} tâches créées`} depuis cet appel.
        </p>
      )}

      {insight.transcript.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Transcription</summary>
          <div className="mt-1.5 max-h-64 space-y-1 overflow-y-auto pr-1">
            {insight.transcript.map((line, i) => (
              <p key={i} className="text-xs text-foreground-secondary">
                <span className="font-medium text-foreground">{SPEAKER_LABEL[line.speaker]}</span>
                {' : '}
                {line.text}
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};
