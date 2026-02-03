import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { LinkedInFiltersState, LinkedInProfile, INITIAL_FILTERS } from '@/components/outreach/types';
import { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import { Job } from '@/pages/JobSpace';

interface OutreachSearchState {
  // Filters
  filters: LinkedInFiltersState;
  setFilters: React.Dispatch<React.SetStateAction<LinkedInFiltersState>>;
  resetFilters: () => void;
  
  // Results
  results: LinkedInProfile[];
  setResults: React.Dispatch<React.SetStateAction<LinkedInProfile[]>>;
  hasSearched: boolean;
  setHasSearched: React.Dispatch<React.SetStateAction<boolean>>;
  total: number | null;
  setTotal: React.Dispatch<React.SetStateAction<number | null>>;
  cursor: string | null;
  setCursor: React.Dispatch<React.SetStateAction<string | null>>;
  hasMoreResults: boolean;
  setHasMoreResults: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Job & Scoring
  selectedJob: Job | null;
  setSelectedJob: React.Dispatch<React.SetStateAction<Job | null>>;
  jobScores: Record<string, JobMatchResult>;
  setJobScores: React.Dispatch<React.SetStateAction<Record<string, JobMatchResult>>>;
  sortByScore: boolean;
  setSortByScore: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Selections
  selectedProfiles: Set<string>;
  setSelectedProfiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  
  // View state
  statusFilter: 'all' | 'untreated' | 'messaged' | 'dismissed';
  setStatusFilter: React.Dispatch<React.SetStateAction<'all' | 'untreated' | 'messaged' | 'dismissed'>>;
  showDismissed: boolean;
  setShowDismissed: React.Dispatch<React.SetStateAction<boolean>>;
}

const OutreachSearchContext = createContext<OutreachSearchState | null>(null);

export const useOutreachSearch = () => {
  const context = useContext(OutreachSearchContext);
  if (!context) {
    throw new Error('useOutreachSearch must be used within OutreachSearchProvider');
  }
  return context;
};

export const OutreachSearchProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Filters
  const [filters, setFilters] = useState<LinkedInFiltersState>(INITIAL_FILTERS);
  const resetFilters = useCallback(() => setFilters(INITIAL_FILTERS), []);
  
  // Results
  const [results, setResults] = useState<LinkedInProfile[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMoreResults, setHasMoreResults] = useState(true);
  
  // Job & Scoring
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [jobScores, setJobScores] = useState<Record<string, JobMatchResult>>({});
  const [sortByScore, setSortByScore] = useState(false);
  
  // Selections
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set());
  
  // View state
  const [statusFilter, setStatusFilter] = useState<'all' | 'untreated' | 'messaged' | 'dismissed'>('all');
  const [showDismissed, setShowDismissed] = useState(false);
  
  const value: OutreachSearchState = {
    filters,
    setFilters,
    resetFilters,
    results,
    setResults,
    hasSearched,
    setHasSearched,
    total,
    setTotal,
    cursor,
    setCursor,
    hasMoreResults,
    setHasMoreResults,
    selectedJob,
    setSelectedJob,
    jobScores,
    setJobScores,
    sortByScore,
    setSortByScore,
    selectedProfiles,
    setSelectedProfiles,
    statusFilter,
    setStatusFilter,
    showDismissed,
    setShowDismissed,
  };
  
  return (
    <OutreachSearchContext.Provider value={value}>
      {children}
    </OutreachSearchContext.Provider>
  );
};
