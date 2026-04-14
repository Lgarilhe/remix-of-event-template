import React, { useMemo, useState, useCallback } from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import { JobDetails } from '@/types/jobDetails';
import { Checkbox } from '@/components/ui/checkbox';
import { CompanyLogo } from '@/components/candidates/CompanyLogo';
import { cn } from '@/lib/utils';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Check, X, HelpCircle, ArrowUpDown, MapPin, ExternalLink, Filter, ChevronDown, ChevronUp, Briefcase, Signal, Mail, Phone, Star } from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface SourcingListViewProps {
  profiles: LinkedInProfile[];
  jobScores: Record<string, JobMatchResult>;
  selectedProfiles: Set<string>;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (profile: LinkedInProfile) => void;
  jobDetails?: JobDetails | null;
}

type SortKey = 'name' | 'company' | 'score' | 'recommendation' | 'location' | 'experience' | 'headline';
type SortDir = 'asc' | 'desc';
type ExperienceMatchFilter = 'all' | 'compatible' | 'trop_junior' | 'trop_senior' | 'incertain';
type ScoreRangeFilter = 'all' | '75+' | '50-74' | '0-49';
type OpenToWorkFilter = 'all' | 'yes' | 'no';
type NetworkFilter = 'all' | '1st' | '2nd' | '3rd';
type HasEmailFilter = 'all' | 'yes' | 'no';

/** Get current (or most recent) work experience */
function getCurrentExperience(profile: LinkedInProfile) {
  const exps = profile.work_experience || [];
  const current = exps.find(e => e.current || e.status === 'current' || !e.end);
  return current || exps[0] || null;
}

