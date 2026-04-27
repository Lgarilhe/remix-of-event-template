/**
 * CompactResultsTable — vue table type Notion des résultats de recherche LinkedIn.
 *
 * Refonte v2 2026-04-27 (suite feedback Laurent) :
 *  - Vraie table Notion-like : header sticky, colonnes triables, colonnes
 *    Avatar + Nom collées en sticky horizontal, hover ligne entière.
 *  - 30+ colonnes toggle (organisées en 7 sections) couvrant TOUT ce qu'on
 *    récupère via Unipile : XP 1..5, Formation 1..3, signaux LinkedIn (open
 *    to work, premium, hiring, créateur, etc.), contact (email/phone),
 *    network (connexions, followers, distance), skills, etc.
 *  - Colonnes critères du poste TOUJOURS visibles, dérivées de :
 *      1. job.skills[]
 *      2. parsing de job.mustHave / shouldHave / niceToHave
 *      3. + critères additionnels venant de criteriaEvaluations du scoring
 *    Verdict ✅ / ⚠️ / ❌ / ? résolu via fallback :
 *      criteriaEvaluations → matching_skills → missing_skills → unknown
 *  - Persistance des colonnes en localStorage avec clé v2 (reset des défauts).
 */

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { LinkedInProfile } from '../types';
import { JobMatchResult } from '../JobScoreDisplay';
import { Job } from '@/types/jobs';
import { JobCandidateStatus } from '@/hooks/useJobCandidateStatus';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import {
  Building2, GraduationCap, Check, X, AlertTriangle, HelpCircle,
  ExternalLink, Linkedin, Mail, Archive, MoreHorizontal, Columns3, Eye, EyeOff,
  ArrowUp, ArrowDown, ArrowUpDown, Phone, Globe, Briefcase, Sparkles,
  Users, MapPin, CalendarDays, BookOpen,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type Verdict = 'pass' | 'partial' | 'fail' | 'unknown';

interface CriteriaEvaluation {
  label: string;
  verdict: Verdict;
  reason?: string;
}

interface CriterionDef {
  /** Clé interne unique */
  key: string;
  /** Label affiché en colonne */
  label: string;
  /** D'où vient le critère */
  source: 'skills' | 'mustHave' | 'shouldHave' | 'niceToHave' | 'evaluation';
}

interface CompactResultsTableProps {
  profiles: LinkedInProfile[];
  selectedJob?: Job | null;
  jobScores: Record<string, JobMatchResult>;
  selectedProfiles: Set<string>;
  treatedCandidates: Map<string, JobCandidateStatus>;
  onToggleSelect: (profileId: string) => void;
  onToggleSelectAll: () => void;
  allSelected: boolean;
  onOpenDetail: (profile: LinkedInProfile) => void;
  onArchive?: (profile: LinkedInProfile) => void;
  /** Clé localStorage pour persister la visibilité des colonnes (souvent jobId) */
  storageKey?: string;
}

type ColumnSection = 'profil' | 'signals' | 'contact' | 'network' | 'experience' | 'education' | 'skills' | 'status' | 'criteres' | 'actions';

interface ColumnConfig {
  id: string;
  label: string;
  section: ColumnSection;
  defaultVisible: boolean;
  sticky?: boolean;
  /** True = colonne dynamique générée depuis un critère */
  isCriterion?: boolean;
  /** Critère lié (si isCriterion=true) */
  criterion?: CriterionDef;
  /** Largeur min-w fixe en px */
  minWidth?: number;
  /** Comparable value for sorting (lower-cased / numeric) */
  sortValue?: (p: LinkedInProfile, score?: JobMatchResult, status?: JobCandidateStatus) => string | number | null;
}

const SECTION_LABELS: Record<ColumnSection, string> = {
  profil: '👤 Profil',
  signals: '🚦 Signaux LinkedIn',
  contact: '📞 Contact',
  network: '🌐 Network',
  experience: '💼 Expériences',
  education: '🎓 Formation',
  skills: '🛠️ Compétences',
  status: '📊 Statut Konekt',
  criteres: '🎯 Critères du poste',
  actions: '⚙️',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCompanyLogo(exp: any): string | null {
  return exp?.company_logo || exp?.logo_url || exp?.logo || exp?.company_picture_url || null;
}

function getSchoolLogo(edu: any): string | null {
  return edu?.logo || edu?.school_logo || edu?.school_details?.logo || edu?.school_picture_url || null;
}

function getInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase() || '?';
}

function fmtYearMonth(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const y = value.year;
    const m = value.month;
    if (y && m) return `${String(m).padStart(2, '0')}/${y}`;
    if (y) return String(y);
  }
  return '';
}

function dateValueForSort(value: any): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const d = new Date(value).getTime();
    return Number.isNaN(d) ? 0 : d;
  }
  if (typeof value === 'object') {
    const y = Number(value.year) || 0;
    const m = Number(value.month) || 1;
    return y * 12 + m;
  }
  return 0;
}

