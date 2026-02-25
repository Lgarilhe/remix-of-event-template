import React, { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Brain,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  Phone,
  Calendar,
  Tag,
  Bell,
  GitBranch,
  MessageSquare,
  Loader2,
  ChevronDown,
  Zap,
  Clock,
  Briefcase,
  Send,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  HelpCircle,
  UserPlus,
  CalendarPlus,
  Search,
  X,
  FileText,
  Star,
  Trophy,
  Building2,
  User,
  Mail,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Chat, Message, JobData } from '@/hooks/useMessagesInbox';
import { CandidateHistoryData } from '@/hooks/useCandidateHistory';
import { useCandidateHistory } from '@/hooks/useCandidateHistory';
import airtableLogo from '@/assets/airtable-logo.svg';

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
}

interface SuggestedAction {
  type: 'reply' | 'sequence_change' | 'tag' | 'alert' | 'schedule_followup';
  priority: 'high' | 'medium' | 'low';
  label: string;
  description: string;
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
  intent: string;
  intentConfidence: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  engagement: 'high' | 'medium' | 'low';
  suggestedActions: SuggestedAction[];
  suggestedTags: string[];
  summary: string;
  replySuggestions: ReplySuggestion[];
  jobMatches?: JobMatch[];
  qualificationQuestions?: string[];
}

interface MessageAISheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: AnalysisContext;
  profileUrl?: string | null;
  onSuggestionSelect: (text: string) => void;
  onSuggestionSend: (text: string) => void;
  onJobSelect?: (jobId: string, jobTitle: string) => void;
  onAddToPipeline?: (jobId?: string, jobTitle?: string) => void;
  onEnrollInSequence?: () => void;
  onScheduleCall?: () => void;
  sending?: boolean;
}

// ─── Config maps ──────────────────────────────────────────────────

const intentConfig: Record<string, { label: string; icon: React.ReactNode }> = {
  interested: { label: 'Intéressé', icon: <ThumbsUp className="w-4 h-4" /> },
  not_interested: { label: 'Pas intéressé', icon: <ThumbsDown className="w-4 h-4" /> },
  needs_info: { label: "Demande d'infos", icon: <HelpCircle className="w-4 h-4" /> },
  wants_call: { label: 'Veut un call', icon: <Phone className="w-4 h-4" /> },
  timing_issue: { label: 'Timing pas bon', icon: <Clock className="w-4 h-4" /> },
  already_placed: { label: 'Déjà placé', icon: <Briefcase className="w-4 h-4" /> },
  neutral: { label: 'Neutre', icon: <Minus className="w-4 h-4" /> },
};

const sentimentEmoji: Record<string, string> = {
  positive: '🟢',
  neutral: '🟡',
  negative: '🔴',
};

// ─── Component ────────────────────────────────────────────────────