/** Normalize recommendation to display */
function recLabel(rec?: string): { label: string; color: string } {
  switch (rec) {
    case 'go': return { label: 'Go', color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20' };
    case 'maybe': return { label: 'Maybe', color: 'text-amber-600 bg-amber-500/10 border-amber-500/20' };
    case 'skip': return { label: 'Skip', color: 'text-destructive bg-destructive/10 border-destructive/20' };
    default: return { label: '—', color: 'text-muted-foreground' };
  }
}

export const SourcingListView: React.FC<SourcingListViewProps> = ({
  profiles,
  jobScores,
  selectedProfiles,
  onToggleSelect,
  onOpenDetail,
  jobDetails,
}) => {
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [nameFilter, setNameFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [recFilter, setRecFilter] = useState<'all' | 'go' | 'maybe' | 'skip'>('all');
  const [locationFilter, setLocationFilter] = useState('');

  // Build criteria columns from brief
  const criteriaColumns = useMemo(() => {
    if (!jobDetails?.evaluation_criteria?.length) return [];
    return jobDetails.evaluation_criteria.map(c => ({
      id: c.id,
      label: c.label,
      shortLabel: c.label.length > 20 ? c.label.slice(0, 18) + '…' : c.label,
      category: c.category,
      weight: c.weight,
      dealBreaker: c.deal_breaker,
    }));
  }, [jobDetails]);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }, [sortKey]);

  const enriched = useMemo(() => profiles.map(p => {
    const exp = getCurrentExperience(p);
    const score = jobScores[p.id] || jobScores[p.public_identifier || ''] || jobScores[p.provider_id || ''];
    return { profile: p, exp, score };
  }), [profiles, jobScores]);

  const filtered = useMemo(() => {
    let list = enriched;
    if (nameFilter) {
      const q = nameFilter.toLowerCase();
      list = list.filter(({ profile: p }) =>
        (p.name || `${p.first_name || ''} ${p.last_name || ''}`).toLowerCase().includes(q)
      );
    }
    if (companyFilter) {
      const q = companyFilter.toLowerCase();
      list = list.filter(({ exp }) => exp?.company?.toLowerCase().includes(q));
    }
    if (locationFilter) {
      const q = locationFilter.toLowerCase();
      list = list.filter(({ profile: p }) => p.location?.toLowerCase().includes(q));
    }
    if (recFilter !== 'all') {
      list = list.filter(({ score }) => score?.recommendation === recFilter);
    }
    return list;
  }, [enriched, nameFilter, companyFilter, locationFilter, recFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av = '', bv = '';
      switch (sortKey) {
        case 'name':
          av = (a.profile.name || '').toLowerCase();
          bv = (b.profile.name || '').toLowerCase();
          break;
        case 'company':
          av = (a.exp?.company || 'zzz').toLowerCase();
          bv = (b.exp?.company || 'zzz').toLowerCase();
          break;
        case 'score':
          return sortDir === 'desc'
            ? (b.score?.match_score ?? -1) - (a.score?.match_score ?? -1)
            : (a.score?.match_score ?? -1) - (b.score?.match_score ?? -1);
        case 'recommendation': {
          const order = { go: 3, maybe: 2, skip: 1 };
          const as = order[a.score?.recommendation as keyof typeof order] ?? 0;
          const bs = order[b.score?.recommendation as keyof typeof order] ?? 0;
          return sortDir === 'desc' ? bs - as : as - bs;
        }
        case 'location':
          av = (a.profile.location || 'zzz').toLowerCase();
          bv = (b.profile.location || 'zzz').toLowerCase();
          break;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const SortableHead: React.FC<{ label: string; sortKeyVal: SortKey; className?: string }> = ({ label, sortKeyVal, className }) => (
    <TableHead className={cn("cursor-pointer select-none hover:bg-muted/50 transition-colors", className)} onClick={() => handleSort(sortKeyVal)}>
      <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider">
        {label}
        <ArrowUpDown className={cn("w-3 h-3", sortKey === sortKeyVal ? "text-foreground" : "text-muted-foreground/50")} />
      </span>
    </TableHead>
  );

  /** Get criteria verdict for a profile */
  const getCriteriaVerdict = (score: JobMatchResult | undefined, criteriaLabel: string) => {
    if (!score?.criteriaEvaluations) return null;
    return score.criteriaEvaluations.find(
      ce => ce.label.toLowerCase() === criteriaLabel.toLowerCase()
    );
  };

  if (profiles.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        Aucun profil à afficher en vue liste.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Notion-style filter bar */}
      <div className="flex items-center gap-2 px-2 flex-wrap">
        <Input
          placeholder="Filtrer par nom…"
          value={nameFilter}
          onChange={e => setNameFilter(e.target.value)}
          className="h-7 w-36 text-xs"
        />
        <Input
          placeholder="Société…"
          value={companyFilter}
          onChange={e => setCompanyFilter(e.target.value)}
          className="h-7 w-32 text-xs"
        />
        <Input
          placeholder="Localisation…"
          value={locationFilter}
          onChange={e => setLocationFilter(e.target.value)}
          className="h-7 w-32 text-xs"
        />
        <Select value={recFilter} onValueChange={v => setRecFilter(v as typeof recFilter)}>
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue placeholder="Reco" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Tous</SelectItem>
            <SelectItem value="go" className="text-xs">✅ Go</SelectItem>
            <SelectItem value="maybe" className="text-xs">🤔 Maybe</SelectItem>
            <SelectItem value="skip" className="text-xs">❌ Skip</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">
          {sorted.length} / {profiles.length} profils
        </span>
      </div>

      {/* Table */}
      <div className="border border-border bg-background overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="w-10 px-2">
                <Checkbox
                  checked={sorted.length > 0 && sorted.every(({ profile }) => selectedProfiles.has(profile.id))}
                  onCheckedChange={() => {
                    const allSelected = sorted.every(({ profile }) => selectedProfiles.has(profile.id));
                    sorted.forEach(({ profile }) => {
                      if (allSelected ? selectedProfiles.has(profile.id) : !selectedProfiles.has(profile.id)) {
                        onToggleSelect(profile.id);
                      }
                    });
                  }}
                  className="h-3.5 w-3.5"
                />
              </TableHead>
              <SortableHead label="Candidat" sortKeyVal="name" className="min-w-[200px]" />
              <SortableHead label="Société" sortKeyVal="company" className="min-w-[160px]" />
              <SortableHead label="Lieu" sortKeyVal="location" className="min-w-[120px]" />
              <SortableHead label="Score" sortKeyVal="score" className="w-16" />
              <SortableHead label="Reco" sortKeyVal="recommendation" className="w-20" />
              {criteriaColumns.map(c => (
                <TableHead key={c.id} className="w-12 px-1 text-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={cn(
                        "text-[10px] font-semibold uppercase tracking-wider cursor-help block truncate max-w-[60px]",
                        c.dealBreaker ? "text-destructive" : "text-muted-foreground"
                      )}>
                        {c.shortLabel}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px]">
                      <p className="font-semibold text-xs">{c.label}</p>
                      <p className="text-xs text-muted-foreground">{c.category} • Poids {c.weight}/3{c.dealBreaker ? ' • Deal breaker' : ''}</p>
                    </TooltipContent>
                  </Tooltip>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(({ profile, exp, score }) => {
              const rec = recLabel(score?.recommendation);
              const companyLogo = exp?.company_picture_url || exp?.logo;
              return (
                <TableRow
                  key={profile.id}
                  className="cursor-pointer hover:bg-accent/30 transition-colors"
                  onClick={() => onOpenDetail(profile)}
                >
                  {/* Checkbox */}
                  <TableCell className="px-2" onClick={e => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedProfiles.has(profile.id)}
                      onCheckedChange={() => onToggleSelect(profile.id)}
                      className="h-3.5 w-3.5"
                    />
                  </TableCell>

                  {/* Candidate */}
                  <TableCell className="py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {profile.profile_picture_url ? (
                        <img src={profile.profile_picture_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0 border border-border" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-muted border border-border flex items-center justify-center shrink-0 text-xs font-bold text-muted-foreground">
                          {(profile.first_name || profile.name || '?')[0]}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground truncate">
                            {profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`}
                          </span>
                          {(profile.profile_url || profile.public_profile_url) && (
                            <a
                              href={profile.public_profile_url || profile.profile_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="shrink-0"
                            >
                              <img src={linkedinLogo} alt="LinkedIn" className="w-3.5 h-3.5 opacity-50 hover:opacity-100 transition-opacity" />
                            </a>
                          )}
                        </div>
                        {(exp?.role || profile.headline) && (
                          <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                            {exp?.role || profile.headline}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  {/* Company */}
                  <TableCell className="py-2">
                    {exp?.company ? (
                      <div className="flex items-center gap-2 min-w-0">
                        {companyLogo ? (
                          <img src={companyLogo} alt="" className="w-5 h-5 rounded object-contain shrink-0 border border-border bg-white" />
                        ) : (
                          <CompanyLogo company={exp.company} size="sm" />
                        )}
                        <span className="text-sm text-foreground truncate">{exp.company}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* Location */}
                  <TableCell className="py-2">
                    {profile.location ? (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate max-w-[100px]">{profile.location}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* Score */}
                  <TableCell className="py-2 text-center">
                    {score ? (
                      <span className={cn(
                        "text-sm font-bold tabular-nums",
                        score.match_score >= 75 ? "text-emerald-600" :
                        score.match_score >= 50 ? "text-amber-600" : "text-destructive"
                      )}>
                        {score.match_score}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* Recommendation */}
                  <TableCell className="py-2">
                    {score?.recommendation ? (
                      <span className={cn("text-[11px] font-bold px-1.5 py-0.5 border", rec.color)}>
                        {rec.label}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* Criteria columns */}
                  {criteriaColumns.map(c => {
                    const verdict = getCriteriaVerdict(score, c.label);
                    return (
                      <TableCell key={c.id} className="py-2 text-center px-1">
                        {verdict ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center justify-center">
                                {verdict.verdict === 'pass' && <Check className="w-4 h-4 text-emerald-500" />}
                                {verdict.verdict === 'partial' && <HelpCircle className="w-3.5 h-3.5 text-amber-500" />}
                                {verdict.verdict === 'fail' && <X className="w-4 h-4 text-destructive" />}
                                {verdict.verdict === 'unknown' && <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50" />}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[280px]">
                              <p className="text-xs">{verdict.reason}</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground/30 text-xs">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
