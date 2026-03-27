import React, { useState, useMemo } from 'react';
import { ATSCandidate } from '@/hooks/useATSData';
import { differenceInDays, parseISO } from 'date-fns';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  ArrowUpDown, 
  Mail, 
  StickyNote, 
  Bell,
  GitBranch,
  FileText,
  Send,
  Target,
  AlertTriangle
} from 'lucide-react';

interface ATSTableProps {
  candidates: ATSCandidate[];
  onCandidateClick: (candidate: ATSCandidate) => void;
  onJobClick?: (jobId: string) => void;
}

type SortKey = 'name' | 'stage' | 'source' | 'jobTitle' | 'lastActivity' | 'createdAt';
type SortDirection = 'asc' | 'desc';

const SOURCE_LABELS: Record<string, string> = {
  shortlist: 'Pipeline',
  sequence: 'Séquence',
  inmail: 'InMail',
  outreach: 'Outreach',
};

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  shortlist: <FileText className="w-3 h-3" />,
  sequence: <GitBranch className="w-3 h-3" />,
  inmail: <Send className="w-3 h-3" />,
  outreach: <Target className="w-3 h-3" />,
};

export const ATSTable: React.FC<ATSTableProps> = ({ candidates, onCandidateClick, onJobClick }) => {
  const [sortKey, setSortKey] = useState<SortKey>('lastActivity');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDirection('desc'); }
  };

  const sortedCandidates = useMemo(() => {
    return [...candidates].sort((a, b) => {
      let aVal: string | number | null = null;
      let bVal: string | number | null = null;

      switch (sortKey) {
        case 'name': aVal = a.name?.toLowerCase() || ''; bVal = b.name?.toLowerCase() || ''; break;
        case 'stage': aVal = a.stage; bVal = b.stage; break;
        case 'source': aVal = a.source; bVal = b.source; break;
        case 'jobTitle': aVal = a.jobTitle?.toLowerCase() || ''; bVal = b.jobTitle?.toLowerCase() || ''; break;
        case 'lastActivity': aVal = a.lastActivity || ''; bVal = b.lastActivity || ''; break;
        case 'createdAt': aVal = a.createdAt || ''; bVal = b.createdAt || ''; break;
      }

      if (aVal === null || aVal === '') return 1;
      if (bVal === null || bVal === '') return -1;
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [candidates, sortKey, sortDirection]);

  const SortButton = ({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) => (
    <button
      onClick={() => handleSort(sortKeyVal)}
      className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-foreground hover:text-brutal-accent transition-colors"
    >
      {label}
      <ArrowUpDown className="w-3 h-3" />
    </button>
  );

  return (
    <div className="bg-background border border-foreground overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-foreground/5 border-b border-foreground">
            <TableHead className="w-[250px]"><SortButton label="Candidat" sortKeyVal="name" /></TableHead>
            <TableHead className="w-[120px]"><SortButton label="Étape" sortKeyVal="stage" /></TableHead>
            <TableHead className="w-[100px]"><SortButton label="Source" sortKeyVal="source" /></TableHead>
            <TableHead className="w-[200px]"><SortButton label="Poste" sortKeyVal="jobTitle" /></TableHead>
            <TableHead className="w-[150px]"><span className="text-[11px] font-medium uppercase tracking-wider">Séquence</span></TableHead>
            <TableHead className="w-[100px]"><SortButton label="Activité" sortKeyVal="lastActivity" /></TableHead>
            <TableHead className="w-[70px]"><span className="text-[11px] font-medium uppercase tracking-wider">Score</span></TableHead>
            <TableHead className="w-[80px]"><span className="text-[11px] font-medium uppercase tracking-wider">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedCandidates.map(candidate => (
            <TableRow 
              key={candidate.id} 
              className="cursor-pointer hover:bg-brutal-accent/20 border-b border-foreground/10 transition-colors"
              onClick={() => onCandidateClick(candidate)}
            >
              <TableCell>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate text-sm">
                      {candidate.name}
                    </span>
                    {candidate.hasReminder && <Bell className="w-3.5 h-3.5 text-brutal-accent flex-shrink-0" />}
                    {(candidate.notesCount || 0) > 0 && (
                      <div className="flex items-center gap-0.5 text-muted-foreground flex-shrink-0">
                        <StickyNote className="w-3.5 h-3.5" />
                        <span className="text-[10px]">{candidate.notesCount}</span>
                      </div>
                    )}
                  </div>
                  {candidate.headline && (
                    <p className="text-xs text-muted-foreground truncate max-w-[200px]">{candidate.headline}</p>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <span className="text-[10px] px-2 py-0.5 border border-foreground/30 bg-foreground/5 uppercase tracking-wider font-medium flex items-center gap-1 w-fit">
                  {candidate.stage}
                  {(() => {
                    const GUIDE_TIMES: Record<string, number> = { 'Nouveau': 3, 'Contacté': 5, 'Répondu': 3, 'Pressenti': 5, 'Pré-qualif': 7, 'CV envoyé': 5, 'ITW en cours': 10, 'Offre': 7 };
                    const gt = GUIDE_TIMES[candidate.stage];
                    const ds = candidate.lastActivity ? differenceInDays(new Date(), parseISO(candidate.lastActivity)) : null;
                    if (gt && ds && ds > gt) return <span title={`Inactif ${ds}j (max ${gt}j)`}><AlertTriangle className="w-3 h-3 text-destructive" /></span>;
                    return null;
                  })()}
                </span>
              </TableCell>
              <TableCell>
                <span className="text-[10px] px-2 py-0.5 border border-foreground/20 flex items-center gap-1 w-fit uppercase tracking-wider">
                  {SOURCE_ICONS[candidate.source]}
                  {SOURCE_LABELS[candidate.source]}
                </span>
              </TableCell>
              <TableCell>
                {candidate.jobTitle ? (
                  <span
                    className={`text-sm text-foreground/80 truncate block max-w-[180px] ${candidate.jobId && onJobClick ? 'cursor-pointer hover:text-foreground hover:underline transition-colors' : ''}`}
                    onClick={(e) => {
                      if (candidate.jobId && onJobClick) {
                        e.stopPropagation();
                        onJobClick(candidate.jobId);
                      }
                    }}
                  >
                    {candidate.jobTitle}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {candidate.sequenceName ? (
                  <div className="flex items-center gap-1">
                    <GitBranch className="w-3 h-3 text-foreground/50" />
                    <span className="text-xs text-foreground/70 truncate max-w-[120px]">{candidate.sequenceName}</span>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {candidate.lastActivity && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(candidate.lastActivity).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {candidate.score != null ? (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 border ${
                    candidate.score >= 70 ? 'border-foreground bg-brutal-accent text-foreground' : 
                    candidate.score >= 40 ? 'border-foreground/50 text-foreground' : 'border-destructive text-destructive'
                  }`}>
                    {candidate.score}%
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {candidate.linkedin && (
                    <button
                      className="h-7 w-7 flex items-center justify-center border border-foreground/20 hover:bg-brutal-accent transition-colors"
                      onClick={(e) => { e.stopPropagation(); window.open(candidate.linkedin!, '_blank'); }}
                    >
                      <img src={linkedinLogo} alt="LinkedIn" className="w-4 h-4 object-contain" />
                    </button>
                  )}
                  {candidate.email && (
                    <button
                      className="h-7 w-7 flex items-center justify-center border border-foreground/20 hover:bg-brutal-accent transition-colors"
                      onClick={(e) => { e.stopPropagation(); window.open(`mailto:${candidate.email}`, '_blank'); }}
                    >
                      <Mail className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}

          {sortedCandidates.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-[11px] uppercase tracking-wider">
                Aucun candidat trouvé
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};