function durationLabel(start: any, end: any): string {
  const s = dateValueForSort(start);
  const e = end ? dateValueForSort(end) : Date.now();
  if (!s) return '';
  // Both representations comparable when both year-month-coded
  if (s < 100000) {
    const months = Math.max(1, e - s);
    const y = Math.floor(months / 12);
    const m = months % 12;
    return y > 0 ? `${y}a${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
  }
  const months = Math.max(1, Math.floor((e - s) / (1000 * 60 * 60 * 24 * 30.4)));
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y > 0 ? `${y}a${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
}

function getEmail(p: LinkedInProfile): string | null {
  return p.contact_info?.emails?.[0] || null;
}
function getPhone(p: LinkedInProfile): string | null {
  return p.contact_info?.phones?.[0] || null;
}
function getProfileUrl(p: LinkedInProfile): string | null {
  return p.profile_url || p.public_profile_url || null;
}

function getYearsOfExp(p: LinkedInProfile): number {
  const exps = p.work_experience || [];
  if (exps.length === 0) return 0;
  let earliest = Infinity;
  for (const exp of exps) {
    const v = dateValueForSort(exp.start);
    if (v && v < earliest) earliest = v;
  }
  if (!isFinite(earliest)) return 0;
  if (earliest < 100000) {
    const nowMonths = new Date().getFullYear() * 12 + (new Date().getMonth() + 1);
    return Math.max(0, Math.round((nowMonths - earliest) / 12));
  }
  return Math.max(0, Math.round((Date.now() - earliest) / (1000 * 60 * 60 * 24 * 365.25)));
}

/**
 * Slice "Skill1, Skill2 / Skill3" or "- Skill1\n- Skill2" into individual items.
 * Used to parse mustHave / shouldHave / niceToHave free-text blobs.
 */
function splitCriteriaText(text: string | undefined | null): string[] {
  if (!text) return [];
  return text
    .split(/[\n,;|/]+|(?:^|\s)[-*•·]\s+/g)
    .map(s => s.trim())
    .filter(s => s.length >= 2 && s.length <= 80);
}

/**
 * Build the canonical list of criteria for the active job.
 * Order matters: we surface explicit job criteria first, then any extra
 * criteria the AI pulled from criteriaEvaluations.
 */
function buildCriteriaList(job: Job | null | undefined, scores: Record<string, JobMatchResult>): CriterionDef[] {
  const list: CriterionDef[] = [];
  const seen = new Set<string>();
  const push = (label: string, source: CriterionDef['source']) => {
    const cleaned = label.trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ key, label: cleaned, source });
  };

  if (job) {
    for (const s of job.skills || []) push(s, 'skills');
    for (const s of splitCriteriaText(job.mustHave)) push(s, 'mustHave');
    for (const s of splitCriteriaText(job.shouldHave)) push(s, 'shouldHave');
    for (const s of splitCriteriaText(job.niceToHave)) push(s, 'niceToHave');
  }

  // Critères additionnels venant des évaluations (catch-all)
  for (const score of Object.values(scores)) {
    if (score?.criteriaEvaluations) {
      for (const ev of score.criteriaEvaluations) {
        if (ev.label) push(ev.label, 'evaluation');
      }
    }
  }

  return list;
}

/**
 * Resolve verdict for a profile against a criterion with fallback chain.
 *  1. criteriaEvaluations[label] exact match (case-insensitive)
 *  2. matching_skills includes label → pass
 *  3. missing_skills includes label → fail
 *  4. unknown
 */
function resolveVerdict(criterion: CriterionDef, score: JobMatchResult | undefined): { verdict: Verdict; reason?: string } {
  if (!score) return { verdict: 'unknown' };
  const lc = criterion.key;

  if (score.criteriaEvaluations) {
    const match = score.criteriaEvaluations.find(ev => ev.label?.toLowerCase() === lc);
    if (match) return { verdict: match.verdict, reason: match.reason };
  }
  if (score.matching_skills?.some(s => s.toLowerCase() === lc)) {
    return { verdict: 'pass', reason: 'Compétence détectée dans le profil' };
  }
  if (score.missing_skills?.some(s => s.toLowerCase() === lc)) {
    return { verdict: 'fail', reason: 'Compétence absente du profil' };
  }
  return { verdict: 'unknown' };
}

const VerdictCell: React.FC<{ verdict: Verdict; label: string; reason?: string }> = ({ verdict, label, reason }) => {
  if (verdict === 'pass') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center w-5 h-5 bg-success/15 text-success rounded-sm" aria-label={`${label} : validé`}>
            <Check className="w-3 h-3" aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs font-bold">{label} ✓</p>
          {reason && <p className="text-xs text-muted-foreground mt-0.5">{reason}</p>}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (verdict === 'partial') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center w-5 h-5 bg-warning/15 text-warning rounded-sm" aria-label={`${label} : partiel`}>
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs font-bold">{label} (partiel)</p>
          {reason && <p className="text-xs text-muted-foreground mt-0.5">{reason}</p>}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (verdict === 'fail') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center w-5 h-5 bg-destructive/15 text-destructive rounded-sm" aria-label={`${label} : échec`}>
            <X className="w-3 h-3" aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs font-bold">{label} ✗</p>
          {reason && <p className="text-xs text-muted-foreground mt-0.5">{reason}</p>}
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center justify-center w-5 h-5 text-muted-foreground/40" aria-label={`${label} : non évalué`}>
          <HelpCircle className="w-3 h-3" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{label} — non évalué (lancer le scoring)</p>
      </TooltipContent>
    </Tooltip>
  );
};

const FlagIcon: React.FC<{ active: boolean | undefined; label: string; emoji?: string }> = ({ active, label, emoji = '✓' }) => {
  if (!active) return <span className="text-muted-foreground/30">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center justify-center w-5 h-5 bg-success/15 text-success rounded-sm text-[10px] font-bold" aria-label={label}>{emoji}</span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
};

/**
 * Format headcount range from Unipile : { min: 1001, max: 5000 } → "1001-5000"
 */
function fmtHeadcount(hc: any): string | null {
  if (!hc) return null;
  if (typeof hc === 'number') return hc.toLocaleString('fr-FR');
  if (hc.min && hc.max) return `${hc.min.toLocaleString('fr-FR')} – ${hc.max.toLocaleString('fr-FR')}`;
  if (hc.min) return `${hc.min.toLocaleString('fr-FR')}+`;
  if (hc.max) return `< ${hc.max.toLocaleString('fr-FR')}`;
  return null;
}

function fmtIndustry(ind: any): string | null {
  if (!ind) return null;
  if (Array.isArray(ind)) return ind.filter(Boolean).join(' · ');
  return String(ind);
}