export const MessageAISheet: React.FC<MessageAISheetProps> = ({
  open,
  onOpenChange,
  context,
  profileUrl,
  onSuggestionSelect,
  onSuggestionSend,
  onJobSelect,
  onAddToPipeline,
  onEnrollInSequence,
  onScheduleCall,
  sending = false,
}) => {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'analyze' | 'suggestions' | 'jobs' | 'history'>('analyze');
  const isAnalyzingRef = useRef(false);

  const { data: historyData, loading: historyLoading } = useCandidateHistory(profileUrl);

  const analyzeResponse = useCallback(async () => {
    if (isAnalyzingRef.current) return;
    isAnalyzingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const response = await supabase.functions.invoke('analyze-response', {
        body: { context },
      });
      if (response.error) throw response.error;
      if (response.data?.success && response.data?.analysis) {
        setAnalysis(response.data.analysis);
      } else if (response.data?.error) {
        throw new Error(response.data.error);
      }
    } catch (err) {
      console.error('Error analyzing response:', err);
      setError(err instanceof Error ? err.message : "Erreur d'analyse");
    } finally {
      setLoading(false);
      isAnalyzingRef.current = false;
    }
  }, [context]);

  // Auto-analyze when sheet opens
  React.useEffect(() => {
    if (open && !analysis && !loading && !error) {
      analyzeResponse();
    }
  }, [open]);

  const tabs = [
    { id: 'analyze' as const, label: 'Analyse', icon: <Brain className="w-3.5 h-3.5" /> },
    { id: 'suggestions' as const, label: 'Réponses', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'jobs' as const, label: 'Postes', icon: <Search className="w-3.5 h-3.5" /> },
    { id: 'history' as const, label: 'Historique', icon: <FileText className="w-3.5 h-3.5" /> },
  ];

  const hasHistory = historyData && (
    historyData.shortlists.length > 0 ||
    historyData.placements.length > 0 ||
    historyData.notes.length > 0 ||
    historyData.appointments.length > 0 ||
    historyData.candidate
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[100vw] sm:w-[420px] sm:max-w-md p-0 rounded-none border-l-2 border-foreground bg-background overflow-hidden"
      >
        <SheetTitle className="sr-only">Assistant IA</SheetTitle>

        {/* Header */}
        <div className="border-b-2 border-foreground p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 bg-foreground text-background flex items-center justify-center">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider">Assistant IA</h3>
              <p className="text-[10px] text-muted-foreground">{context.recipientName}</p>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-1">
            {onAddToPipeline && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => {
                  const topJob = analysis?.jobMatches?.find(j => j.recommendation === 'go');
                  onAddToPipeline(topJob?.jobId, topJob?.jobTitle);
                }}
                title="Ajouter au pipeline"
              >
                <UserPlus className="w-3.5 h-3.5" />
              </Button>
            )}
            {onEnrollInSequence && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEnrollInSequence} title="Séquence">
                <GitBranch className="w-3.5 h-3.5" />
              </Button>
            )}
            {onScheduleCall && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onScheduleCall} title="Planifier un call">
                <CalendarPlus className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-foreground">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium uppercase tracking-wide transition-colors border-b-2 -mb-px",
                activeTab === tab.id
                  ? "border-foreground text-foreground bg-brutal-accent/10"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <ScrollArea className="h-[calc(100dvh-130px)]">
          <div className="p-4 space-y-3">
            {/* Loading */}
            {loading && !analysis && activeTab !== 'history' ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full rounded-none" />
                <Skeleton className="h-14 w-full rounded-none" />
                <Skeleton className="h-14 w-full rounded-none" />
              </div>
            ) : error && activeTab !== 'history' ? (
              <div className="text-center py-6 border border-foreground p-4">
                <p className="text-sm text-destructive mb-3">{error}</p>
                <Button variant="outline" size="sm" className="rounded-none" onClick={() => { setError(null); analyzeResponse(); }}>
                  Réessayer
                </Button>
              </div>
            ) : (
              <>
                {/* ─── ANALYZE TAB ─── */}
                {activeTab === 'analyze' && analysis && (
                  <AnalyzePanel
                    analysis={analysis}
                    onRefresh={() => { setAnalysis(null); analyzeResponse(); }}
                  />
                )}

                {/* ─── SUGGESTIONS TAB ─── */}
                {activeTab === 'suggestions' && analysis && (
                  <SuggestionsPanel
                    analysis={analysis}
                    onSuggestionSelect={onSuggestionSelect}
                    onSuggestionSend={onSuggestionSend}
                    sending={sending}
                    onClose={() => onOpenChange(false)}
                  />
                )}

                {/* ─── JOBS TAB ─── */}
                {activeTab === 'jobs' && analysis && (
                  <JobsPanel analysis={analysis} onJobSelect={onJobSelect} onAddToPipeline={onAddToPipeline} />
                )}

                {/* ─── HISTORY TAB ─── */}
                {activeTab === 'history' && (
                  <HistoryPanel data={historyData} loading={historyLoading} />
                )}

                {/* No analysis yet prompt */}
                {activeTab !== 'history' && !analysis && !loading && !error && (
                  <div className="text-center py-8">
                    <Brain className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-3">Pas encore d'analyse</p>
                    <Button variant="outline" size="sm" className="rounded-none" onClick={analyzeResponse}>
                      Lancer l'analyse
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

// ─── Analyze Panel ────────────────────────────────────────────────

const AnalyzePanel: React.FC<{ analysis: AnalysisResult; onRefresh: () => void }> = ({ analysis, onRefresh }) => {
  const intent = intentConfig[analysis.intent] || intentConfig.neutral;

  return (
    <div className="space-y-3">
      {/* Intent card */}
      <div className="border-2 border-foreground p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 bg-foreground text-background flex items-center justify-center">
              {intent.icon}
            </div>
            <div>
              <span className="font-bold text-sm uppercase tracking-wide">{intent.label}</span>
              <span className="text-xs text-muted-foreground ml-2">({analysis.intentConfidence}%)</span>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onRefresh} title="Relancer">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{analysis.summary}</p>

        <div className="flex items-center gap-3 text-xs">
          <span>{sentimentEmoji[analysis.sentiment]} Sentiment {analysis.sentiment}</span>
          <span className="text-muted-foreground">•</span>
          <span>Engagement {analysis.engagement}</span>
        </div>
      </div>

      {/* Tags */}
      {analysis.suggestedTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {analysis.suggestedTags.map((tag, i) => (
            <Badge
              key={i}
              variant="outline"
              className="text-[10px] rounded-none cursor-pointer hover:bg-brutal-accent/20 transition-colors"
              onClick={() => toast.success(`Tag "${tag}" ajouté`)}
            >
              <Tag className="w-2.5 h-2.5 mr-1" /> {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Suggested actions */}
      {analysis.suggestedActions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" /> Actions suggérées
          </p>
          {analysis.suggestedActions.map((action, i) => (
            <button
              key={i}
              className={cn(
                "w-full flex flex-col gap-1 p-2.5 border text-left transition-colors hover:bg-brutal-accent/10",
                action.priority === 'high' && "border-destructive/50 bg-destructive/5",
                action.priority === 'medium' && "border-foreground/30",
                action.priority === 'low' && "border-foreground/10"
              )}
              onClick={() => toast.info(action.label, { description: action.description })}
            >
              <div className="flex items-center justify-between gap-2 w-full">
                <p className="text-xs font-medium">{action.label}</p>
                <Badge variant="outline" className="text-[9px] rounded-none shrink-0">
                  {action.priority === 'high' ? '🔴' : action.priority === 'medium' ? '🟡' : '⚪'}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">{action.description}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Suggestions Panel ────────────────────────────────────────────

const SuggestionsPanel: React.FC<{
  analysis: AnalysisResult;
  onSuggestionSelect: (text: string) => void;
  onSuggestionSend: (text: string) => void;
  sending: boolean;
  onClose: () => void;
}> = ({ analysis, onSuggestionSelect, onSuggestionSend, sending, onClose }) => {
  const positive = analysis.replySuggestions.filter(s => (s as any).tone !== 'negative');
  const negative = analysis.replySuggestions.filter(s => (s as any).tone === 'negative');

  const SuggestionItem: React.FC<{ suggestion: ReplySuggestion; variant: 'positive' | 'negative' }> = ({ suggestion, variant }) => (
    <div
      className={cn(
        "group flex items-start gap-2 p-3 border transition-colors cursor-pointer",
        variant === 'positive'
          ? "border-emerald-500/30 hover:bg-emerald-500/5 hover:border-emerald-500/50"
          : "border-destructive/30 hover:bg-destructive/5 hover:border-destructive/50"
      )}
      onClick={() => { onSuggestionSelect(suggestion.text); onClose(); }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs leading-relaxed">{suggestion.text}</p>
        <p className="text-[10px] text-muted-foreground mt-1">{suggestion.intent_match}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        onClick={(e) => { e.stopPropagation(); onSuggestionSend(suggestion.text); onClose(); }}
        disabled={sending}
        title="Envoyer directement"
      >
        {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {positive.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 text-emerald-600">
            <ThumbsUp className="w-3.5 h-3.5" /> Réponses positives
          </p>
          {positive.map((s, i) => <SuggestionItem key={i} suggestion={s} variant="positive" />)}
        </div>
      )}

      {negative.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 text-destructive">
            <ThumbsDown className="w-3.5 h-3.5" /> Réponses de clôture
          </p>
          {negative.map((s, i) => <SuggestionItem key={i} suggestion={s} variant="negative" />)}
        </div>
      )}

      {analysis.replySuggestions.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">Aucune suggestion disponible</p>
      )}

      {/* Qualification questions */}
      {analysis.qualificationQuestions && analysis.qualificationQuestions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 text-amber-600">
            <HelpCircle className="w-3.5 h-3.5" /> Questions à poser
          </p>
          {analysis.qualificationQuestions.map((q, i) => (
            <button
              key={i}
              className="w-full text-left text-xs p-2.5 border border-amber-500/30 hover:bg-amber-500/5 transition-colors"
              onClick={() => { onSuggestionSelect(q); onClose(); }}
            >
              → {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Jobs Panel ───────────────────────────────────────────────────

const JobsPanel: React.FC<{
  analysis: AnalysisResult;
  onJobSelect?: (jobId: string, jobTitle: string) => void;
  onAddToPipeline?: (jobId?: string, jobTitle?: string) => void;
}> = ({ analysis, onJobSelect, onAddToPipeline }) => {
  if (!analysis.jobMatches || analysis.jobMatches.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-6">Aucun poste matché pour ce profil</p>;
  }

  return (
    <div className="space-y-2">
      {analysis.jobMatches.map((job, i) => (
        <button
          key={i}
          className={cn(
            "w-full flex items-start gap-3 p-3 border text-left transition-colors hover:bg-brutal-accent/10",
            job.recommendation === 'go' && "border-emerald-500/50",
            job.recommendation === 'maybe' && "border-amber-500/50",
            job.recommendation === 'skip' && "border-foreground/20"
          )}
          onClick={() => onJobSelect?.(job.jobId, job.jobTitle)}
        >
          <div className={cn(
            "w-10 h-10 flex items-center justify-center text-background font-bold text-sm shrink-0",
            job.matchScore >= 75 && "bg-emerald-500",
            job.matchScore >= 50 && job.matchScore < 75 && "bg-amber-500",
            job.matchScore < 50 && "bg-muted-foreground"
          )}>
            {job.matchScore}%
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold truncate">{job.jobTitle}</p>
              <Badge variant="outline" className="text-[9px] rounded-none shrink-0">
                {job.recommendation === 'go' ? '✓ Match' : job.recommendation === 'maybe' ? '? À voir' : '✗ Skip'}
              </Badge>
            </div>
            {job.clientName && <p className="text-[10px] text-muted-foreground">chez {job.clientName}</p>}
            <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{job.summary}</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {job.matchingSkills.slice(0, 3).map((s, si) => (
                <span key={si} className="text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">✓ {s}</span>
              ))}
              {job.missingSkills.slice(0, 2).map((s, si) => (
                <span key={si} className="text-[9px] px-1.5 py-0.5 bg-destructive/10 text-destructive border border-destructive/20">✗ {s}</span>
              ))}
            </div>
            {job.recommendation === 'go' && onAddToPipeline && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] mt-2 rounded-none gap-1"
                onClick={(e) => { e.stopPropagation(); onAddToPipeline(job.jobId, job.jobTitle); }}
              >
                <UserPlus className="w-3 h-3" /> Ajouter au pipeline
              </Button>
            )}
          </div>
        </button>
      ))}
    </div>
  );
};

// ─── History Panel ────────────────────────────────────────────────

const HistoryPanel: React.FC<{ data: CandidateHistoryData | null; loading: boolean }> = ({ data, loading }) => {
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-none" />
        <Skeleton className="h-16 w-full rounded-none" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-xs text-muted-foreground text-center py-6">Aucun historique trouvé pour ce candidat</p>;
  }

  const hasHistory = data.shortlists.length > 0 || data.placements.length > 0 || data.notes.length > 0 || data.appointments.length > 0;

  if (!hasHistory && !data.candidate) {
    return <p className="text-xs text-muted-foreground text-center py-6">Aucun historique</p>;
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <img src={airtableLogo} alt="" className="w-4 h-4" />
        <span className="text-xs font-bold uppercase tracking-wide">Historique Airtable</span>
        {data.candidate?.status && (
          <Badge variant="outline" className="text-[10px] rounded-none">{data.candidate.status}</Badge>
        )}
      </div>

      {/* Contact info */}
      {(data.candidate?.email || data.candidate?.phone) && (
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {data.candidate?.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{data.candidate.email}</span>}
          {data.candidate?.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{data.candidate.phone}</span>}
        </div>
      )}

      {/* Placements */}
      {data.placements.length > 0 && (
        <HistorySection icon={<Trophy className="w-3.5 h-3.5 text-amber-500" />} title="Placements" count={data.placements.length}>
          {data.placements.map((p, i) => (
            <div key={i} className="flex items-start gap-2 py-2 border-b border-border/30 last:border-0">
              <Building2 className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{p.name || 'Placement'}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                  {p.company_name && <span>{p.company_name}</span>}
                  {p.status && <Badge variant="outline" className="text-[9px] h-3.5 px-1 rounded-none">{p.status}</Badge>}
                  {p.start_date && <span>{p.start_date}</span>}
                  {p.salary && <span className="text-emerald-600 font-medium">{p.salary}</span>}
                </div>
              </div>
            </div>
          ))}
        </HistorySection>
      )}

      {/* Shortlists */}
      {data.shortlists.length > 0 && (
        <HistorySection icon={<Star className="w-3.5 h-3.5 text-blue-500" />} title="Shortlists" count={data.shortlists.length}>
          {data.shortlists.map((s, i) => (
            <div key={i} className="flex items-start gap-2 py-2 border-b border-border/30 last:border-0">
              <Briefcase className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{s.job_title || 'Poste non spécifié'}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                  {s.company_name && <span>{s.company_name}</span>}
                  {s.status && <Badge variant="outline" className="text-[9px] h-3.5 px-1 rounded-none">{s.status}</Badge>}
                  {s.date_added && <span>{s.date_added}</span>}
                </div>
              </div>
            </div>
          ))}
        </HistorySection>
      )}

      {/* Appointments */}
      {data.appointments.length > 0 && (
        <HistorySection icon={<Calendar className="w-3.5 h-3.5 text-purple-500" />} title="Rendez-vous" count={data.appointments.length}>
          {data.appointments.map((a, i) => (
            <div key={i} className="flex items-start gap-2 py-2 border-b border-border/30 last:border-0">
              <Clock className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{a.title || a.appointment_type || 'RDV'}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {a.appointment_date && <span>{a.appointment_date}</span>}
                  {a.status && <Badge variant="outline" className="text-[9px] h-3.5 px-1 rounded-none">{a.status}</Badge>}
                </div>
              </div>
            </div>
          ))}
        </HistorySection>
      )}

      {/* Notes */}
      {data.notes.length > 0 && (
        <HistorySection icon={<FileText className="w-3.5 h-3.5 text-teal-500" />} title="Notes" count={data.notes.length}>
          {data.notes.slice(0, 5).map((n, i) => (
            <div key={i} className="py-2 border-b border-border/30 last:border-0">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-0.5">
                {(n.author || n.consultant) && <span className="flex items-center gap-0.5"><User className="w-2.5 h-2.5" />{n.consultant || n.author}</span>}
                {n.note_date && <span>{n.note_date}</span>}
              </div>
              {n.title && <p className="text-xs font-medium">{n.title}</p>}
              {n.detail && <p className="text-[11px] text-muted-foreground line-clamp-2">{n.detail}</p>}
            </div>
          ))}
        </HistorySection>
      )}

      {!hasHistory && data.candidate && (
        <p className="text-xs text-muted-foreground text-center py-4">
          Candidat trouvé mais aucun historique.
        </p>
      )}
    </div>
  );
};

const HistorySection: React.FC<{
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}> = ({ icon, title, count, children }) => {
  const [open, setOpen] = React.useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-left py-1.5 hover:bg-brutal-accent/10 px-1 -mx-1 transition-colors">
        {icon}
        <span className="text-xs font-bold uppercase tracking-wide flex-1">{title}</span>
        <span className="text-[10px] text-muted-foreground">{count}</span>
        <ChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-5">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
};
