import React, { useState, useMemo } from 'react';
import { ATSCandidate, ATS_STAGES } from '@/hooks/useATSData';
import { CompanyLogo } from './CompanyLogo';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { LayoutGrid, List, Loader2, Search, X, User, Star } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/EmptyState';
import linkedinLogo from '@/assets/linkedin-logo.webp';

/** Shortlist-worthy stages (advanced pipeline stages) */
const SHORTLIST_STAGES = [
  { key: 'Pressenti', label: 'Pressenti', color: 'bg-muted border-border' },
  { key: 'Pré-qualif', label: 'Pré-qualif', color: 'bg-brand-cyan/10 border-brand-cyan/30' },
  { key: 'CV envoyé', label: 'CV envoyé', color: 'bg-info/10 border-info/30' },
  { key: 'ITW en cours', label: 'ITW en cours', color: 'bg-warning/10 border-warning/30' },
  { key: 'Offre', label: 'Offre', color: 'bg-brand-purple/10 border-brand-purple/30' },
  { key: 'Gagné', label: 'Gagné', color: 'bg-success/10 border-success/30' },
  { key: 'Perdu', label: 'Perdu', color: 'bg-destructive/10 border-destructive/30' },
];

const SHORTLIST_STAGE_KEYS = new Set(SHORTLIST_STAGES.map(s => s.key));

interface ShortlistSpaceProps {
  candidates: ATSCandidate[];
  loading: boolean;
  onStageChange: (candidateId: string, newStage: string) => void;
  onTagsChange?: (candidateId: string, tags: string[]) => void;
  onRefresh: () => void;
}

/** Extract company name from headline */
function extractCompany(headline: string | null): string | null {
  if (!headline) return null;
  for (const pattern of [/ at /i, / chez /i, / @ /i, / \| /i]) {
    const parts = headline.split(pattern);
    if (parts.length >= 2) return parts[parts.length - 1].trim();
  }
  const dashParts = headline.split(' - ');
  if (dashParts.length >= 2) return dashParts[dashParts.length - 1].trim();
  return null;
}

