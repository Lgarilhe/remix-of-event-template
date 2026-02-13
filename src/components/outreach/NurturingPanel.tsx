import React, { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
  ChevronUp,
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
  ArrowRight,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface Message {
  text: string;
  is_sender: boolean;
  timestamp?: string;
}

interface JobData {
  id: string;
  title: string;
  client?: { name: string; sector: string } | null;
  skills: string[];
  seniority?: string;
  location?: string;
  remote?: string;
  salaryMin?: number;
  salaryMax?: number;
  tjmMin?: number;
  tjmMax?: number;
  contractType?: string;
}

interface ProfileData {
  name: string;
  headline?: string;
  currentRole?: string;
  currentCompany?: string;
  location?: string;
  skills?: string[];
  pastPositions?: string[];
}

interface AnalysisContext {
  recipientName: string;
  recipientHeadline?: string;
  messages: Message[];
  jobContext?: {
    title: string;
    company?: string;
  };
  profileData?: ProfileData;
  availableJobs?: JobData[];
}

interface SuggestedAction {
  type: 'reply' | 'sequence_change' | 'tag' | 'alert' | 'schedule_followup';
  priority: 'high' | 'medium' | 'low';
  label: string;
  description: string;
  data?: Record<string, unknown>;
}

interface ReplySuggestion {
  text: string;
  type: 'quick' | 'standard' | 'detailed';
  intent_match: string;
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
  intent: 'interested' | 'not_interested' | 'needs_info' | 'wants_call' | 'timing_issue' | 'already_placed' | 'neutral';
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

interface NurturingPanelProps {
  context: AnalysisContext;
  onSuggestionSelect: (text: string) => void;
  onSuggestionSend: (text: string) => void;
  onJobSelect?: (jobId: string, jobTitle: string) => void;
  onAddToPipeline?: (jobId?: string, jobTitle?: string) => void;
  onEnrollInSequence?: () => void;
  onScheduleCall?: () => void;
  profileId?: string;
  profileUrl?: string;
  sending?: boolean;
  className?: string;
}

const intentConfig: Record<string, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  interested: { label: 'Intéressé', icon: <ThumbsUp className="w-4 h-4" />, color: 'text-green-600', bgColor: 'bg-green-50 border-green-200' },
  not_interested: { label: 'Pas intéressé', icon: <ThumbsDown className="w-4 h-4" />, color: 'text-red-600', bgColor: 'bg-red-50 border-red-200' },
  needs_info: { label: "Demande d'infos", icon: <HelpCircle className="w-4 h-4" />, color: 'text-blue-600', bgColor: 'bg-blue-50 border-blue-200' },
  wants_call: { label: 'Veut un call', icon: <Phone className="w-4 h-4" />, color: 'text-emerald-600', bgColor: 'bg-emerald-50 border-emerald-200' },
  timing_issue: { label: 'Timing pas bon', icon: <Clock className="w-4 h-4" />, color: 'text-amber-600', bgColor: 'bg-amber-50 border-amber-200' },
  already_placed: { label: 'Déjà placé', icon: <Briefcase className="w-4 h-4" />, color: 'text-slate-600', bgColor: 'bg-slate-50 border-slate-200' },
  neutral: { label: 'Neutre', icon: <Minus className="w-4 h-4" />, color: 'text-gray-600', bgColor: 'bg-gray-50 border-gray-200' },
};

const sentimentConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  positive: { label: 'Positif', icon: <TrendingUp className="w-3 h-3" />, color: 'text-green-600' },
  neutral: { label: 'Neutre', icon: <Minus className="w-3 h-3" />, color: 'text-gray-600' },
  negative: { label: 'Négatif', icon: <TrendingDown className="w-3 h-3" />, color: 'text-red-600' },
};

const engagementConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  high: { label: 'Élevé', color: 'text-green-600', bgColor: 'bg-green-100' },
  medium: { label: 'Moyen', color: 'text-amber-600', bgColor: 'bg-amber-100' },
  low: { label: 'Faible', color: 'text-gray-500', bgColor: 'bg-gray-100' },
};

const actionIconMap: Record<string, React.ReactNode> = {
  reply: <MessageSquare className="w-4 h-4" />,
  sequence_change: <GitBranch className="w-4 h-4" />,
  tag: <Tag className="w-4 h-4" />,
  alert: <Bell className="w-4 h-4" />,
  schedule_followup: <Calendar className="w-4 h-4" />,
};

