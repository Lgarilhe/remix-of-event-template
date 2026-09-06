import React, { useState, useCallback, useRef, useEffect } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sparkles,
  Loader2,
  Send,
  ThumbsUp,
  ThumbsDown,
  HelpCircle,
  UserPlus,
  Search,
  RefreshCw,
  ChevronDown,
  Briefcase,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Chat, Message, JobData } from '@/hooks/useMessagesInbox';

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
  onSuggestionSend: (text: string) => void;
  onAddToPipeline?: (jobId?: string, jobTitle?: string) => void;
  sending?: boolean;
}

// ─── Component ────────────────────────────────────────────────────

export const InlineAIPanel: React.FC<InlineAIPanelProps> = ({
  open,
  onClose,
  context,
  chatId,
  accountId,
  onSuggestionSelect,
  onSuggestionSend,
  onAddToPipeline,
  sending = false,
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

  return (
    <div className="border-t border-border bg-background" data-component="inline-ai-panel">
      {/* Header moderne avec tabs pills + actions */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted/20">
        {/* Title + sparkles */}
        <div className="flex items-center gap-1.5 mr-2">
          <Sparkles className="w-3.5 h-3.5 text-foreground" />
          <span className="text-xs font-semibold text-foreground">Assistant IA</span>
        </div>

        {/* Tabs pills */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveSection('suggestions')}
            className={cn(
              "h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[11px] font-medium transition-colors",
              activeSection === 'suggestions'
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span>Réponses</span>
            {positive.length + negative.length > 0 && (
              <span className={cn(
                "tabular-nums text-[10px]",
                activeSection === 'suggestions' ? "opacity-70" : "opacity-50",
              )}>
                {positive.length + negative.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSection('jobs')}
            className={cn(
              "h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[11px] font-medium transition-colors",
              activeSection === 'jobs'
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span>Postes</span>
            {jobMatches.length > 0 && (
              <span className={cn(
                "tabular-nums text-[10px]",
                activeSection === 'jobs' ? "opacity-70" : "opacity-50",
              )}>
                {jobMatches.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex-1" />

        {/* Actions droite */}
        <ModelPicker actionId="analyze_response" value={selectedModel} onChange={setSelectedModel} compact />

        {analysis && (
          <button
            onClick={() => { setAnalysis(null); analyze(true); }}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Relancer l'analyse"
            aria-label="Relancer l'analyse"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={onClose}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Fermer"
          aria-label="Fermer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="max-h-[280px] overflow-y-auto p-3">
        {loading && !analysis ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-3/4 rounded-lg" />
          </div>
        ) : error ? (
          <div className="text-center py-4">
            <p className="text-xs text-destructive mb-2">{error}</p>
            <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={() => { setError(null); analyze(); }}>
              Réessayer
            </Button>
          </div>
        ) : (
          <>
            {/* ─── SUGGESTIONS ─── */}
            {activeSection === 'suggestions' && (
              <div className="space-y-3">
                {positive.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1 text-emerald-600">
                      <ThumbsUp className="w-3 h-3" /> Positives
                    </p>
                    {positive.map((s, i) => (
                      <SuggestionItem
                        key={i}
                        suggestion={s}
                        variant="positive"
                        onSelect={onSuggestionSelect}
                        onSend={onSuggestionSend}
                        onClose={onClose}
                        sending={sending}
                      />
                    ))}
                  </div>
                )}

                {negative.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1 text-destructive">
                      <ThumbsDown className="w-3 h-3" /> Clôture
                    </p>
                    {negative.map((s, i) => (
                      <SuggestionItem
                        key={i}
                        suggestion={s}
                        variant="negative"
                        onSelect={onSuggestionSelect}
                        onSend={onSuggestionSend}
                        onClose={onClose}
                        sending={sending}
                      />
                    ))}
                  </div>
                )}

                {qualQuestions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1 text-amber-600">
                      <HelpCircle className="w-3 h-3" /> Questions à poser
                    </p>
                    {qualQuestions.map((q, i) => (
                      <button
                        key={i}
                        className="w-full text-left text-xs p-2 border border-amber-500/30 hover:bg-amber-500/5 transition-colors"
                        onClick={() => { onSuggestionSelect(q); onClose(); }}
                      >
                        → {q}
                      </button>
                    ))}
                  </div>
                )}

                {positive.length === 0 && negative.length === 0 && qualQuestions.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">Aucune suggestion disponible</p>
                )}
              </div>
            )}

            {/* ─── JOBS ─── */}
            {activeSection === 'jobs' && (
              <div className="space-y-1.5">
                {jobMatches.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">Aucun poste matché</p>
                ) : (
                  jobMatches.map((job, i) => (
                    <button
                      key={i}
                      className={cn(
                        "w-full flex items-start gap-2.5 p-2.5 border text-left transition-colors hover:bg-accent/10",
                        job.recommendation === 'go' && "border-emerald-500/50",
                        job.recommendation === 'maybe' && "border-amber-500/50",
                        job.recommendation === 'skip' && "border-border"
                      )}
                      onClick={() => onAddToPipeline?.(job.jobId, job.jobTitle)}
                    >
                      <div className={cn(
                        "w-9 h-9 flex items-center justify-center text-background font-bold text-xs shrink-0",
                        job.matchScore >= 75 && "bg-emerald-500",
                        job.matchScore >= 50 && job.matchScore < 75 && "bg-amber-500",
                        job.matchScore < 50 && "bg-muted-foreground"
                      )}>
                        {job.matchScore}%
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-bold truncate">{job.jobTitle}</p>
                          <Badge variant="outline" className="text-xs rounded-full shrink-0">
                            {job.recommendation === 'go' ? '✓' : job.recommendation === 'maybe' ? '?' : '✗'}
                          </Badge>
                        </div>
                        {job.clientName && <p className="text-xs text-muted-foreground">{job.clientName}</p>}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {job.matchingSkills.slice(0, 3).map((s, si) => (
                            <span key={si} className="text-xs px-1 py-0.5 bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">✓ {s}</span>
                          ))}
                          {job.missingSkills.slice(0, 2).map((s, si) => (
                            <span key={si} className="text-xs px-1 py-0.5 bg-destructive/10 text-destructive border border-destructive/20">✗ {s}</span>
                          ))}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ─── Suggestion Item ──────────────────────────────────────────────

const SuggestionItem: React.FC<{
  suggestion: ReplySuggestion;
  variant: 'positive' | 'negative';
  onSelect: (text: string) => void;
  onSend: (text: string) => void;
  onClose: () => void;
  sending: boolean;
}> = ({ suggestion, variant, onSelect, onSend, onClose, sending }) => (
  <div
    className={cn(
      "group flex items-start gap-2 p-3 rounded-lg border transition-all cursor-pointer",
      variant === 'positive'
        ? "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 hover:border-emerald-500/40"
        : "border-destructive/20 bg-destructive/5 hover:bg-destructive/10 hover:border-destructive/40"
    )}
    onClick={() => { onSelect(suggestion.text); onClose(); }}
  >
    <div className="flex-1 min-w-0">
      <p className="text-[13px] leading-relaxed text-foreground">{suggestion.text}</p>
      {suggestion.intent_match && (
        <p className="text-[11px] text-muted-foreground mt-1 italic">{suggestion.intent_match}</p>
      )}
    </div>
    <button
      type="button"
      className={cn(
        "h-7 w-7 inline-flex items-center justify-center rounded-md shrink-0 transition-all",
        "opacity-0 group-hover:opacity-100",
        variant === 'positive'
          ? "bg-emerald-600 text-white hover:bg-emerald-700"
          : "bg-destructive text-destructive-foreground hover:opacity-90",
        "active:scale-95",
      )}
      onClick={(e) => { e.stopPropagation(); onSend(suggestion.text); onClose(); }}
      disabled={sending}
      title="Envoyer directement"
      aria-label="Envoyer directement cette suggestion"
    >
      {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3 h-3" />}
    </button>
  </div>
);
