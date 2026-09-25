import React, { useState, useCallback, useRef, useEffect } from 'react';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState, ErrorState } from '@/components/layout';
import { Bot, Check, RefreshCw, X } from 'lucide-react';
import { JobData } from '@/hooks/useMessagesInbox';

/**
 * InlineAIPanel — panneau IA au-dessus du composeur : réponses proposées,
 * questions à poser, postes correspondants.
 *
 * Une suggestion est un bouton qui remplit le composeur : on la relit et on
 * l'envoie soi-même, jamais d'envoi direct (revue design D-14).
 */

// ─── Types ────────────────────────────────────────────────────────

interface AnalysisContext {
  recipientName: string;
  recipientHeadline?: string;
  messages: Array<{ text: string; is_sender: boolean; timestamp?: string }>;
  jobContext?: { title: string; company?: string };
  profileData?: {
    name: string;
    headline?: string;
    currentRole?: string;
    currentCompany?: string;
    skills?: string[];
  };
  availableJobs?: JobData[];
  calendlyLink?: string;
  /** Tone choisi par l'user (formal / casual / direct / empathetic) — passé
      au prompt Claude pour adapter le style des suggestions. */
  tone?: 'formal' | 'casual' | 'direct' | 'empathetic';
}

interface ReplySuggestion {
  text: string;
  type: string;
  intent_match: string;
  tone?: string;
}

interface JobMatch {
  jobId: string;
  jobTitle: string;
  clientName?: string;
  matchScore: number;
  matchingSkills: string[];
  missingSkills: string[];
  recommendation: 'go' | 'maybe' | 'skip';
  summary: string;
}

interface AnalysisResult {
  replySuggestions: ReplySuggestion[];
  jobMatches?: JobMatch[];
  qualificationQuestions?: string[];
  [key: string]: unknown;
}

interface InlineAIPanelProps {
  open: boolean;
  onClose: () => void;
  context: AnalysisContext;
  chatId?: string;
  accountId?: string;
  onSuggestionSelect: (text: string) => void;
  onAddToPipeline?: (jobId?: string, jobTitle?: string) => void;
}

/** Recommandation d'un poste : un mot et son ton de badge. */
const RECOMMENDATION: Record<JobMatch['recommendation'], { label: string; tone: 'success' | 'warning' | 'muted' }> = {
  go: { label: 'Recommandé', tone: 'success' },
  maybe: { label: 'À étudier', tone: 'warning' },
  skip: { label: 'Peu adapté', tone: 'muted' },
};

// ─── Component ────────────────────────────────────────────────────

