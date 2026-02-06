import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  Languages,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface JobMatch {
  jobId: string;
  jobTitle: string;
  clientName?: string;
  matchScore: number;
  recommendation: 'go' | 'maybe' | 'skip';
}

interface ConversationSummaryProps {
  summary: string;
  intent: string;
  intentConfidence: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  engagement: 'high' | 'medium' | 'low';
  detectedLanguage?: 'fr' | 'en' | 'other';
  topJobMatch?: JobMatch;
  qualificationQuestions?: string[];
  loading?: boolean;
  className?: string;
}

const sentimentIcons = {
  positive: <TrendingUp className="w-3 h-3" />,
  neutral: <Minus className="w-3 h-3" />,
  negative: <TrendingDown className="w-3 h-3" />,
};

const sentimentColors = {
  positive: 'text-green-600 bg-green-50',
  neutral: 'text-gray-600 bg-gray-50',
  negative: 'text-red-600 bg-red-50',
};

const engagementColors = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-gray-100 text-gray-600',
};

export const ConversationSummary: React.FC<ConversationSummaryProps> = ({
  summary,
  intent,
  intentConfidence,
  sentiment,
  engagement,
  detectedLanguage,
  topJobMatch,
  qualificationQuestions,
  loading,
  className,
}) => {
  if (loading) {
    return (
      <div className={cn("px-3 py-2 space-y-2", className)}>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    );
  }

  return (
    <div className={cn(
      "px-3 py-2 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100",
      className
    )}>
      {/* Main summary line */}
      <div className="flex items-start gap-2">
        <Brain className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-700 leading-relaxed">{summary}</p>
          
          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {/* Sentiment */}
            <Badge 
              variant="secondary" 
              className={cn("text-[10px] h-5 gap-1", sentimentColors[sentiment])}
            >
              {sentimentIcons[sentiment]}
              {sentiment === 'positive' ? 'Positif' : sentiment === 'negative' ? 'Négatif' : 'Neutre'}
            </Badge>
            
            {/* Engagement */}
            <Badge 
              variant="secondary" 
              className={cn("text-[10px] h-5", engagementColors[engagement])}
            >
              Eng. {engagement === 'high' ? 'élevé' : engagement === 'medium' ? 'moyen' : 'faible'}
            </Badge>
            
            {/* Intent confidence */}
            <Badge 
              variant="outline" 
              className="text-[10px] h-5"
            >
              {intentConfidence}% confiance
            </Badge>
            
            {/* Detected language */}
            {detectedLanguage && (
              <Badge 
                variant="secondary" 
                className="text-[10px] h-5 gap-1 bg-blue-50 text-blue-700"
              >
                <Languages className="w-2.5 h-2.5" />
                {detectedLanguage === 'fr' ? 'FR' : detectedLanguage === 'en' ? 'EN' : 'Autre'}
              </Badge>
            )}
            
            {/* Top job match score */}
            {topJobMatch && (
              <Badge 
                variant="secondary" 
                className={cn(
                  "text-[10px] h-5",
                  topJobMatch.matchScore >= 70 ? "bg-emerald-100 text-emerald-700" :
                  topJobMatch.matchScore >= 50 ? "bg-amber-100 text-amber-700" :
                  "bg-gray-100 text-gray-600"
                )}
              >
                Match {topJobMatch.matchScore}%
              </Badge>
            )}
          </div>
        </div>
      </div>
      
      {/* Qualification questions preview */}
      {qualificationQuestions && qualificationQuestions.length > 0 && (
        <div className="mt-2 pl-5">
          <div className="flex items-center gap-1 text-[10px] text-amber-600">
            <HelpCircle className="w-3 h-3" />
            <span className="font-medium">À clarifier:</span>
            <span className="text-amber-700">
              {qualificationQuestions.slice(0, 3).join(' • ')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
