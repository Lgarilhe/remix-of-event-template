import React, { useMemo, useState } from 'react';
import { JobCandidateStatus } from '@/hooks/useJobCandidateStatus';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ExternalLink, Mail, Archive, Star, Target, Undo2, User } from 'lucide-react';

type StatusTab = 'all' | 'messaged' | 'shortlisted' | 'dismissed' | 'scored';

const STATUS_TABS: { value: StatusTab; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'all', label: 'Tous', icon: <User className="w-3.5 h-3.5" />, color: '' },
  { value: 'messaged', label: 'Contactés', icon: <Mail className="w-3.5 h-3.5" />, color: 'text-blue-600' },
  { value: 'shortlisted', label: 'Shortlistés', icon: <Star className="w-3.5 h-3.5" />, color: 'text-amber-600' },
  { value: 'scored', label: 'Scorés', icon: <Target className="w-3.5 h-3.5" />, color: 'text-purple-600' },
  { value: 'dismissed', label: 'Écartés', icon: <Archive className="w-3.5 h-3.5" />, color: 'text-red-500' },
];

interface TreatedCandidatesListProps {
  statuses: Map<string, JobCandidateStatus>;
  onRestore?: (candidateId: string) => void;
}

export const TreatedCandidatesList: React.FC<TreatedCandidatesListProps> = ({
  statuses,
  onRestore,
}) => {
  const [activeTab, setActiveTab] = useState<StatusTab>('all');

  const candidates = useMemo(() => {
    const list = Array.from(statuses.values());
    
    const filtered = list.filter(c => {
      switch (activeTab) {
        case 'messaged': return c.status === 'messaged' || c.status === 'replied';
        case 'shortlisted': return c.status === 'shortlisted';
        case 'dismissed': return c.status === 'dismissed';
        case 'scored': return c.score != null && c.score > 0;
        default: return true;
      }
    });

    // Sort by most recent first
    return filtered.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [statuses, activeTab]);

  const counts = useMemo(() => {
    const list = Array.from(statuses.values());
    return {
      all: list.length,
      messaged: list.filter(c => c.status === 'messaged' || c.status === 'replied').length,
      shortlisted: list.filter(c => c.status === 'shortlisted').length,
      dismissed: list.filter(c => c.status === 'dismissed').length,
      scored: list.filter(c => c.score != null && c.score > 0).length,
    };
  }, [statuses]);

  return (
    <div className="flex flex-col h-full">
      {/* Status tabs */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border overflow-x-auto shrink-0">
        {STATUS_TABS.map(tab => (
          <Button
            key={tab.value}
            variant={activeTab === tab.value ? 'default' : 'ghost'}
            size="sm"
            className={`h-7 px-2.5 text-xs gap-1.5 whitespace-nowrap ${activeTab !== tab.value ? tab.color : ''}`}
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.icon}
            {tab.label}
            {counts[tab.value] > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {counts[tab.value]}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {/* Candidates list */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {candidates.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <User className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Aucun profil dans cette catégorie</p>
            </div>
          ) : (
            candidates.map(candidate => (
              <TreatedCandidateCard
                key={candidate.id}
                candidate={candidate}
                onRestore={onRestore}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

// Individual card
const TreatedCandidateCard: React.FC<{
  candidate: JobCandidateStatus;
  onRestore?: (candidateId: string) => void;
}> = ({ candidate, onRestore }) => {
  const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    messaged: { label: 'Contacté', color: 'bg-blue-100 text-blue-700', icon: <Mail className="w-3 h-3" /> },
    replied: { label: 'Répondu', color: 'bg-green-100 text-green-700', icon: <Mail className="w-3 h-3" /> },
    shortlisted: { label: 'Shortlisté', color: 'bg-amber-100 text-amber-700', icon: <Star className="w-3 h-3" /> },
    dismissed: { label: 'Écarté', color: 'bg-red-100 text-red-700', icon: <Archive className="w-3 h-3" /> },
  };

  const config = statusConfig[candidate.status] || statusConfig.dismissed;

  const scoreColor = candidate.score != null
    ? candidate.score >= 70 ? 'text-green-600 bg-green-50 border-green-200'
    : candidate.score >= 45 ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-red-500 bg-red-50 border-red-200'
    : '';

  const recommendationLabel: Record<string, string> = {
    go: '✅ Go',
    maybe: '🤔 Maybe',
    skip: '❌ Skip',
  };

  return (
    <div className="bg-background border border-foreground p-3 shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_0px_hsl(var(--brutal-accent))] transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Name + LinkedIn link */}
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-medium text-sm truncate">
              {candidate.candidate_name || 'Candidat inconnu'}
            </h4>
            {candidate.linkedin_profile_url && (
              <a
                href={candidate.linkedin_profile_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#0077B5] hover:text-[#005885] shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          {/* Headline */}
          {candidate.candidate_headline && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
              {candidate.candidate_headline}
            </p>
          )}

          {/* Score + Recommendation + Status */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${config.color}`}>
              {config.icon}
              {config.label}
            </span>

            {candidate.score != null && candidate.score > 0 && (
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${scoreColor}`}>
                <Target className="w-3 h-3" />
                {candidate.score}/100
              </span>
            )}

            {candidate.recommendation && (
              <span className="text-xs text-muted-foreground">
                {recommendationLabel[candidate.recommendation] || candidate.recommendation}
              </span>
            )}
          </div>

          {/* Skip reason */}
          {candidate.status === 'dismissed' && candidate.skip_reason && (
            <p className="text-xs text-red-500/80 mt-1.5 line-clamp-2">
              {candidate.skip_reason}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {candidate.status === 'dismissed' && onRestore && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1 text-green-600 hover:text-green-700"
              onClick={() => onRestore(candidate.candidate_id)}
            >
              <Undo2 className="w-3.5 h-3.5" />
              Restaurer
            </Button>
          )}
        </div>
      </div>

      {/* Date */}
      <p className="text-[10px] text-muted-foreground/50 mt-2">
        {new Date(candidate.updated_at).toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
    </div>
  );
};