export const InlineAIPanel: React.FC<InlineAIPanelProps> = ({
  open,
  onClose,
  context,
  chatId,
  accountId,
  onSuggestionSelect,
  onAddToPipeline,
}) => {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'suggestions' | 'jobs'>('suggestions');
  const isAnalyzingRef = useRef(false);
  const lastChatIdRef = useRef<string | null>(null);

  const analyze = useCallback(async (skipCache = false) => {
    if (isAnalyzingRef.current) return;
    isAnalyzingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      // Check cache
      if (!skipCache && chatId && accountId) {
        const { data: cached } = await supabase
          .from('message_analysis_cache')
          .select('analysis, updated_at')
          .eq('chat_id', chatId)
          .eq('account_id', accountId)
          .maybeSingle();

        if (cached?.analysis && typeof cached.analysis === 'object') {
          const cacheAge = Date.now() - new Date(cached.updated_at).getTime();
          const isStale = cacheAge > 24 * 60 * 60 * 1000;
          const cachedMsgCount = (cached.analysis as any)._messageCount;
          const hasNewMessages = typeof cachedMsgCount === 'number' && cachedMsgCount !== context.messages.length;
          // Marqueur « aucun message du candidat » écrit par auto-analyze-message :
          // pas une analyse, le panneau relance la sienne (contexte complet).
          const isMarker = (cached.analysis as { _marker?: boolean })._marker === true;

          if (!isStale && !hasNewMessages && !isMarker) {
            setAnalysis(cached.analysis as unknown as AnalysisResult);
            setLoading(false);
            isAnalyzingRef.current = false;
            return;
          }
        }
      }

      const response = await invokeWithCredits<{ analysis?: any }>('analyze-response', 'analyze_response', { context }, { modelOverride: selectedModel ?? undefined });
      if (response.error) throw response.error;
      if (response.data?.success && response.data?.analysis) {
        setAnalysis(response.data.analysis);

        // Cache
        if (chatId && accountId) {
          const analysisWithMeta = { ...response.data.analysis, _messageCount: context.messages.length };
          supabase
            .from('message_analysis_cache')
            .upsert({
              chat_id: chatId,
              account_id: accountId,
              recipient_name: context.recipientName,
              analysis: analysisWithMeta,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'chat_id,account_id' })
            .then((res) => {
              if (res.error) console.warn('[InlineAI] Cache write failed:', res.error);
            });
        }
      } else if (response.data?.error) {
        throw new Error(response.data.error);
      }
    } catch (err) {
      console.error('Error analyzing:', err);
      setError(err instanceof Error ? err.message : "Erreur d'analyse");
    } finally {
      setLoading(false);
      isAnalyzingRef.current = false;
    }
  }, [context, chatId, accountId]);

  // Auto-analyze when panel opens or chat changes
  useEffect(() => {
    if (open && chatId) {
      if (lastChatIdRef.current !== chatId) {
        setAnalysis(null);
        lastChatIdRef.current = chatId;
      }
      if (!analysis && !loading && !error) {
        analyze();
      }
    }
  }, [open, chatId]);

  if (!open) return null;

  const positive = analysis?.replySuggestions?.filter(s => s.tone !== 'negative') || [];
  const negative = analysis?.replySuggestions?.filter(s => s.tone === 'negative') || [];
  const jobMatches = analysis?.jobMatches || [];
  const qualQuestions = analysis?.qualificationQuestions || [];
  const suggestionCount = positive.length + negative.length;

  const insert = (text: string) => {
    onSuggestionSelect(text);
    onClose();
  };

  return (
    <div className="border-t border-border bg-background" data-component="inline-ai-panel">
      {/* En-tête : titre, onglets, modèle, relance, fermeture */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          Assistant IA
        </span>

        <SegmentedControl<'suggestions' | 'jobs'>
          aria-label="Contenu du panneau IA"
          value={activeSection}
          onValueChange={(section) => setActiveSection(section)}
          options={[
            { value: 'suggestions', label: suggestionCount > 0 ? `Réponses (${suggestionCount})` : 'Réponses' },
            { value: 'jobs', label: jobMatches.length > 0 ? `Postes (${jobMatches.length})` : 'Postes' },
          ]}
        />

        <div className="ml-auto flex items-center gap-1">
          <ModelPicker actionId="analyze_response" value={selectedModel} onChange={setSelectedModel} compact />
          {analysis && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => { setAnalysis(null); analyze(true); }}
                  aria-label="Relancer l'analyse"
                >
                  <RefreshCw aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Relancer l'analyse</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Fermer le panneau IA">
                <X aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fermer le panneau IA</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Contenu */}
      <div className="max-h-72 overflow-y-auto p-3">
        {loading && !analysis ? (
          <div className="space-y-2" role="status" aria-label="Analyse en cours">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-3/4 rounded-lg" />
          </div>
        ) : error ? (
          <ErrorState
            variant="compact"
            title="L'analyse n'a pas abouti"
            description="Réessayez dans un instant."
            onRetry={() => { setError(null); analyze(); }}
          />
        ) : (
          <>
            {/* ─── Réponses ─── */}
            {activeSection === 'suggestions' && (
              <div className="space-y-4">
                {positive.length > 0 && (
                  <section aria-labelledby="ai-panel-replies" className="space-y-1.5">
                    <h3 id="ai-panel-replies" className="eyebrow">Réponses proposées</h3>
                    {positive.map((s, i) => (
                      <SuggestionItem key={i} suggestion={s} onInsert={insert} />
                    ))}
                  </section>
                )}

                {negative.length > 0 && (
                  <section aria-labelledby="ai-panel-close" className="space-y-1.5">
                    <h3 id="ai-panel-close" className="eyebrow">Pour clore l'échange</h3>
                    {negative.map((s, i) => (
                      <SuggestionItem key={i} suggestion={s} onInsert={insert} />
                    ))}
                  </section>
                )}

                {qualQuestions.length > 0 && (
                  <section aria-labelledby="ai-panel-questions" className="space-y-1.5">
                    <h3 id="ai-panel-questions" className="eyebrow">Questions à poser</h3>
                    {qualQuestions.map((q, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        size="sm"
                        className="h-auto min-h-8 w-full justify-start whitespace-normal py-1.5 text-left font-normal"
                        onClick={() => insert(q)}
                      >
                        {q}
                      </Button>
                    ))}
                  </section>
                )}

                {suggestionCount === 0 && qualQuestions.length === 0 && (
                  <EmptyState
                    variant="compact"
                    title="Aucune suggestion pour cette conversation"
                    description="Relancez l'analyse après le prochain message du candidat."
                  />
                )}
              </div>
            )}

            {/* ─── Postes ─── */}
            {activeSection === 'jobs' && (
              <div className="space-y-1.5">
                {jobMatches.length === 0 ? (
                  <EmptyState
                    variant="compact"
                    title="Aucun poste ne correspond à ce profil"
                    description="Les postes ouverts sont comparés au profil à chaque analyse."
                  />
                ) : (
                  jobMatches.map((job, i) => {
                    const reco = RECOMMENDATION[job.recommendation] ?? RECOMMENDATION.skip;
                    return (
                      <Button
                        key={i}
                        variant="outline"
                        className="h-auto w-full items-start justify-start gap-3 whitespace-normal p-2.5 text-left font-normal"
                        onClick={() => onAddToPipeline?.(job.jobId, job.jobTitle)}
                        aria-label={`Ajouter au pipeline pour ${job.jobTitle} (correspondance ${job.matchScore} %, ${reco.label.toLowerCase()})`}
                      >
                        <span className="grid h-9 w-11 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold tabular-nums text-foreground">
                          {job.matchScore} %
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-foreground">{job.jobTitle}</span>
                            <Badge variant={reco.tone} className="shrink-0 px-1.5 py-0 text-2xs">
                              {reco.label}
                            </Badge>
                          </span>
                          {job.clientName && <span className="block text-xs text-muted-foreground">{job.clientName}</span>}
                          <span className="mt-1 flex flex-wrap gap-1">
                            {job.matchingSkills.slice(0, 3).map((s, si) => (
                              <Badge key={`m-${si}`} variant="success" className="px-1.5 py-0 text-2xs">
                                <Check className="h-3 w-3" aria-hidden="true" />
                                {s}
                              </Badge>
                            ))}
                            {job.missingSkills.slice(0, 2).map((s, si) => (
                              <Badge key={`x-${si}`} variant="muted" className="px-1.5 py-0 text-2xs">
                                <X className="h-3 w-3" aria-hidden="true" />
                                {s}
                              </Badge>
                            ))}
                          </span>
                        </span>
                      </Button>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ─── Suggestion ───────────────────────────────────────────────────

/** Une réponse proposée : un bouton qui la place dans le composeur. */
const SuggestionItem: React.FC<{
  suggestion: ReplySuggestion;
  onInsert: (text: string) => void;
}> = ({ suggestion, onInsert }) => (
  <Button
    variant="outline"
    className="h-auto w-full flex-col items-stretch gap-1 whitespace-normal p-3 text-left font-normal"
    onClick={() => onInsert(suggestion.text)}
  >
    <span className="text-sm leading-relaxed text-foreground">{suggestion.text}</span>
    {suggestion.intent_match && <span className="text-xs text-muted-foreground">{suggestion.intent_match}</span>}
    <span className="sr-only">Insérer dans le message</span>
  </Button>
);
