import React, { useState } from 'react';
import { SearchHistoryEntry } from '@/hooks/useSearchHistory';
import { LinkedInFiltersState } from '@/components/outreach/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { History, Trash2, Play, ChevronDown, ChevronUp, Users, MessageSquare, Archive, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { hasActiveFilters } from '@/hooks/useFilteredResults';

interface SearchHistoryProps {
  history: SearchHistoryEntry[];
  isLoading: boolean;
  onApplyFilters: (filters: LinkedInFiltersState) => void;
  onDelete: (id: string) => void;
}

function countFilters(filters: LinkedInFiltersState): number {
  let count = 0;
  if (filters.keywords) count++;
  if (filters.location?.length > 0) count++;
  if (filters.company?.length > 0) count++;
  if (filters.job_title?.length > 0) count++;
  if (filters.skills?.length > 0) count++;
  if (filters.role?.length > 0) count++;
  if (filters.industry?.length > 0) count++;
  if (filters.school?.length > 0) count++;
  if (filters.seniority?.length > 0) count++;
  if (filters.years_of_experience_min !== null || filters.years_of_experience_max !== null) count++;
  if (filters.open_to_work) count++;
  if (filters.past_company?.length > 0) count++;
  if (filters.past_job_title?.length > 0) count++;
  return count;
}

function filtersSummary(filters: LinkedInFiltersState): string {
  const parts: string[] = [];
  if (filters.keywords) parts.push(`"${filters.keywords}"`);
  if (filters.role?.length > 0) parts.push(`Rôle: ${filters.role.map(r => r.keywords).join(', ')}`);
  if (filters.location?.length > 0) parts.push(`📍 ${filters.location.map(l => l.name).join(', ')}`);
  if (filters.company?.length > 0) parts.push(`🏢 ${filters.company.map(c => c.name).join(', ')}`);
  if (filters.seniority?.length > 0) parts.push(`Seniorité: ${filters.seniority.join(', ')}`);
  return parts.slice(0, 3).join(' · ') || 'Aucun filtre';
}

export const SearchHistory: React.FC<SearchHistoryProps> = ({
  history,
  isLoading,
  onApplyFilters,
  onDelete,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  if (history.length === 0 && !isLoading) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-[#1A1A1A]/10 bg-white hover:bg-gray-50 transition-colors text-sm">
          <div className="flex items-center gap-2 text-[#1A1A1A]/70">
            <History className="w-4 h-4" />
            <span className="font-medium">Historique</span>
            <Badge variant="secondary" className="text-[10px] h-5">
              {history.length}
            </Badge>
          </div>
          {isOpen ? <ChevronUp className="w-4 h-4 text-[#1A1A1A]/40" /> : <ChevronDown className="w-4 h-4 text-[#1A1A1A]/40" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ScrollArea className="max-h-[300px] mt-2">
          <div className="space-y-2">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="group bg-white border border-[#1A1A1A]/10 rounded-lg p-3 hover:border-[#0077B5]/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-xs text-[#1A1A1A]/50">
                    {format(new Date(entry.created_at), 'dd MMM yyyy · HH:mm', { locale: fr })}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-[#0077B5]"
                      onClick={() => onApplyFilters(entry.filters_snapshot)}
                      title="Réutiliser ces filtres"
                    >
                      <Play className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                      onClick={() => onDelete(entry.id)}
                      title="Supprimer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>

                <p className="text-xs text-[#1A1A1A]/70 truncate mb-2">
                  {filtersSummary(entry.filters_snapshot)}
                </p>

                <div className="flex items-center gap-3 text-[10px] text-[#1A1A1A]/50">
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {entry.results_count} résultats
                  </span>
                  {entry.messaged_count > 0 && (
                    <span className="flex items-center gap-1 text-blue-500">
                      <MessageSquare className="w-3 h-3" />
                      {entry.messaged_count}
                    </span>
                  )}
                  {entry.shortlisted_count > 0 && (
                    <span className="flex items-center gap-1 text-green-500">
                      <Star className="w-3 h-3" />
                      {entry.shortlisted_count}
                    </span>
                  )}
                  {entry.dismissed_count > 0 && (
                    <span className="flex items-center gap-1 text-orange-400">
                      <Archive className="w-3 h-3" />
                      {entry.dismissed_count}
                    </span>
                  )}
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                    {countFilters(entry.filters_snapshot)} filtres
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
};
