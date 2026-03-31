import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MessageSquare, CheckCircle2, Star, Target, Archive, Zap, Sparkles, Loader2 } from 'lucide-react';
import { JobMatchResult, SalaryBadge } from '../JobScoreDisplay';
import airtableLogo from '@/assets/airtable-logo.svg';
import notionLogo from '@/assets/notion-logo.webp';

interface CardStatusBadgesProps {
  candidateStatus?: { status: string; score?: number | null; recommendation?: string | null } | null;
  jobScore?: JobMatchResult;
  profile: { premium?: boolean; open_to_work?: boolean };
  isLikelyToRespond: boolean;
  airtableMatch?: { airtable_id: string; source_base: string; full_name: string | null; status: string | null; match_type?: 'url' | 'fuzzy' } | null;
  notionMatch?: { id: string; name: string } | null;
  historyData?: any;
  historyLoading?: boolean;
  historyLatestDateLabel?: string | null;
}

export const CardStatusBadges: React.FC<CardStatusBadgesProps> = ({
  candidateStatus,
  jobScore,
  profile,
  isLikelyToRespond,
  airtableMatch,
  notionMatch,
  historyData,
  historyLoading,
  historyLatestDateLabel,
}) => {
  return (
    <>
      {candidateStatus && (
        <>
          {candidateStatus.status === 'messaged' && (
            <Badge className="bg-blue-500 text-white text-xs px-1.5 py-0 h-4 sm:h-5 gap-0.5 shrink-0">
              <MessageSquare className="w-2.5 h-2.5" />
              <span className="hidden sm:inline">Contacté</span>
            </Badge>
          )}
          {candidateStatus.status === 'replied' && (
            <Badge className="bg-emerald-500 text-white text-xs px-1.5 py-0 h-4 sm:h-5 gap-0.5 shrink-0">
              <CheckCircle2 className="w-2.5 h-2.5" />
              <span className="hidden sm:inline">Répondu</span>
            </Badge>
          )}
          {candidateStatus.status === 'shortlisted' && (
            <Badge className="bg-amber-500 text-white text-xs px-1.5 py-0 h-4 sm:h-5 gap-0.5 shrink-0">
              <Star className="w-2.5 h-2.5" />
              <span className="hidden sm:inline">Shortlist</span>
            </Badge>
          )}
          {candidateStatus.status === 'scored' && !jobScore && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 sm:h-5 gap-0.5 shrink-0 text-purple-600 border-purple-300 bg-purple-50">
              <Target className="w-2.5 h-2.5" />
              {candidateStatus.score && <span>{candidateStatus.score}%</span>}
            </Badge>
          )}
          {candidateStatus.status === 'dismissed' && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 sm:h-5 gap-0.5 shrink-0 text-orange-500 border-orange-300 bg-orange-50">
              <Archive className="w-2.5 h-2.5" />
              <span className="hidden sm:inline">Archivé</span>
            </Badge>
          )}
        </>
      )}
      {profile.premium && (
        <Badge variant="outline" className="text-xs px-1 sm:px-1.5 py-0 h-4 sm:h-5 text-amber-600 border-amber-300 bg-amber-50 shrink-0">
          <Star className="w-2.5 h-2.5 sm:w-3 sm:h-3 mr-0.5 fill-amber-400" />
          <span className="hidden sm:inline">Premium</span>
        </Badge>
      )}
      {profile.open_to_work && (
        <Badge className="bg-green-500 text-white text-xs px-1 sm:px-1.5 py-0 h-4 sm:h-5 gap-0.5 shrink-0">
          <Zap className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          <span className="hidden sm:inline">Open to Work</span>
          <span className="sm:hidden">OTW</span>
        </Badge>
      )}
      {isLikelyToRespond && (
        <Badge variant="outline" className="text-xs px-1 sm:px-1.5 py-0 h-4 sm:h-5 text-purple-600 border-purple-300 bg-purple-50 shrink-0 hidden sm:flex">
          <Sparkles className="w-3 h-3 mr-0.5" />
          Réactif
        </Badge>
      )}
      {airtableMatch && (
        <Badge className={`text-xs px-1.5 py-0 h-4 sm:h-5 shrink-0 gap-1 cursor-default max-w-full min-w-0 ${
          airtableMatch.match_type === 'fuzzy'
            ? 'bg-teal-100 text-teal-700 border border-dashed border-teal-400'
            : 'bg-teal-500 text-white'
        }`}>
          <img src={airtableLogo} alt="Airtable" className="w-3 h-3 object-contain shrink-0" style={{ filter: airtableMatch.match_type !== 'fuzzy' ? 'brightness(10)' : 'none' }} />
          <span className="hidden sm:inline shrink-0">
            {airtableMatch.match_type === 'fuzzy' ? 'Airtable ?' : 'Airtable'}
          </span>
          {airtableMatch.status && (
            <span className={`hidden sm:inline text-xs truncate max-w-[72px] ${airtableMatch.match_type !== 'fuzzy' ? 'opacity-80' : ''}`}>
              ({airtableMatch.status})
            </span>
          )}
          {historyLoading && <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />}
          {historyData && (
            <>
              <span className="sm:hidden font-bold shrink-0">
                {historyData.placements.length + historyData.shortlists.length + historyData.notes.length + historyData.appointments.length}
              </span>
              <span className="hidden sm:inline font-bold whitespace-nowrap">
                {historyData.placements.length > 0 && `🏆${historyData.placements.length}`}
                {historyData.shortlists.length > 0 && ` ⭐${historyData.shortlists.length}`}
                {historyData.notes.length > 0 && ` 📝${historyData.notes.length}`}
                {historyData.appointments.length > 0 && ` 📅${historyData.appointments.length}`}
                {historyLatestDateLabel && <span className="hidden md:inline"> · {historyLatestDateLabel}</span>}
              </span>
            </>
          )}
        </Badge>
      )}
      {notionMatch && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-xs px-1 py-0 h-4 sm:h-5 border-gray-300 bg-gray-50 shrink-0">
              <img src={notionLogo} alt="Notion" className="w-3.5 h-3.5 object-contain" />
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-xs font-medium">Déjà dans Notion</p>
            <p className="text-xs text-muted-foreground">{notionMatch.name}</p>
          </TooltipContent>
        </Tooltip>
      )}
      {jobScore?.salary_analysis && (
        <SalaryBadge analysis={jobScore.salary_analysis} />
      )}
    </>
  );
};
