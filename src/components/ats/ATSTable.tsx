import React, { useState, useMemo } from 'react';
import { ATSCandidate } from '@/pages/ATS';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Linkedin, 
  Mail, 
  StickyNote, 
  Bell,
  ExternalLink,
  GitBranch,
  FileText,
  Send
} from 'lucide-react';

interface ATSTableProps {
  candidates: ATSCandidate[];
  onCandidateClick: (candidate: ATSCandidate) => void;
}

type SortKey = 'name' | 'stage' | 'source' | 'jobTitle' | 'lastActivity' | 'createdAt';
type SortDirection = 'asc' | 'desc';

const SOURCE_LABELS: Record<string, string> = {
  shortlist: 'Pipeline',
  sequence: 'Séquence',
  inmail: 'InMail',
};

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  shortlist: <FileText className="w-3 h-3" />,
  sequence: <GitBranch className="w-3 h-3" />,
  inmail: <Send className="w-3 h-3" />,
};

export const ATSTable: React.FC<ATSTableProps> = ({ candidates, onCandidateClick }) => {
  const [sortKey, setSortKey] = useState<SortKey>('lastActivity');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const sortedCandidates = useMemo(() => {
    return [...candidates].sort((a, b) => {
      let aVal: string | number | null = null;
      let bVal: string | number | null = null;

      switch (sortKey) {
        case 'name':
          aVal = a.name?.toLowerCase() || '';
          bVal = b.name?.toLowerCase() || '';
          break;
        case 'stage':
          aVal = a.stage;
          bVal = b.stage;
          break;
        case 'source':
          aVal = a.source;
          bVal = b.source;
          break;
        case 'jobTitle':
          aVal = a.jobTitle?.toLowerCase() || '';
          bVal = b.jobTitle?.toLowerCase() || '';
          break;
        case 'lastActivity':
          aVal = a.lastActivity || '';
          bVal = b.lastActivity || '';
          break;
        case 'createdAt':
          aVal = a.createdAt || '';
          bVal = b.createdAt || '';
          break;
      }

      if (aVal === null || aVal === '') return 1;
      if (bVal === null || bVal === '') return -1;

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [candidates, sortKey, sortDirection]);

  const SortButton = ({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => handleSort(sortKeyVal)}
      className="gap-1 -ml-3 font-medium"
    >
      {label}
      <ArrowUpDown className="w-3 h-3" />
    </Button>
  );

  return (
    <div className="bg-white rounded-xl border border-[#1A1A1A]/10 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-[#FAFAFA]">
            <TableHead className="w-[250px]">
              <SortButton label="Candidat" sortKeyVal="name" />
            </TableHead>
            <TableHead className="w-[120px]">
              <SortButton label="Étape" sortKeyVal="stage" />
            </TableHead>
            <TableHead className="w-[100px]">
              <SortButton label="Source" sortKeyVal="source" />
            </TableHead>
            <TableHead className="w-[200px]">
              <SortButton label="Poste" sortKeyVal="jobTitle" />
            </TableHead>
            <TableHead className="w-[150px]">Séquence</TableHead>
            <TableHead className="w-[100px]">
              <SortButton label="Activité" sortKeyVal="lastActivity" />
            </TableHead>
            <TableHead className="w-[80px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedCandidates.map(candidate => (
            <TableRow 
              key={candidate.id} 
              className="cursor-pointer hover:bg-[#FAFAFA]"
              onClick={() => onCandidateClick(candidate)}
            >
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[#1A1A1A] truncate">
                        {candidate.name}
                      </span>
                      {candidate.hasReminder && (
                        <Bell className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      )}
                      {(candidate.notesCount || 0) > 0 && (
                        <div className="flex items-center gap-0.5 text-[#1A1A1A]/50 flex-shrink-0">
                          <StickyNote className="w-3.5 h-3.5" />
                          <span className="text-[10px]">{candidate.notesCount}</span>
                        </div>
                      )}
                    </div>
                    {candidate.headline && (
                      <p className="text-xs text-[#1A1A1A]/60 truncate max-w-[200px]">
                        {candidate.headline}
                      </p>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {candidate.stage}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs gap-1">
                  {SOURCE_ICONS[candidate.source]}
                  {SOURCE_LABELS[candidate.source]}
                </Badge>
              </TableCell>
              <TableCell>
                {candidate.jobTitle ? (
                  <span className="text-sm text-[#1A1A1A]/80 truncate block max-w-[180px]">
                    {candidate.jobTitle}
                  </span>
                ) : (
                  <span className="text-sm text-[#1A1A1A]/40">—</span>
                )}
              </TableCell>
              <TableCell>
                {candidate.sequenceName ? (
                  <div className="flex items-center gap-1">
                    <GitBranch className="w-3 h-3 text-blue-500" />
                    <span className="text-xs text-[#1A1A1A]/70 truncate max-w-[120px]">
                      {candidate.sequenceName}
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-[#1A1A1A]/40">—</span>
                )}
              </TableCell>
              <TableCell>
                {candidate.lastActivity && (
                  <span className="text-xs text-[#1A1A1A]/60">
                    {new Date(candidate.lastActivity).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {candidate.linkedin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(candidate.linkedin!, '_blank');
                      }}
                    >
                      <Linkedin className="w-4 h-4 text-[#0077B5]" />
                    </Button>
                  )}
                  {candidate.email && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`mailto:${candidate.email}`, '_blank');
                      }}
                    >
                      <Mail className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}

          {sortedCandidates.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-[#1A1A1A]/50">
                Aucun candidat trouvé
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};
