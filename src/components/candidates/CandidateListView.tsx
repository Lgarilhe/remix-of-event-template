import React, { useState, useMemo } from 'react';
import { ATSCandidate } from '@/hooks/useATSData';
import { CompanyLogo } from './CompanyLogo';
import { Linkedin, ChevronDown, ChevronUp, Mail, Phone, ArrowUpDown, Building2, User } from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import { cn } from '@/lib/utils';

interface CandidateListViewProps {
  candidates: ATSCandidate[];
  onCandidateClick?: (candidate: ATSCandidate) => void;
}

/** Extract company name from headline ("Title at Company" or "Title chez Company") */
function extractCompanyFromHeadline(headline: string | null): string | null {
  if (!headline) return null;
  // Common separators: " at ", " chez ", " @ ", " - ", " | "
  const patterns = [/ at /i, / chez /i, / @ /i, / \| /i];
  for (const pattern of patterns) {
    const parts = headline.split(pattern);
    if (parts.length >= 2) {
      return parts[parts.length - 1].trim();
    }
  }
  // Try " - " last (less reliable)
  const dashParts = headline.split(' - ');
  if (dashParts.length >= 2) {
    return dashParts[dashParts.length - 1].trim();
  }
  return null;
}

/** Extract role/title from headline */
function extractRoleFromHeadline(headline: string | null): string | null {
  if (!headline) return null;
  const patterns = [/ at /i, / chez /i, / @ /i, / \| /i];
  for (const pattern of patterns) {
    const parts = headline.split(pattern);
    if (parts.length >= 2) {
      return parts[0].trim();
    }
  }
  const dashParts = headline.split(' - ');
  if (dashParts.length >= 2) {
    return dashParts[0].trim();
  }
  return headline;
}

type SortKey = 'name' | 'company' | 'stage' | 'lastActivity';

export const CandidateListView: React.FC<CandidateListViewProps> = ({ candidates, onCandidateClick }) => {
  const [sortKey, setSortKey] = useState<SortKey>('lastActivity');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDirection('desc'); }
  };

  const enrichedCandidates = useMemo(() => {
    return candidates.map(c => ({
      ...c,
      companyName: extractCompanyFromHeadline(c.headline),
      roleName: extractRoleFromHeadline(c.headline),
    }));
  }, [candidates]);

  const sortedCandidates = useMemo(() => {
    return [...enrichedCandidates].sort((a, b) => {
      let aVal: string = '';
      let bVal: string = '';
      switch (sortKey) {
        case 'name': aVal = a.name?.toLowerCase() || ''; bVal = b.name?.toLowerCase() || ''; break;
        case 'company': aVal = a.companyName?.toLowerCase() || 'zzz'; bVal = b.companyName?.toLowerCase() || 'zzz'; break;
        case 'stage': aVal = a.stage; bVal = b.stage; break;
        case 'lastActivity': aVal = a.lastActivity || ''; bVal = b.lastActivity || ''; break;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [enrichedCandidates, sortKey, sortDirection]);

  const SortButton = ({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) => (
    <button
      onClick={() => handleSort(sortKeyVal)}
      className={cn(
        "flex items-center gap-1 text-xs font-medium uppercase tracking-wider",
        sortKey === sortKeyVal ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      <ArrowUpDown className="w-3 h-3" />
    </button>
  );

  if (candidates.length === 0) {
    return (
      <div className="bg-background border border-border p-12 text-center">
        <p className="text-muted-foreground text-sm">Aucun candidat trouvé</p>
      </div>
    );
  }

  return (
    <div className="border border-border bg-background">
      {/* Header */}
      <div className="grid grid-cols-[1fr_1fr_120px_120px] gap-4 px-4 py-3 border-b border-border bg-muted/30">
        <SortButton label="Candidat" sortKeyVal="name" />
        <SortButton label="Entreprise" sortKeyVal="company" />
        <SortButton label="Étape" sortKeyVal="stage" />
        <SortButton label="Activité" sortKeyVal="lastActivity" />
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {sortedCandidates.map(candidate => (
          <div
            key={candidate.id}
            className="grid grid-cols-[1fr_1fr_120px_120px] gap-4 px-4 py-3 hover:bg-accent/30 transition-colors cursor-pointer items-center"
            onClick={() => onCandidateClick?.(candidate)}
          >
            {/* Candidate name + role */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate">
                    {candidate.name}
                  </p>
                  {candidate.linkedin && (
                    <a
                      href={candidate.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="shrink-0"
                    >
                      <img src={linkedinLogo} alt="LinkedIn" className="w-3.5 h-3.5 opacity-60 hover:opacity-100 transition-opacity" />
                    </a>
                  )}
                </div>
                {candidate.roleName && (
                  <p className="text-xs text-muted-foreground truncate">{candidate.roleName}</p>
                )}
              </div>
            </div>

            {/* Company */}
            <div className="flex items-center gap-2.5 min-w-0">
              {candidate.companyName ? (
                <>
                  <CompanyLogo company={candidate.companyName} size="sm" />
                  <span className="text-sm text-foreground truncate">{candidate.companyName}</span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground italic">—</span>
              )}
            </div>

            {/* Stage */}
            <div>
              <span className="inline-block text-xs px-2 py-1 bg-muted text-muted-foreground border border-border truncate">
                {candidate.stage}
              </span>
            </div>

            {/* Last activity */}
            <div>
              {candidate.lastActivity ? (
                <span className="text-xs text-muted-foreground">
                  {formatRelativeDate(candidate.lastActivity)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

function formatRelativeDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Aujourd'hui";
    if (diffDays === 1) return 'Hier';
    if (diffDays < 7) return `Il y a ${diffDays}j`;
    if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)}sem`;
    if (diffDays < 365) return `Il y a ${Math.floor(diffDays / 30)}m`;
    return `Il y a ${Math.floor(diffDays / 365)}a`;
  } catch {
    return dateStr;
  }
}
