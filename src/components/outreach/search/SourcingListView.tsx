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

/** Compute years of experience from work history */
function computeYearsExp(profile: LinkedInProfile): number | null {
  const exps = profile.work_experience || [];
  if (!exps.length) return null;
  let earliest = 9999;
  for (const exp of exps) {
    const start = exp.start;
    if (start) {
      let year: number;
      if (typeof start === 'object' && start?.year) year = start.year;
      else if (typeof start === 'string') year = parseInt(start.split('-')[0]);
      else year = 9999;
      if (year < earliest) earliest = year;
    }
  }
  return earliest < 9999 ? new Date().getFullYear() - earliest : null;
}

/** Get network distance as a number */
function getNetworkDist(profile: LinkedInProfile): number | null {
  const d = profile.network_distance;
  if (typeof d === 'number') return d;
  if (typeof d === 'string') {
    const n = parseInt(d);
    return isNaN(n) ? null : n;
  }
  return null;
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
  const [showFilters, setShowFilters] = useState(true);
  
  // Text filters
  const [nameFilter, setNameFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [headlineFilter, setHeadlineFilter] = useState('');
  const [skillFilter, setSkillFilter] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');
  
  // Select filters
  const [recFilter, setRecFilter] = useState<'all' | 'go' | 'maybe' | 'skip'>('all');
  const [expMatchFilter, setExpMatchFilter] = useState<ExperienceMatchFilter>('all');
  const [scoreRangeFilter, setScoreRangeFilter] = useState<ScoreRangeFilter>('all');
  const [openToWorkFilter, setOpenToWorkFilter] = useState<OpenToWorkFilter>('all');
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>('all');
  const [hasEmailFilter, setHasEmailFilter] = useState<HasEmailFilter>('all');

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (nameFilter) count++;
    if (companyFilter) count++;
    if (locationFilter) count++;
    if (headlineFilter) count++;
    if (skillFilter) count++;
    if (industryFilter) count++;
    if (recFilter !== 'all') count++;
    if (expMatchFilter !== 'all') count++;
    if (scoreRangeFilter !== 'all') count++;
    if (openToWorkFilter !== 'all') count++;
    if (networkFilter !== 'all') count++;
    if (hasEmailFilter !== 'all') count++;
    return count;
  }, [nameFilter, companyFilter, locationFilter, headlineFilter, skillFilter, industryFilter, recFilter, expMatchFilter, scoreRangeFilter, openToWorkFilter, networkFilter, hasEmailFilter]);

  const clearAllFilters = useCallback(() => {
    setNameFilter(''); setCompanyFilter(''); setLocationFilter('');
    setHeadlineFilter(''); setSkillFilter(''); setIndustryFilter('');
    setRecFilter('all'); setExpMatchFilter('all'); setScoreRangeFilter('all');
    setOpenToWorkFilter('all'); setNetworkFilter('all'); setHasEmailFilter('all');
  }, []);

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
    const yearsExp = computeYearsExp(p);
    return { profile: p, exp, score, yearsExp };
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
    if (headlineFilter) {
      const q = headlineFilter.toLowerCase();
      list = list.filter(({ profile: p }) => p.headline?.toLowerCase().includes(q));
    }
    if (skillFilter) {
      const q = skillFilter.toLowerCase();
      list = list.filter(({ profile: p, score }) => {
        const profileSkills = p.skills?.some(s => s.name.toLowerCase().includes(q));
        const matchingSkills = score?.matching_skills?.some(s => s.toLowerCase().includes(q));
        return profileSkills || matchingSkills;
      });
    }
    if (industryFilter) {
      const q = industryFilter.toLowerCase();
      list = list.filter(({ profile: p, exp }) => {
        const pIndustry = p.industry?.toLowerCase().includes(q);
        const expIndustry = Array.isArray(exp?.industry)
          ? exp.industry.some((i: string) => i.toLowerCase().includes(q))
          : (typeof exp?.industry === 'string' && exp.industry.toLowerCase().includes(q));
        return pIndustry || expIndustry;
      });
    }
    if (recFilter !== 'all') {
      list = list.filter(({ score }) => score?.recommendation === recFilter);
    }
    if (expMatchFilter !== 'all') {
      list = list.filter(({ score }) => score?.experience_match === expMatchFilter);
    }
    if (scoreRangeFilter !== 'all') {
      list = list.filter(({ score }) => {
        if (!score) return false;
        const s = score.match_score;
        if (scoreRangeFilter === '75+') return s >= 75;
        if (scoreRangeFilter === '50-74') return s >= 50 && s < 75;
        if (scoreRangeFilter === '0-49') return s < 50;
        return true;
      });
    }
    if (openToWorkFilter !== 'all') {
      list = list.filter(({ profile: p }) => {
        const otw = p.open_to_work || p.is_open_to_work;
        return openToWorkFilter === 'yes' ? !!otw : !otw;
      });
    }
    if (networkFilter !== 'all') {
      list = list.filter(({ profile: p }) => {
        const dist = getNetworkDist(p);
        if (networkFilter === '1st') return dist === 1;
        if (networkFilter === '2nd') return dist === 2;
        if (networkFilter === '3rd') return dist === 3;
        return true;
      });
    }
    if (hasEmailFilter !== 'all') {
      list = list.filter(({ profile: p }) => {
        const hasEmail = !!(p.contact_info?.emails?.length);
        return hasEmailFilter === 'yes' ? hasEmail : !hasEmail;
      });
    }
    return list;
  }, [enriched, nameFilter, companyFilter, locationFilter, headlineFilter, skillFilter, industryFilter, recFilter, expMatchFilter, scoreRangeFilter, openToWorkFilter, networkFilter, hasEmailFilter]);

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
        case 'experience':
          return sortDir === 'desc'
            ? (b.yearsExp ?? -1) - (a.yearsExp ?? -1)
            : (a.yearsExp ?? -1) - (b.yearsExp ?? -1);
        case 'headline':
          av = (a.profile.headline || 'zzz').toLowerCase();
          bv = (b.profile.headline || 'zzz').toLowerCase();
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
      {/* Filter header */}
      <div className="flex items-center gap-2 px-2">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          <Filter className="w-3.5 h-3.5" />
          Filtres
          {activeFilterCount > 0 && (
            <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 font-bold">{activeFilterCount}</span>
          )}
          {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {activeFilterCount > 0 && (
          <button onClick={clearAllFilters} className="text-[10px] text-muted-foreground hover:text-foreground underline">
            Tout effacer
          </button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {sorted.length} / {profiles.length} profils
        </span>
      </div>

      {/* Notion-style filter bar */}
      {showFilters && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5 px-2">
          <Input
            placeholder="Nom…"
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
            className="h-7 text-xs"
          />
          <Input
            placeholder="Société…"
            value={companyFilter}
            onChange={e => setCompanyFilter(e.target.value)}
            className="h-7 text-xs"
          />
          <Input
            placeholder="Lieu…"
            value={locationFilter}
            onChange={e => setLocationFilter(e.target.value)}
            className="h-7 text-xs"
          />
          <Input
            placeholder="Titre…"
            value={headlineFilter}
            onChange={e => setHeadlineFilter(e.target.value)}
            className="h-7 text-xs"
          />
          <Input
            placeholder="Compétence…"
            value={skillFilter}
            onChange={e => setSkillFilter(e.target.value)}
            className="h-7 text-xs"
          />
          <Input
            placeholder="Industrie…"
            value={industryFilter}
            onChange={e => setIndustryFilter(e.target.value)}
            className="h-7 text-xs"
          />
          <Select value={recFilter} onValueChange={v => setRecFilter(v as typeof recFilter)}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Reco" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Reco : Tous</SelectItem>
              <SelectItem value="go" className="text-xs">Go</SelectItem>
              <SelectItem value="maybe" className="text-xs">Maybe</SelectItem>
              <SelectItem value="skip" className="text-xs">Skip</SelectItem>
            </SelectContent>
          </Select>
          <Select value={scoreRangeFilter} onValueChange={v => setScoreRangeFilter(v as ScoreRangeFilter)}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Score" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Score : Tous</SelectItem>
              <SelectItem value="75+" className="text-xs">75+</SelectItem>
              <SelectItem value="50-74" className="text-xs">50–74</SelectItem>
              <SelectItem value="0-49" className="text-xs">0–49</SelectItem>
            </SelectContent>
          </Select>
          <Select value={expMatchFilter} onValueChange={v => setExpMatchFilter(v as ExperienceMatchFilter)}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Exp. match" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Exp : Tous</SelectItem>
              <SelectItem value="compatible" className="text-xs">Compatible</SelectItem>
              <SelectItem value="trop_junior" className="text-xs">Trop junior</SelectItem>
              <SelectItem value="trop_senior" className="text-xs">Trop senior</SelectItem>
              <SelectItem value="incertain" className="text-xs">Incertain</SelectItem>
            </SelectContent>
          </Select>
          <Select value={openToWorkFilter} onValueChange={v => setOpenToWorkFilter(v as OpenToWorkFilter)}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Open to work" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">OTW : Tous</SelectItem>
              <SelectItem value="yes" className="text-xs">Open to work</SelectItem>
              <SelectItem value="no" className="text-xs">Non OTW</SelectItem>
            </SelectContent>
          </Select>
          <Select value={networkFilter} onValueChange={v => setNetworkFilter(v as NetworkFilter)}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Réseau" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Réseau : Tous</SelectItem>
              <SelectItem value="1st" className="text-xs">1er degré</SelectItem>
              <SelectItem value="2nd" className="text-xs">2e degré</SelectItem>
              <SelectItem value="3rd" className="text-xs">3e degré</SelectItem>
            </SelectContent>
          </Select>
          <Select value={hasEmailFilter} onValueChange={v => setHasEmailFilter(v as HasEmailFilter)}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Email" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Email : Tous</SelectItem>
              <SelectItem value="yes" className="text-xs">Avec email</SelectItem>
              <SelectItem value="no" className="text-xs">Sans email</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

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
              <SortableHead label="Exp." sortKeyVal="experience" className="w-14" />
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
            {sorted.map(({ profile, exp, score, yearsExp }) => {
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

                  {/* Experience */}
                  <TableCell className="py-2 text-center">
                    {yearsExp != null ? (
                      <span className="text-xs font-medium text-muted-foreground">{yearsExp} ans</span>
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