export const ShortlistSpace: React.FC<ShortlistSpaceProps> = ({
  candidates,
  loading,
  onStageChange,
  onTagsChange,
  onRefresh,
}) => {
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [search, setSearch] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);

  // Filter to shortlist-worthy stages
  const shortlistCandidates = useMemo(() => {
    return candidates.filter(c => SHORTLIST_STAGE_KEYS.has(c.stage));
  }, [candidates]);

  // Apply search filter
  const filteredCandidates = useMemo(() => {
    if (!search) return shortlistCandidates;
    const s = search.toLowerCase();
    return shortlistCandidates.filter(c =>
      c.name?.toLowerCase().includes(s) ||
      c.headline?.toLowerCase().includes(s) ||
      c.jobTitle?.toLowerCase().includes(s)
    );
  }, [shortlistCandidates, search]);

  // Group by stage for kanban
  const kanbanData = useMemo(() => {
    const grouped: Record<string, ATSCandidate[]> = {};
    SHORTLIST_STAGES.forEach(stage => { grouped[stage.key] = []; });
    filteredCandidates.forEach(c => {
      if (grouped[c.stage]) grouped[c.stage].push(c);
    });
    return grouped;
  }, [filteredCandidates]);

  // Stats
  const totalShortlist = shortlistCandidates.length;
  const wonCount = kanbanData['Gagné']?.length || 0;
  const lostCount = kanbanData['Perdu']?.length || 0;
  const activeCount = totalShortlist - wonCount - lostCount;

  const viewTabs = [
    { value: 'kanban' as const, label: 'Kanban', icon: LayoutGrid },
    { value: 'list' as const, label: 'Liste', icon: List },
  ];

  if (loading && candidates.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (shortlistCandidates.length === 0 && !loading) {
    return (
      <EmptyState
        icon={<Star className="w-7 h-7" />}
        title="Aucun candidat en shortlist"
        description="Les candidats apparaissent ici lorsqu'ils atteignent les étapes avancées du pipeline (Pressenti, Pré-qualif, CV envoyé, etc.)."
        actionLabel="Voir le pipeline"
        actionHref="/pipeline"
      />
    );
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div className="flex gap-0">
          {viewTabs.map((tab, index) => {
            const Icon = tab.icon;
            const isActive = viewMode === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => setViewMode(tab.value)}
                className={cn(
                  "relative overflow-hidden flex items-center gap-1.5 h-9 px-4 text-xs font-medium uppercase tracking-wider border border-border transition-colors duration-200",
                  index > 0 && "border-l-0",
                  isActive ? "bg-accent text-foreground" : "bg-background text-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm border-border"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-0 mb-4 border border-border bg-background">
        <div className="p-3 border-r border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">En cours</p>
          <p className="text-xl font-bold text-foreground">{activeCount}</p>
        </div>
        <div className="p-3 border-r border-border bg-success/5">
          <p className="text-xs text-success uppercase tracking-wider mb-0.5">Gagnés</p>
          <p className="text-xl font-bold text-success">{wonCount}</p>
        </div>
        <div className="p-3 bg-destructive/5">
          <p className="text-xs text-destructive uppercase tracking-wider mb-0.5">Perdus</p>
          <p className="text-xl font-bold text-destructive">{lostCount}</p>
        </div>
      </div>

      {/* Kanban view */}
      {viewMode === 'kanban' && (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {SHORTLIST_STAGES.map(stage => {
            const stageCandidates = kanbanData[stage.key] || [];
            return (
              <div key={stage.key} className="min-w-[260px] w-[260px] shrink-0">
                {/* Column header */}
                <div className={cn("px-3 py-2 border border-border mb-2 flex items-center justify-between", stage.color)}>
                  <span className="text-xs font-medium uppercase tracking-wider">{stage.label}</span>
                  <span className="text-xs text-muted-foreground font-bold">{stageCandidates.length}</span>
                </div>
                {/* Cards */}
                <div className="space-y-2">
                  {stageCandidates.map(candidate => {
                    const company = extractCompany(candidate.headline);
                    return (
                      <div
                        key={candidate.id}
                        className="bg-background border border-border p-3 hover:shadow-md transition-shadow cursor-pointer"
                        onClick={() => setSelectedCandidate(candidate)}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-muted border border-border flex items-center justify-center shrink-0 mt-0.5">
                            <User className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium text-foreground truncate">{candidate.name}</p>
                              {candidate.linkedin && (
                                <a
                                  href={candidate.linkedin}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="shrink-0"
                                >
                                  <img src={linkedinLogo} alt="LinkedIn" className="w-3 h-3 opacity-60 hover:opacity-100" />
                                </a>
                              )}
                            </div>
                            {company && (
                              <div className="flex items-center gap-1.5 mt-1">
                                <CompanyLogo company={company} size="sm" />
                                <span className="text-xs text-muted-foreground truncate">{company}</span>
                              </div>
                            )}
                            {candidate.jobTitle && (
                              <p className="text-[11px] text-muted-foreground/70 mt-1 truncate">
                                {candidate.jobTitle}
                              </p>
                            )}
                            {candidate.score != null && (
                              <div className="mt-1.5 flex items-center gap-1">
                                <div className="h-1 flex-1 bg-muted overflow-hidden border border-border">
                                  <div
                                    className={cn(
                                      "h-full transition-all",
                                      candidate.score >= 70 ? "bg-success" : candidate.score >= 40 ? "bg-warning" : "bg-destructive"
                                    )}
                                    style={{ width: `${candidate.score}%` }}
                                  />
                                </div>
                                <span className="text-[10px] font-bold text-muted-foreground">{candidate.score}%</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {stageCandidates.length === 0 && (
                    <div className="border border-dashed border-border p-4 text-center">
                      <p className="text-xs text-muted-foreground">Aucun candidat</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && (
        <div className="border border-border bg-background divide-y divide-border">
          {filteredCandidates.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground text-sm">Aucun candidat ne correspond à vos critères</p>
            </div>
          ) : (
            filteredCandidates.map(candidate => {
              const company = extractCompany(candidate.headline);
              return (
                <div
                  key={candidate.id}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-accent/30 transition-colors cursor-pointer"
                  onClick={() => setSelectedCandidate(candidate)}
                >
                  <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{candidate.name}</p>
                      {candidate.linkedin && (
                        <a href={candidate.linkedin} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="shrink-0">
                          <img src={linkedinLogo} alt="LinkedIn" className="w-3.5 h-3.5 opacity-60 hover:opacity-100" />
                        </a>
                      )}
                    </div>
                    {candidate.headline && (
                      <p className="text-xs text-muted-foreground truncate">{candidate.headline}</p>
                    )}
                  </div>
                  {company && (
                    <div className="flex items-center gap-2 shrink-0">
                      <CompanyLogo company={company} size="sm" />
                      <span className="text-sm text-foreground max-w-[150px] truncate hidden sm:block">{company}</span>
                    </div>
                  )}
                  <span className="inline-block text-xs px-2 py-1 bg-muted text-muted-foreground border border-border shrink-0">
                    {candidate.stage}
                  </span>
                  {candidate.score != null && (
                    <span className={cn(
                      "text-xs font-bold shrink-0",
                      candidate.score >= 70 ? "text-success" : candidate.score >= 40 ? "text-warning" : "text-destructive"
                    )}>
                      {candidate.score}%
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Detail modal */}
      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onStageChange={onStageChange}
          onTagsChange={onTagsChange}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
};
