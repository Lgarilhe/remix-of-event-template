import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Brain, 
  Sparkles, 
  TrendingUp, 
  TrendingDown,
  Minus,
  Heart,
  ThumbsUp,
  ThumbsDown,
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
  UserCheck,
  UserX,
  HelpCircle,
  Briefcase,
  Send,
  RefreshCw
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

interface AnalysisContext {
  recipientName: string;
  recipientHeadline?: string;
  messages: Message[];
  jobContext?: {
    title: string;
    company?: string;
  };
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

interface AnalysisResult {
  intent: 'interested' | 'not_interested' | 'needs_info' | 'wants_call' | 'timing_issue' | 'already_placed' | 'neutral';
  intentConfidence: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  engagement: 'high' | 'medium' | 'low';
  suggestedActions: SuggestedAction[];
  suggestedTags: string[];
  summary: string;
  replySuggestions: ReplySuggestion[];
}

interface NurturingPanelProps {
  context: AnalysisContext;
  onSuggestionSelect: (text: string) => void;
  onSuggestionSend: (text: string) => void;
  sending?: boolean;
  className?: string;
}

const intentConfig: Record<string, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  interested: { 
    label: 'Intéressé', 
    icon: <ThumbsUp className="w-4 h-4" />, 
    color: 'text-green-600',
    bgColor: 'bg-green-50 border-green-200'
  },
  not_interested: { 
    label: 'Pas intéressé', 
    icon: <ThumbsDown className="w-4 h-4" />, 
    color: 'text-red-600',
    bgColor: 'bg-red-50 border-red-200'
  },
  needs_info: { 
    label: 'Demande d\'infos', 
    icon: <HelpCircle className="w-4 h-4" />, 
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 border-blue-200'
  },
  wants_call: { 
    label: 'Veut un call', 
    icon: <Phone className="w-4 h-4" />, 
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50 border-emerald-200'
  },
  timing_issue: { 
    label: 'Timing pas bon', 
    icon: <Clock className="w-4 h-4" />, 
    color: 'text-amber-600',
    bgColor: 'bg-amber-50 border-amber-200'
  },
  already_placed: { 
    label: 'Déjà placé', 
    icon: <Briefcase className="w-4 h-4" />, 
    color: 'text-slate-600',
    bgColor: 'bg-slate-50 border-slate-200'
  },
  neutral: { 
    label: 'Neutre', 
    icon: <Minus className="w-4 h-4" />, 
    color: 'text-gray-600',
    bgColor: 'bg-gray-50 border-gray-200'
  },
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

export const NurturingPanel: React.FC<NurturingPanelProps> = ({
  context,
  onSuggestionSelect,
  onSuggestionSend,
  sending = false,
  className,
}) => {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [actionsExpanded, setActionsExpanded] = useState(false);
  
  // Track if we've analyzed the current messages
  const [lastAnalyzedHash, setLastAnalyzedHash] = useState<string>('');

  // Create a hash of messages to detect changes
  const getMessagesHash = useCallback(() => {
    return context.messages.slice(-5).map(m => `${m.is_sender}-${m.text.slice(0, 50)}`).join('|');
  }, [context.messages]);

  // Check if we have a candidate message to analyze
  const hasCandidateMessage = context.messages.some(m => !m.is_sender);
  const lastMessage = context.messages[context.messages.length - 1];
  const needsAnalysis = lastMessage && !lastMessage.is_sender;

  const analyzeResponse = useCallback(async () => {
    if (!hasCandidateMessage || !needsAnalysis) return;
    
    const currentHash = getMessagesHash();
    if (currentHash === lastAnalyzedHash) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await supabase.functions.invoke('analyze-response', {
        body: { context },
      });

      if (response.error) throw response.error;
      
      if (response.data?.success && response.data?.analysis) {
        setAnalysis(response.data.analysis);
        setLastAnalyzedHash(currentHash);
      } else if (response.data?.error) {
        throw new Error(response.data.error);
      }
    } catch (err) {
      console.error('Error analyzing response:', err);
      setError(err instanceof Error ? err.message : 'Erreur d\'analyse');
    } finally {
      setLoading(false);
    }
  }, [context, hasCandidateMessage, needsAnalysis, getMessagesHash, lastAnalyzedHash]);

  // Auto-analyze when there's a new candidate message
  useEffect(() => {
    if (needsAnalysis && !loading && !analysis) {
      analyzeResponse();
    }
  }, [needsAnalysis, loading, analysis, analyzeResponse]);

  // Reset when conversation changes
  useEffect(() => {
    const currentHash = getMessagesHash();
    if (currentHash !== lastAnalyzedHash) {
      setAnalysis(null);
    }
  }, [getMessagesHash, lastAnalyzedHash]);

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

  if (!hasCandidateMessage) {
    return null;
  }

  // Don't show anything if we sent the last message and haven't analyzed yet
  if (!needsAnalysis && !analysis) {
    return null;
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className={cn(
        "border-t border-[#1A1A1A]/10 bg-gradient-to-b from-violet-50/50 to-white",
        className
      )}>
        {/* Header */}
        <CollapsibleTrigger asChild>
          <button className="w-full px-4 py-2 flex items-center justify-between hover:bg-violet-50/50 transition-colors">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-violet-100">
                <Brain className="w-4 h-4 text-violet-600" />
              </div>
              <span className="font-medium text-sm text-violet-900">Analyse IA & Nurturing</span>
              {analysis && (
                <Badge 
                  variant="secondary" 
                  className={cn("text-[10px] h-5", intentConfig[analysis.intent]?.bgColor)}
                >
                  {intentConfig[analysis.intent]?.label}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin text-violet-500" />}
              {!loading && analysis && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAnalysis(null);
                    setLastAnalyzedHash('');
                    setTimeout(() => analyzeResponse(), 100);
                  }}
                >
                  <RefreshCw className="w-3 h-3" />
                </Button>
              )}
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-3">
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
                {/* Analysis Summary Card */}
                <div className={cn(
                  "rounded-lg border p-3 space-y-2",
                  intentConfig[analysis.intent]?.bgColor
                )}>
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
                    
                    {/* Sentiment & Engagement badges */}
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

                  {/* Tags */}
                  {analysis.suggestedTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {analysis.suggestedTags.map((tag, i) => (
                        <Badge 
                          key={i} 
                          variant="outline" 
                          className="text-[10px] h-5 cursor-pointer hover:bg-violet-100 transition-colors"
                          onClick={() => {
                            toast.success(`Tag "${tag}" ajouté`);
                          }}
                        >
                          <Tag className="w-2.5 h-2.5 mr-1" />
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Reply Suggestions */}
                {analysis.replySuggestions.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                      <span className="text-xs font-medium text-violet-700">Réponses suggérées</span>
                    </div>
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
                            {sending ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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
            ) : needsAnalysis ? (
              <div className="text-center py-4">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={analyzeResponse}
                  className="gap-2"
                >
                  <Brain className="w-4 h-4" />
                  Analyser la réponse
                </Button>
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