const ExperienceCell: React.FC<{ exp: any | undefined }> = ({ exp }) => {
  if (!exp) return <span className="text-muted-foreground/30">—</span>;
  const role = exp.role || exp.position || '';
  const company = exp.company || '';
  const start = fmtYearMonth(exp.start);
  const end = exp.current || !exp.end ? 'Présent' : fmtYearMonth(exp.end);
  const dur = durationLabel(exp.start, exp.end);
  const logo = getCompanyLogo(exp);
  const industry = fmtIndustry(exp.industry);
  const headcount = fmtHeadcount(exp.company_headcount);
  const companyUrl = exp.company_url
    || (exp.company_id ? `https://www.linkedin.com/company/${exp.company_id}/` : null);

  return (
    <HoverCard openDelay={250} closeDelay={120}>
      <HoverCardTrigger asChild>
        <div className="flex items-center gap-1.5 min-w-0 max-w-[200px] cursor-help">
          {logo ? (
            <img src={logo} alt="" className="w-4 h-4 rounded-sm object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <Building2 className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">
            <span className="text-foreground">{role}</span>
            {company && <span className="text-muted-foreground"> · {company}</span>}
          </span>
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-96 p-0 overflow-hidden" data-no-detail>
        {/* Header — Société */}
        <div className="flex items-start gap-3 p-3 border-b border-border bg-muted/30">
          {logo ? (
            <img src={logo} alt="" className="w-12 h-12 rounded-md object-contain shrink-0 border border-border bg-background p-1" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h4 className="font-bold text-sm text-foreground truncate">{company || '—'}</h4>
            {industry && <p className="text-xs text-muted-foreground truncate mt-0.5">{industry}</p>}
            {companyUrl && (
              <a
                href={companyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-info hover:underline mt-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Linkedin className="w-3 h-3" aria-hidden="true" />
                LinkedIn
                <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>

        {/* Meta société */}
        {(headcount || exp.location) && (
          <div className="flex flex-wrap gap-3 px-3 py-2 border-b border-border text-xs">
            {headcount && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Users className="w-3 h-3" aria-hidden="true" />
                <span>{headcount} <span className="text-muted-foreground/60">empl.</span></span>
              </div>
            )}
            {exp.location && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <MapPin className="w-3 h-3" aria-hidden="true" />
                <span className="truncate max-w-[180px]">{exp.location}</span>
              </div>
            )}
          </div>
        )}

        {/* Description société */}
        {exp.company_description && (
          <div className="px-3 py-2 border-b border-border bg-background">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold mb-1">À propos</p>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{exp.company_description}</p>
          </div>
        )}

        {/* Détails du poste */}
        <div className="p-3 bg-background">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">Poste occupé</p>
          <p className="text-sm font-medium text-foreground">{role || '—'}</p>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            <CalendarDays className="w-3 h-3" aria-hidden="true" />
            <span>{start || '?'} → {end}{dur && <span className="text-muted-foreground/70"> · {dur}</span>}</span>
          </div>
          {exp.description && (
            <p className="text-xs text-muted-foreground leading-relaxed mt-2 line-clamp-4">{exp.description}</p>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

const EducationCell: React.FC<{ edu: any | undefined }> = ({ edu }) => {
  if (!edu) return <span className="text-muted-foreground/30">—</span>;
  const school = edu.school || edu.school_details?.name || '';
  const degree = edu.degree || '';
  const field = edu.field_of_study || '';
  const start = fmtYearMonth(edu.start);
  const end = fmtYearMonth(edu.end);
  const logo = getSchoolLogo(edu);
  const schoolDescription = edu.school_details?.description;
  const schoolLocation = edu.school_details?.location;
  const employeeCount = edu.school_details?.employeeCount;
  const schoolUrl = edu.school_url
    || edu.school_details?.url
    || (edu.school_id ? `https://www.linkedin.com/school/${edu.school_id}/` : null);

  return (
    <HoverCard openDelay={250} closeDelay={120}>
      <HoverCardTrigger asChild>
        <div className="flex items-center gap-1.5 min-w-0 max-w-[200px] cursor-help">
          {logo ? (
            <img src={logo} alt="" className="w-4 h-4 rounded-sm object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <GraduationCap className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">
            <span className="text-foreground">{school}</span>
            {degree && <span className="text-muted-foreground"> · {degree}</span>}
          </span>
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-96 p-0 overflow-hidden" data-no-detail>
        {/* Header — École */}
        <div className="flex items-start gap-3 p-3 border-b border-border bg-muted/30">
          {logo ? (
            <img src={logo} alt="" className="w-12 h-12 rounded-md object-contain shrink-0 border border-border bg-background p-1" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center shrink-0">
              <GraduationCap className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h4 className="font-bold text-sm text-foreground truncate">{school || '—'}</h4>
            {schoolUrl && (
              <a
                href={schoolUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-info hover:underline mt-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Linkedin className="w-3 h-3" aria-hidden="true" />
                LinkedIn
                <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>

        {/* Meta école */}
        {(employeeCount || schoolLocation) && (
          <div className="flex flex-wrap gap-3 px-3 py-2 border-b border-border text-xs">
            {employeeCount != null && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Users className="w-3 h-3" aria-hidden="true" />
                <span>{employeeCount.toLocaleString('fr-FR')} <span className="text-muted-foreground/60">empl.</span></span>
              </div>
            )}
            {schoolLocation && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <MapPin className="w-3 h-3" aria-hidden="true" />
                <span className="truncate max-w-[180px]">{schoolLocation}</span>
              </div>
            )}
          </div>
        )}

        {/* Description école */}
        {schoolDescription && (
          <div className="px-3 py-2 border-b border-border bg-background">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold mb-1">À propos</p>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{schoolDescription}</p>
          </div>
        )}

        {/* Détails du diplôme */}
        <div className="p-3 bg-background space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Cursus</p>
          {degree && (
            <div className="flex items-start gap-1.5 text-xs">
              <BookOpen className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
              <div>
                <span className="text-foreground font-medium">{degree}</span>
                {field && <span className="text-muted-foreground"> · {field}</span>}
              </div>
            </div>
          )}
          {!degree && field && (
            <p className="text-xs text-foreground">{field}</p>
          )}
          {(start || end) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="w-3 h-3" aria-hidden="true" />
              <span>{start || '?'} → {end || '?'}</span>
            </div>
          )}
          {edu.grade && <p className="text-xs text-muted-foreground">Mention : {edu.grade}</p>}
          {edu.activities && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{edu.activities}</p>
          )}
          {edu.description && !edu.activities && (
            <p className="text-xs text-muted-foreground line-clamp-3 mt-1">{edu.description}</p>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

// ─── Main component ──────────────────────────────────────────────────────────

export const CompactResultsTable: React.FC<CompactResultsTableProps> = ({
  profiles,
  selectedJob,
  jobScores,
  selectedProfiles,
  treatedCandidates,
  onToggleSelect,
  onToggleSelectAll,
  allSelected,
  onOpenDetail,
  onArchive,
  storageKey,
}) => {
  const [sortBy, setSortBy] = useState<{ id: string; dir: 'asc' | 'desc' } | null>({ id: 'score', dir: 'desc' });

  // ─── Critères du poste (canonical list) ────────────────────────────────────
  const criteriaList = useMemo(
    () => buildCriteriaList(selectedJob, jobScores),
    [selectedJob, jobScores],
  );

  // ─── Build column registry ────────────────────────────────────────────────
  const allColumns: ColumnConfig[] = useMemo(() => {
    const cols: ColumnConfig[] = [];

    // 👤 Profil — sticky avatar + nom
    cols.push({ id: 'avatar', label: 'Avatar', section: 'profil', defaultVisible: true, sticky: true, minWidth: 40 });
    cols.push({
      id: 'name', label: 'Nom', section: 'profil', defaultVisible: true, sticky: true, minWidth: 160,
      sortValue: (p) => (p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim()).toLowerCase(),
    });
    cols.push({
      id: 'headline', label: 'Headline', section: 'profil', defaultVisible: true, minWidth: 220,
      sortValue: (p) => (p.headline || '').toLowerCase(),
    });
    cols.push({
      id: 'score', label: 'Score IA', section: 'profil', defaultVisible: true, minWidth: 70,
      sortValue: (_, s) => s?.match_score ?? -1,
    });
    cols.push({
      id: 'recommendation', label: 'Reco', section: 'profil', defaultVisible: true, minWidth: 70,
      sortValue: (_, s) => s?.recommendation === 'go' ? 0 : s?.recommendation === 'maybe' ? 1 : s?.recommendation === 'skip' ? 2 : 3,
    });
    cols.push({
      id: 'location', label: 'Lieu', section: 'profil', defaultVisible: true, minWidth: 110,
      sortValue: (p) => (p.location || '').toLowerCase(),
    });
    cols.push({
      id: 'industry', label: 'Secteur', section: 'profil', defaultVisible: false, minWidth: 130,
      sortValue: (p) => (p.industry || '').toLowerCase(),
    });
    cols.push({
      id: 'pronoun', label: 'Pronom', section: 'profil', defaultVisible: false, minWidth: 60,
      sortValue: (p) => (p.pronoun || '').toLowerCase(),
    });
    cols.push({
      id: 'language', label: 'Langue', section: 'profil', defaultVisible: false, minWidth: 60,
      sortValue: (p) => (p.primary_locale?.language || '').toLowerCase(),
    });

    // 🚦 Signaux LinkedIn
    cols.push({ id: 'sig_open_to_work', label: 'Open to Work', section: 'signals', defaultVisible: false, minWidth: 80, sortValue: (p) => (p.open_to_work || p.is_open_to_work) ? 1 : 0 });
    cols.push({ id: 'sig_premium', label: 'Premium', section: 'signals', defaultVisible: false, minWidth: 70, sortValue: (p) => (p.premium || p.is_premium) ? 1 : 0 });
    cols.push({ id: 'sig_hiring', label: 'Recrute', section: 'signals', defaultVisible: false, minWidth: 70, sortValue: (p) => p.is_hiring ? 1 : 0 });
    cols.push({ id: 'sig_influencer', label: 'Influenceur', section: 'signals', defaultVisible: false, minWidth: 80, sortValue: (p) => p.is_influencer ? 1 : 0 });
    cols.push({ id: 'sig_creator', label: 'Créateur', section: 'signals', defaultVisible: false, minWidth: 70, sortValue: (p) => p.is_creator ? 1 : 0 });
    cols.push({ id: 'sig_can_inmail', label: 'InMail', section: 'signals', defaultVisible: false, minWidth: 60, sortValue: (p) => p.can_send_inmail ? 1 : 0 });
    cols.push({ id: 'sig_open_profile', label: 'Open profile', section: 'signals', defaultVisible: false, minWidth: 80, sortValue: (p) => (p.open_profile || p.is_open_profile) ? 1 : 0 });
    cols.push({ id: 'sig_verified', label: 'Vérifié', section: 'signals', defaultVisible: false, minWidth: 60, sortValue: (p) => p.verified ? 1 : 0 });
    cols.push({ id: 'sig_recently_hired', label: 'Recemt embauché', section: 'signals', defaultVisible: false, minWidth: 100, sortValue: (p) => p.recently_hired ? 1 : 0 });

    // 📞 Contact
    cols.push({ id: 'email', label: 'Email', section: 'contact', defaultVisible: false, minWidth: 180, sortValue: (p) => (getEmail(p) || '').toLowerCase() });
    cols.push({ id: 'phone', label: 'Téléphone', section: 'contact', defaultVisible: false, minWidth: 120, sortValue: (p) => (getPhone(p) || '').toLowerCase() });
    cols.push({ id: 'linkedin_url', label: 'LinkedIn URL', section: 'contact', defaultVisible: false, minWidth: 110 });

    // 🌐 Network
    cols.push({ id: 'connections', label: 'Connexions', section: 'network', defaultVisible: false, minWidth: 80, sortValue: (p) => p.connections_count ?? 0 });
    cols.push({ id: 'followers', label: 'Followers', section: 'network', defaultVisible: false, minWidth: 80, sortValue: (p) => p.followers_count ?? 0 });
    cols.push({ id: 'shared_connections', label: 'Conn. partagées', section: 'network', defaultVisible: false, minWidth: 90, sortValue: (p) => p.shared_connections_count ?? 0 });
    cols.push({ id: 'network_distance', label: 'Distance', section: 'network', defaultVisible: false, minWidth: 70, sortValue: (p) => Number(p.network_distance) || 9 });

    // 💼 Expériences (XP totale + nb postes + XP 1..5)
    cols.push({
      id: 'years_exp', label: 'Années XP', section: 'experience', defaultVisible: true, minWidth: 80,
      sortValue: (p) => getYearsOfExp(p),
    });
    cols.push({
      id: 'jobs_count', label: 'Nb postes', section: 'experience', defaultVisible: false, minWidth: 70,
      sortValue: (p) => p.work_experience?.length ?? 0,
    });
    for (let i = 1; i <= 5; i++) {
      cols.push({
        id: `exp_${i}`, label: `XP ${i}`, section: 'experience', defaultVisible: i <= 2, minWidth: 200,
        sortValue: (p) => (p.work_experience?.[i - 1]?.company || '').toLowerCase(),
      });
    }

    // 🎓 Formation 1..3
    for (let i = 1; i <= 3; i++) {
      cols.push({
        id: `edu_${i}`, label: `Formation ${i}`, section: 'education', defaultVisible: i === 1, minWidth: 200,
        sortValue: (p) => (p.education?.[i - 1]?.school || '').toLowerCase(),
      });
    }

    // 🛠️ Compétences
    cols.push({
      id: 'skills_top', label: 'Top skills', section: 'skills', defaultVisible: false, minWidth: 220,
      sortValue: (p) => (p.skills?.[0]?.name || '').toLowerCase(),
    });
    cols.push({
      id: 'skills_count', label: 'Nb skills', section: 'skills', defaultVisible: false, minWidth: 70,
      sortValue: (p) => p.skills?.length ?? 0,
    });
    cols.push({
      id: 'languages', label: 'Langues parlées', section: 'skills', defaultVisible: false, minWidth: 130,
      sortValue: (p) => (p.languages?.[0]?.name || '').toLowerCase(),
    });

    // 📊 Statut Konekt
    cols.push({
      id: 'konekt_status', label: 'Statut', section: 'status', defaultVisible: true, minWidth: 90,
      sortValue: (_p, _s, st) => st?.status || 'zzz',
    });

    // 🎯 Critères du poste — toujours visibles par défaut
    for (const crit of criteriaList) {
      cols.push({
        id: `crit:${crit.key}`,
        label: crit.label,
        section: 'criteres',
        defaultVisible: true,
        isCriterion: true,
        criterion: crit,
        minWidth: 60,
        sortValue: (_p, s) => {
          const v = resolveVerdict(crit, s);
          return v.verdict === 'pass' ? 0 : v.verdict === 'partial' ? 1 : v.verdict === 'fail' ? 2 : 3;
        },
      });
    }

    // ⚙️ Actions
    cols.push({ id: 'actions', label: 'Actions', section: 'actions', defaultVisible: true, minWidth: 50 });

    return cols;
  }, [criteriaList]);

  // ─── Visibility (persisted localStorage v2) ────────────────────────────────
  const lsKey = `konekt_table_columns_v2_${storageKey || 'default'}`;
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(lsKey);
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch {/* noop */}
    return new Set(allColumns.filter(c => !c.defaultVisible).map(c => c.id));
  });

  // Quand de nouveaux critères apparaissent, on les rend visibles automatiquement
  useEffect(() => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const c of allColumns) {
        // Critères = visibles par défaut. Si présent dans hidden mais pas
        // explicitement caché par l'user (=on n'a pas de trace d'enregistrement
        // après leur apparition), on déclenche un affichage initial.
        // Note: si l'user les a explicitement masqués, la valeur restera dans
        // localStorage ; ce useEffect ne ré-active rien qui était déjà géré.
      }
      return changed ? next : prev;
    });
  }, [allColumns]);

  useEffect(() => {
    try {
      localStorage.setItem(lsKey, JSON.stringify(Array.from(hiddenColumns)));
    } catch {/* noop */}
  }, [hiddenColumns, lsKey]);

  const visibleColumns = useMemo(
    () => allColumns.filter((c) => !hiddenColumns.has(c.id)),
    [allColumns, hiddenColumns],
  );

  const toggleColumn = useCallback((id: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── Sorting ──────────────────────────────────────────────────────────────
  const sortedProfiles = useMemo(() => {
    if (!sortBy) return profiles;
    const col = allColumns.find(c => c.id === sortBy.id);
    if (!col?.sortValue) return profiles;
    const dirMul = sortBy.dir === 'asc' ? 1 : -1;
    return [...profiles].sort((a, b) => {
      const sa = col.sortValue!(a, jobScores[a.id], treatedCandidates.get(a.id));
      const sb = col.sortValue!(b, jobScores[b.id], treatedCandidates.get(b.id));
      if (sa == null && sb == null) return 0;
      if (sa == null) return 1;
      if (sb == null) return -1;
      if (typeof sa === 'number' && typeof sb === 'number') return (sa - sb) * dirMul;
      return String(sa).localeCompare(String(sb)) * dirMul;
    });
  }, [profiles, sortBy, allColumns, jobScores, treatedCandidates]);

  const handleSort = useCallback((id: string) => {
    setSortBy((prev) => {
      if (prev?.id !== id) return { id, dir: 'desc' };
      if (prev.dir === 'desc') return { id, dir: 'asc' };
      return null;
    });
  }, []);

  // ─── Group columns for picker ──────────────────────────────────────────────
  const columnsBySection = useMemo(() => {
    const map = new Map<ColumnSection, ColumnConfig[]>();
    for (const c of allColumns) {
      if (c.id === 'avatar') continue; // sticky, pas toggleable
      if (!map.has(c.section)) map.set(c.section, []);
      map.get(c.section)!.push(c);
    }
    return map;
  }, [allColumns]);

  // ─── Render ──────────────────────────────────────────────────────────────

  if (profiles.length === 0) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="border border-border bg-background overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 flex-wrap gap-2">
          <p className="text-xs text-muted-foreground">
            <span className="text-foreground font-medium">{profiles.length}</span> profil{profiles.length > 1 ? 's' : ''}
            {' · '}
            <span className="text-foreground font-medium">{visibleColumns.length}</span>/{allColumns.length} colonnes
            {criteriaList.length > 0 && (
              <> · <span className="text-foreground font-medium">{criteriaList.length}</span> critère{criteriaList.length > 1 ? 's' : ''} du poste</>
            )}
          </p>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                <Columns3 className="w-3.5 h-3.5" aria-hidden="true" />
                Colonnes
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 max-h-[70vh] overflow-y-auto">
              <DropdownMenuLabel className="text-xs flex items-center justify-between">
                <span>Colonnes affichées</span>
                <span className="text-muted-foreground font-normal">{visibleColumns.length}/{allColumns.length}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {Array.from(columnsBySection.entries()).map(([section, cols]) => (
                <React.Fragment key={section}>
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground pt-2">
                    {SECTION_LABELS[section]}
                  </DropdownMenuLabel>
                  {cols.map((col) => {
                    const visible = !hiddenColumns.has(col.id);
                    return (
                      <DropdownMenuCheckboxItem
                        key={col.id}
                        checked={visible}
                        onCheckedChange={() => toggleColumn(col.id)}
                        onSelect={(e) => e.preventDefault()}
                        className="text-xs cursor-pointer"
                      >
                        <span className="flex-1 truncate">{col.label}</span>
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </React.Fragment>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => { e.preventDefault(); setHiddenColumns(new Set(allColumns.filter(c => !c.defaultVisible).map(c => c.id))); }}
                className="text-xs cursor-pointer text-muted-foreground"
              >
                <Eye className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                Réinitialiser
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => { e.preventDefault(); setHiddenColumns(new Set()); }}
                className="text-xs cursor-pointer text-muted-foreground"
              >
                <EyeOff className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                Tout afficher
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40 backdrop-blur-sm sticky top-0 z-20">
                <th className="p-1.5 text-left align-middle w-8 sticky left-0 z-30 bg-muted/40 backdrop-blur-sm">
                  <Checkbox
                    checked={allSelected && profiles.length > 0}
                    onCheckedChange={onToggleSelectAll}
                    aria-label="Tout sélectionner"
                  />
                </th>
                {visibleColumns.map((col, idx) => {
                  const isSorted = sortBy?.id === col.id;
                  const sortable = !!col.sortValue;
                  // sticky position calculé : avatar=32px, name=après avatar
                  const stickyLeft = col.sticky
                    ? (col.id === 'avatar' ? 32 : 72)
                    : undefined;
                  return (
                    <th
                      key={col.id}
                      className={`px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap ${
                        col.sticky ? 'sticky z-30 bg-muted/40 backdrop-blur-sm' : ''
                      } ${col.section === 'criteres' && idx > 0 && visibleColumns[idx - 1]?.section !== 'criteres' ? 'border-l-2 border-info/30' : ''}`}
                      style={{
                        minWidth: col.minWidth ? `${col.minWidth}px` : undefined,
                        left: stickyLeft != null ? `${stickyLeft}px` : undefined,
                      }}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => handleSort(col.id)}
                          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                        >
                          <span className="truncate max-w-[140px]">{col.label}</span>
                          {isSorted ? (
                            sortBy?.dir === 'desc'
                              ? <ArrowDown className="w-3 h-3" aria-hidden="true" />
                              : <ArrowUp className="w-3 h-3" aria-hidden="true" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" aria-hidden="true" />
                          )}
                        </button>
                      ) : col.isCriterion ? (
                        <Tooltip>
                          <TooltipTrigger className="cursor-help inline-flex items-center gap-1">
                            <span className="truncate max-w-[110px]">{col.label}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="text-xs font-bold">{col.label}</p>
                            {col.criterion?.source && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                Source : {col.criterion.source === 'skills' ? 'Compétences du poste' : col.criterion.source === 'mustHave' ? 'Must-have' : col.criterion.source === 'shouldHave' ? 'Should-have' : col.criterion.source === 'niceToHave' ? 'Nice-to-have' : 'Évaluation IA'}
                              </p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      ) : col.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {sortedProfiles.map((profile) => {
                const score = jobScores[profile.id];
                const isSelected = selectedProfiles.has(profile.id);
                const status = treatedCandidates.get(profile.id);
                const fullName = profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Profil LinkedIn';
                const initials = getInitials(fullName);
                const profileUrl = getProfileUrl(profile);
                const rowBg = isSelected ? 'bg-accent/40' : '';

                return (
                  <tr
                    key={profile.id}
                    className={`group transition-colors cursor-pointer ${rowBg} hover:bg-muted/40`}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest('button, a, input, [role="checkbox"], [data-no-detail]')) return;
                      onOpenDetail(profile);
                    }}
                  >
                    {/* Checkbox sticky */}
                    <td className={`p-1.5 align-middle sticky left-0 z-10 ${rowBg || 'bg-background'} group-hover:bg-muted/40`} data-no-detail>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onToggleSelect(profile.id)}
                        aria-label={`Sélectionner ${fullName}`}
                      />
                    </td>

                    {visibleColumns.map((col, idx) => {
                      const stickyLeft = col.sticky
                        ? (col.id === 'avatar' ? 32 : 72)
                        : undefined;
                      const stickyClass = col.sticky
                        ? `sticky z-10 ${rowBg || 'bg-background'} group-hover:bg-muted/40`
                        : '';
                      const critBorder = col.section === 'criteres' && idx > 0 && visibleColumns[idx - 1]?.section !== 'criteres'
                        ? 'border-l-2 border-info/30'
                        : '';
                      const baseTd = `px-2 py-1.5 align-middle ${stickyClass} ${critBorder}`;
                      const styleObj = stickyLeft != null ? { left: `${stickyLeft}px` } : undefined;

                      // Profil
                      if (col.id === 'avatar') {
                        return (
                          <td key={col.id} className={baseTd} style={styleObj}>
                            <Avatar className="w-7 h-7 border border-border">
                              <AvatarImage src={profile.profile_picture_url} alt={fullName} className="object-cover" />
                              <AvatarFallback className="bg-primary/10 text-foreground text-[10px] font-medium">{initials}</AvatarFallback>
                            </Avatar>
                          </td>
                        );
                      }
                      if (col.id === 'name') {
                        return (
                          <td key={col.id} className={baseTd} style={styleObj}>
                            <div className="font-medium text-foreground truncate max-w-[180px]">{fullName}</div>
                          </td>
                        );
                      }
                      if (col.id === 'headline') {
                        return (
                          <td key={col.id} className={baseTd}>
                            <div className="text-muted-foreground truncate max-w-[300px]">{profile.headline || <span className="text-muted-foreground/30">—</span>}</div>
                          </td>
                        );
                      }
                      if (col.id === 'score') {
                        return (
                          <td key={col.id} className={`${baseTd} text-center`}>
                            {score?.match_score != null && score.match_score > 0 ? (
                              <span
                                className={`inline-flex items-center justify-center min-w-[36px] px-1.5 py-0.5 font-bold font-mono tabular-nums text-xs ${
                                  score.match_score >= 70
                                    ? 'bg-success/15 text-success border border-success/40'
                                    : score.match_score >= 40
                                      ? 'bg-warning/15 text-warning border border-warning/40'
                                      : 'bg-destructive/15 text-destructive border border-destructive/40'
                                }`}
                              >
                                {score.match_score}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )}
                          </td>
                        );
                      }
                      if (col.id === 'recommendation') {
                        const r = score?.recommendation;
                        if (!r) return <td key={col.id} className={`${baseTd} text-center`}><span className="text-muted-foreground/30">—</span></td>;
                        const cfg = r === 'go'
                          ? { label: 'GO', cls: 'bg-success/15 text-success border-success/40' }
                          : r === 'maybe'
                            ? { label: 'MAYBE', cls: 'bg-warning/15 text-warning border-warning/40' }
                            : { label: 'SKIP', cls: 'bg-destructive/15 text-destructive border-destructive/40' };
                        return (
                          <td key={col.id} className={`${baseTd} text-center`}>
                            <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${cfg.cls}`}>
                              {cfg.label}
                            </span>
                          </td>
                        );
                      }
                      if (col.id === 'location') {
                        return (
                          <td key={col.id} className={baseTd}>
                            <span className="truncate max-w-[140px] inline-block">{profile.location?.split(',')[0] || <span className="text-muted-foreground/30">—</span>}</span>
                          </td>
                        );
                      }
                      if (col.id === 'industry') {
                        return (
                          <td key={col.id} className={baseTd}>
                            <span className="truncate max-w-[160px] inline-block">{profile.industry || <span className="text-muted-foreground/30">—</span>}</span>
                          </td>
                        );
                      }
                      if (col.id === 'pronoun') {
                        return <td key={col.id} className={baseTd}><span className="text-muted-foreground">{profile.pronoun || <span className="text-muted-foreground/30">—</span>}</span></td>;
                      }
                      if (col.id === 'language') {
                        return <td key={col.id} className={baseTd}><span className="text-muted-foreground uppercase">{profile.primary_locale?.language || <span className="text-muted-foreground/30">—</span>}</span></td>;
                      }

                      // Signaux
                      if (col.id === 'sig_open_to_work') return <td key={col.id} className={`${baseTd} text-center`}><FlagIcon active={profile.open_to_work || profile.is_open_to_work} label="Ouvert aux opportunités" /></td>;
                      if (col.id === 'sig_premium') return <td key={col.id} className={`${baseTd} text-center`}><FlagIcon active={profile.premium || profile.is_premium} label="Compte Premium" /></td>;
                      if (col.id === 'sig_hiring') return <td key={col.id} className={`${baseTd} text-center`}><FlagIcon active={profile.is_hiring} label="En recrutement" /></td>;
                      if (col.id === 'sig_influencer') return <td key={col.id} className={`${baseTd} text-center`}><FlagIcon active={profile.is_influencer} label="Influenceur LinkedIn" /></td>;
                      if (col.id === 'sig_creator') return <td key={col.id} className={`${baseTd} text-center`}><FlagIcon active={profile.is_creator} label="Créateur de contenu" /></td>;
                      if (col.id === 'sig_can_inmail') return <td key={col.id} className={`${baseTd} text-center`}><FlagIcon active={profile.can_send_inmail} label="InMail accepté" /></td>;
                      if (col.id === 'sig_open_profile') return <td key={col.id} className={`${baseTd} text-center`}><FlagIcon active={profile.open_profile || profile.is_open_profile} label="Profil ouvert (InMail gratuit)" /></td>;
                      if (col.id === 'sig_verified') return <td key={col.id} className={`${baseTd} text-center`}><FlagIcon active={profile.verified} label="Profil vérifié" /></td>;
                      if (col.id === 'sig_recently_hired') return <td key={col.id} className={`${baseTd} text-center`}><FlagIcon active={profile.recently_hired} label="Récemment embauché" /></td>;

                      // Contact
                      if (col.id === 'email') {
                        const e = getEmail(profile);
                        return (
                          <td key={col.id} className={baseTd} data-no-detail>
                            {e ? (
                              <a href={`mailto:${e}`} className="text-info hover:underline truncate max-w-[200px] inline-flex items-center gap-1">
                                <Mail className="w-3 h-3 shrink-0" aria-hidden="true" />
                                <span className="truncate">{e}</span>
                              </a>
                            ) : <span className="text-muted-foreground/30">—</span>}
                          </td>
                        );
                      }
                      if (col.id === 'phone') {
                        const p = getPhone(profile);
                        return (
                          <td key={col.id} className={baseTd} data-no-detail>
                            {p ? (
                              <a href={`tel:${p}`} className="text-info hover:underline inline-flex items-center gap-1">
                                <Phone className="w-3 h-3 shrink-0" aria-hidden="true" />
                                <span>{p}</span>
                              </a>
                            ) : <span className="text-muted-foreground/30">—</span>}
                          </td>
                        );
                      }
                      if (col.id === 'linkedin_url') {
                        return (
                          <td key={col.id} className={baseTd} data-no-detail>
                            {profileUrl ? (
                              <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="text-info hover:underline inline-flex items-center gap-1">
                                <Linkedin className="w-3 h-3 shrink-0" aria-hidden="true" />
                                Voir
                                <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                              </a>
                            ) : <span className="text-muted-foreground/30">—</span>}
                          </td>
                        );
                      }

                      // Network
                      if (col.id === 'connections') {
                        const c = profile.connections_count;
                        return <td key={col.id} className={`${baseTd} text-right`}>{c ? <span className="tabular-nums text-muted-foreground">{c >= 1000 ? `${(c / 1000).toFixed(1)}k` : c}</span> : <span className="text-muted-foreground/30">—</span>}</td>;
                      }
                      if (col.id === 'followers') {
                        const c = profile.followers_count;
                        return <td key={col.id} className={`${baseTd} text-right`}>{c ? <span className="tabular-nums text-muted-foreground">{c >= 1000 ? `${(c / 1000).toFixed(1)}k` : c}</span> : <span className="text-muted-foreground/30">—</span>}</td>;
                      }
                      if (col.id === 'shared_connections') {
                        const c = profile.shared_connections_count;
                        return <td key={col.id} className={`${baseTd} text-right`}>{c ? <span className="tabular-nums text-muted-foreground">{c}</span> : <span className="text-muted-foreground/30">—</span>}</td>;
                      }
                      if (col.id === 'network_distance') {
                        const d = profile.network_distance;
                        return <td key={col.id} className={`${baseTd} text-center`}>{d != null ? <span className="text-muted-foreground">{typeof d === 'number' ? `${d}°` : d}</span> : <span className="text-muted-foreground/30">—</span>}</td>;
                      }

                      // Expériences
                      if (col.id === 'years_exp') {
                        const y = getYearsOfExp(profile);
                        return <td key={col.id} className={`${baseTd} text-center`}>{y > 0 ? <span className="tabular-nums text-muted-foreground">{y}a</span> : <span className="text-muted-foreground/30">—</span>}</td>;
                      }
                      if (col.id === 'jobs_count') {
                        const c = profile.work_experience?.length ?? 0;
                        return <td key={col.id} className={`${baseTd} text-center`}>{c > 0 ? <span className="tabular-nums text-muted-foreground">{c}</span> : <span className="text-muted-foreground/30">—</span>}</td>;
                      }
                      if (col.id.startsWith('exp_')) {
                        const i = parseInt(col.id.slice(4), 10) - 1;
                        return <td key={col.id} className={baseTd}><ExperienceCell exp={profile.work_experience?.[i]} /></td>;
                      }

                      // Formation
                      if (col.id.startsWith('edu_')) {
                        const i = parseInt(col.id.slice(4), 10) - 1;
                        return <td key={col.id} className={baseTd}><EducationCell edu={profile.education?.[i]} /></td>;
                      }

                      // Skills
                      if (col.id === 'skills_top') {
                        const skills = profile.skills?.slice(0, 5).map(s => s.name).filter(Boolean) || [];
                        return (
                          <td key={col.id} className={baseTd}>
                            {skills.length > 0 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex flex-wrap gap-1 max-w-[260px]">
                                    {skills.slice(0, 3).map((s, i) => (
                                      <span key={i} className="text-[10px] px-1 py-0.5 bg-muted text-muted-foreground truncate max-w-[80px]">{s}</span>
                                    ))}
                                    {skills.length > 3 && <span className="text-[10px] text-muted-foreground">+{skills.length - 3}</span>}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <div className="text-xs">{skills.join(', ')}</div>
                                </TooltipContent>
                              </Tooltip>
                            ) : <span className="text-muted-foreground/30">—</span>}
                          </td>
                        );
                      }
                      if (col.id === 'skills_count') {
                        const c = profile.skills?.length ?? 0;
                        return <td key={col.id} className={`${baseTd} text-center`}>{c > 0 ? <span className="tabular-nums text-muted-foreground">{c}</span> : <span className="text-muted-foreground/30">—</span>}</td>;
                      }
                      if (col.id === 'languages') {
                        const langs = profile.languages?.map(l => l.name).filter(Boolean) || [];
                        return <td key={col.id} className={baseTd}>{langs.length > 0 ? <span className="text-muted-foreground truncate max-w-[140px] inline-block">{langs.join(', ')}</span> : <span className="text-muted-foreground/30">—</span>}</td>;
                      }

                      // Statut Konekt
                      if (col.id === 'konekt_status') {
                        const statusLabel = status?.status === 'messaged' ? 'Contacté'
                          : status?.status === 'replied' ? 'Répondu'
                          : status?.status === 'shortlisted' ? 'Pressenti'
                          : status?.status === 'dismissed' ? 'Archivé'
                          : status?.status === 'scored' ? 'Scoré'
                          : null;
                        return (
                          <td key={col.id} className={baseTd}>
                            {statusLabel ? (
                              <span className={`text-[10px] px-1.5 py-0.5 uppercase tracking-wider font-bold ${
                                status?.status === 'replied' ? 'bg-success/10 text-success'
                                : status?.status === 'messaged' ? 'bg-info/10 text-info'
                                : status?.status === 'dismissed' ? 'bg-destructive/10 text-destructive'
                                : 'bg-muted text-muted-foreground'
                              }`}>
                                {statusLabel}
                              </span>
                            ) : <span className="text-muted-foreground/30">—</span>}
                          </td>
                        );
                      }

                      // Actions
                      if (col.id === 'actions') {
                        return (
                          <td key={col.id} className={baseTd} data-no-detail>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Actions pour ${fullName}`}>
                                  <MoreHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">
                                {profileUrl && (
                                  <DropdownMenuItem onSelect={() => window.open(profileUrl, '_blank', 'noopener,noreferrer')} className="cursor-pointer text-xs">
                                    <Linkedin className="w-3.5 h-3.5 mr-2 text-info" aria-hidden="true" />
                                    Ouvrir le profil LinkedIn
                                    <ExternalLink className="w-3 h-3 ml-auto text-muted-foreground" aria-hidden="true" />
                                  </DropdownMenuItem>
                                )}
                                {profile.can_send_inmail && (
                                  <DropdownMenuItem onSelect={() => onOpenDetail(profile)} className="cursor-pointer text-xs">
                                    <Mail className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                                    Envoyer un InMail
                                  </DropdownMenuItem>
                                )}
                                {onArchive && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onSelect={() => onArchive(profile)}
                                      className="cursor-pointer text-xs text-destructive focus:text-destructive focus:bg-destructive/10"
                                    >
                                      <Archive className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                                      Archiver
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        );
                      }

                      // Critères dynamiques
                      if (col.isCriterion && col.criterion) {
                        const v = resolveVerdict(col.criterion, score);
                        return (
                          <td key={col.id} className={`${baseTd} text-center`}>
                            <VerdictCell verdict={v.verdict} label={col.criterion.label} reason={v.reason} />
                          </td>
                        );
                      }

                      return <td key={col.id} className={baseTd} />;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer info */}
        {selectedJob && criteriaList.length === 0 && (
          <div className="px-3 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground flex items-center gap-1.5">
            <HelpCircle className="w-3 h-3" aria-hidden="true" />
            <span>Aucun critère défini sur ce poste — ajoutez compétences ou must/should/nice-to-have dans le brief pour voir les colonnes critères.</span>
          </div>
        )}
        {selectedJob && criteriaList.length > 0 && Object.keys(jobScores).length === 0 && (
          <div className="px-3 py-2 border-t border-border bg-info/10 text-xs text-info flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            <span>Lancez le scoring pour évaluer les profils sur les critères du poste.</span>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};