const priorityColors: Record<string, string> = {
  high: 'border-l-red-500 bg-red-50/50',
  medium: 'border-l-amber-500 bg-amber-50/50',
  low: 'border-l-gray-300 bg-gray-50/50',
};

type ActivePanel = null | 'analyze' | 'suggestions' | 'jobs';

export const NurturingPanel: React.FC<NurturingPanelProps> = ({
  context,
  onSuggestionSelect,
  onSuggestionSend,
  onJobSelect,
  onAddToPipeline,
  onEnrollInSequence,
  onScheduleCall,
  profileId,
  profileUrl,
  sending = false,
  className,
}) => {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const isAnalyzingRef = useRef(false);

  const hasCandidateMessage = context.messages.some(m => !m.is_sender);

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

  const handleButtonClick = useCallback(async (panel: ActivePanel) => {
    if (activePanel === panel) {
      setActivePanel(null);
      return;
    }
    setActivePanel(panel);

    // All panels need analysis data - fetch if not available
    if (!analysis && !loading) {
      await analyzeResponse();
    }
  }, [activePanel, analysis, loading, analyzeResponse]);

  const handleActionClick = (action: SuggestedAction) => {
    switch (action.type) {
      case 'alert':
        toast.success('🔔 Alerte créée !', { description: action.description });
        break;
      case 'tag':
        toast.success('🏷️ Tag ajouté', { description: action.label });
        break;
      case 'sequence_change':
        toast.info('🔄 Changement de séquence', { description: action.description });
        break;
      case 'schedule_followup':
        toast.info('📅 Relance planifiée', { description: action.description });
        break;
      default:
        break;
    }
  };

  const closePanel = () => setActivePanel(null);

  return (
    <div className={cn("border-t border-[#1A1A1A]/5 bg-gradient-to-b from-slate-50/30 to-white", className)}>
      {/* On-demand AI action buttons bar */}
      <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
        {/* AI Buttons */}
        {hasCandidateMessage && (
          <>
            <Button
              variant={activePanel === 'analyze' ? 'default' : 'outline'}
              size="sm"
              className={cn(
                "h-7 text-xs gap-1.5",
                activePanel === 'analyze' && "bg-violet-600 hover:bg-violet-700"
              )}
              onClick={() => handleButtonClick('analyze')}
              disabled={loading}
            >
              {loading && activePanel === 'analyze' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Brain className="w-3 h-3" />
              )}
              Analyser
            </Button>

            <Button
              variant={activePanel === 'suggestions' ? 'default' : 'outline'}
              size="sm"
              className={cn(
                "h-7 text-xs gap-1.5",
                activePanel === 'suggestions' && "bg-violet-600 hover:bg-violet-700"
              )}
              onClick={() => handleButtonClick('suggestions')}
              disabled={loading}
            >
              {loading && activePanel === 'suggestions' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              Suggérer réponses
            </Button>

            <Button
              variant={activePanel === 'jobs' ? 'default' : 'outline'}
              size="sm"
              className={cn(
                "h-7 text-xs gap-1.5",
                activePanel === 'jobs' && "bg-emerald-600 hover:bg-emerald-700"
              )}
              onClick={() => handleButtonClick('jobs')}
              disabled={loading}
            >
              {loading && activePanel === 'jobs' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Search className="w-3 h-3" />
              )}
              Matcher postes
            </Button>
          </>
        )}

        {/* Quick actions */}
        <div className="ml-auto flex items-center gap-1.5">
          {onAddToPipeline && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-blue-600 hover:bg-blue-50"
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
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-violet-600 hover:bg-violet-50"
              onClick={onEnrollInSequence}
              title="Inscrire en séquence"
            >
              <GitBranch className="w-3.5 h-3.5" />
            </Button>
          )}
          {onScheduleCall && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-50"
              onClick={onScheduleCall}
              title="Planifier un call"
            >
              <CalendarPlus className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Expandable panel content */}
      {activePanel && (
        <div className="border-t border-[#1A1A1A]/5 max-h-[300px] overflow-y-auto">
          <div className="px-4 py-3 space-y-3">
            {/* Close button */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                {activePanel === 'analyze' && <><Brain className="w-3.5 h-3.5 text-violet-500" /> Analyse de la conversation</>}
                {activePanel === 'suggestions' && <><Sparkles className="w-3.5 h-3.5 text-violet-500" /> Réponses suggérées</>}
                {activePanel === 'jobs' && <><Briefcase className="w-3.5 h-3.5 text-emerald-500" /> Postes recommandés</>}
              </span>
              <div className="flex items-center gap-1">
                {analysis && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => {
                      setAnalysis(null);
                      analyzeResponse();
                    }}
                    title="Relancer l'analyse"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={closePanel}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>

            {/* Loading state */}
            {loading && !analysis ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : error ? (
              <div className="text-center py-4">
                <p className="text-sm text-red-600">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setError(null);
                    analyzeResponse();
                  }}
                >
                  Réessayer
                </Button>
              </div>
            ) : analysis ? (
              <>
                {/* ANALYZE PANEL */}
                {activePanel === 'analyze' && (
                  <>
                    {/* Analysis Summary Card */}
                    <div className={cn("rounded-lg border p-3 space-y-2", intentConfig[analysis.intent]?.bgColor)}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className={cn("p-1.5 rounded-md bg-white/60", intentConfig[analysis.intent]?.color)}>
                            {intentConfig[analysis.intent]?.icon}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={cn("font-semibold text-sm", intentConfig[analysis.intent]?.color)}>
                                {intentConfig[analysis.intent]?.label}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                ({analysis.intentConfidence}% confiance)
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{analysis.summary}</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className={cn("flex items-center gap-1 text-xs", sentimentConfig[analysis.sentiment]?.color)}>
                            {sentimentConfig[analysis.sentiment]?.icon}
                            <span>{sentimentConfig[analysis.sentiment]?.label}</span>
                          </div>
                          <Badge
                            variant="secondary"
                            className={cn("text-[10px] h-4", engagementConfig[analysis.engagement]?.bgColor, engagementConfig[analysis.engagement]?.color)}
                          >
                            Engagement {engagementConfig[analysis.engagement]?.label.toLowerCase()}
                          </Badge>
                        </div>
                      </div>

                      {analysis.suggestedTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {analysis.suggestedTags.map((tag, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className="text-[10px] h-5 cursor-pointer hover:bg-violet-100 transition-colors"
                              onClick={() => toast.success(`Tag "${tag}" ajouté`)}
                            >
                              <Tag className="w-2.5 h-2.5 mr-1" />
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Context suggestion */}
                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                      <p className="text-[10px] text-slate-600 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-amber-500" />
                        <span className="font-medium">Suggestion :</span>
                        {analysis.intent === 'interested' && " Ce candidat semble intéressé, ajoutez-le au pipeline !"}
                        {analysis.intent === 'wants_call' && " Il veut un call, planifiez un rendez-vous."}
                        {analysis.intent === 'timing_issue' && " Le timing n'est pas bon, inscrivez-le dans une séquence de nurturing."}
                        {analysis.intent === 'needs_info' && " Il demande des infos, répondez avec les détails du poste."}
                        {analysis.intent === 'not_interested' && " Pas intéressé pour le moment, gardez le contact via une séquence."}
                        {analysis.intent === 'already_placed' && " Déjà en poste, ajoutez un rappel pour le recontacter plus tard."}
                        {analysis.intent === 'neutral' && " Continuez la conversation pour mieux qualifier ce candidat."}
                      </p>
                    </div>

                    {/* Suggested Actions */}
                    {analysis.suggestedActions.length > 0 && (
                      <Collapsible open={actionsExpanded} onOpenChange={setActionsExpanded}>
                        <CollapsibleTrigger asChild>
                          <button className="w-full flex items-center justify-between py-1.5 text-xs font-medium text-violet-700 hover:text-violet-800">
                            <div className="flex items-center gap-2">
                              <Zap className="w-3.5 h-3.5" />
                              <span>Actions de nurturing ({analysis.suggestedActions.length})</span>
                            </div>
                            {actionsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-1.5 pt-1">
                            {analysis.suggestedActions.map((action, i) => (
                              <button
                                key={i}
                                className={cn(
                                  "w-full flex items-center gap-3 p-2 rounded-lg border-l-2 text-left hover:shadow-sm transition-all",
                                  priorityColors[action.priority]
                                )}
                                onClick={() => handleActionClick(action)}
                              >
                                <div className="p-1.5 rounded-md bg-white/80">
                                  {actionIconMap[action.type]}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-[#1A1A1A]">{action.label}</p>
                                  <p className="text-[10px] text-muted-foreground truncate">{action.description}</p>
                                </div>
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    "text-[9px] h-4",
                                    action.priority === 'high' && "bg-red-100 text-red-700",
                                    action.priority === 'medium' && "bg-amber-100 text-amber-700",
                                    action.priority === 'low' && "bg-gray-100 text-gray-600"
                                  )}
                                >
                                  {action.priority === 'high' ? 'Urgent' : action.priority === 'medium' ? 'Moyen' : 'Bas'}
                                </Badge>
                              </button>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </>
                )}

                {/* SUGGESTIONS PANEL */}
                {activePanel === 'suggestions' && (
                  <>
                    {analysis.replySuggestions.length > 0 ? (
                      <div className="space-y-1.5">
                        {analysis.replySuggestions.map((suggestion, i) => (
                          <div
                            key={i}
                            className="group flex items-start gap-2 p-2 rounded-lg border border-violet-200/50 bg-white hover:border-violet-300 hover:shadow-sm transition-all cursor-pointer"
                            onClick={() => onSuggestionSelect(suggestion.text)}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-[#1A1A1A] leading-snug">{suggestion.text}</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{suggestion.intent_match}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSuggestionSend(suggestion.text);
                              }}
                              disabled={sending}
                            >
                              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground text-center py-3">Aucune suggestion disponible</p>
                    )}

                    {/* Qualification questions */}
                    {analysis.qualificationQuestions && analysis.qualificationQuestions.length > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center gap-1 text-[10px] text-amber-600 mb-1">
                          <HelpCircle className="w-3 h-3" />
                          <span className="font-medium">Questions à poser :</span>
                        </div>
                        <div className="space-y-1">
                          {analysis.qualificationQuestions.map((q, i) => (
                            <button
                              key={i}
                              className="w-full text-left text-xs text-slate-600 p-1.5 rounded hover:bg-amber-50 transition-colors"
                              onClick={() => onSuggestionSelect(q)}
                            >
                              → {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* JOBS PANEL */}
                {activePanel === 'jobs' && (
                  <>
                    {analysis.jobMatches && analysis.jobMatches.length > 0 ? (
                      <div className="space-y-1.5">
                        {analysis.jobMatches.map((job, i) => (
                          <button
                            key={i}
                            className={cn(
                              "w-full flex items-start gap-3 p-2.5 rounded-lg border text-left hover:shadow-sm transition-all",
                              job.recommendation === 'go' && "bg-emerald-50 border-emerald-200 hover:border-emerald-300",
                              job.recommendation === 'maybe' && "bg-amber-50 border-amber-200 hover:border-amber-300",
                              job.recommendation === 'skip' && "bg-gray-50 border-gray-200 hover:border-gray-300"
                            )}
                            onClick={() => onJobSelect?.(job.jobId, job.jobTitle)}
                          >
                            <div className={cn(
                              "w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0",
                              job.matchScore >= 75 && "bg-emerald-500",
                              job.matchScore >= 50 && job.matchScore < 75 && "bg-amber-500",
                              job.matchScore < 50 && "bg-gray-400"
                            )}>
                              {job.matchScore}%
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-[#1A1A1A] truncate">{job.jobTitle}</p>
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    "text-[9px] h-4 shrink-0",
                                    job.recommendation === 'go' && "bg-emerald-100 text-emerald-700",
                                    job.recommendation === 'maybe' && "bg-amber-100 text-amber-700",
                                    job.recommendation === 'skip' && "bg-gray-100 text-gray-600"
                                  )}
                                >
                                  {job.recommendation === 'go' ? '✓ Match' : job.recommendation === 'maybe' ? '? À voir' : '✗ Pas adapté'}
                                </Badge>
                              </div>
                              {job.clientName && (
                                <p className="text-[10px] text-muted-foreground mt-0.5">chez {job.clientName}</p>
                              )}
                              <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{job.summary}</p>
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {job.matchingSkills.slice(0, 3).map((skill, si) => (
                                  <span key={si} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">✓ {skill}</span>
                                ))}
                                {job.missingSkills.slice(0, 2).map((skill, si) => (
                                  <span key={si} className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600">✗ {skill}</span>
                                ))}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground text-center py-3">Aucun poste matché pour ce profil</p>
                    )}
                  </>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
