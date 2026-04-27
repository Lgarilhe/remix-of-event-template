/**
 * CompactResultsTable — vue table des résultats de recherche LinkedIn.
 *
 * Refonte mode compact 2026-04-27 : avant le mode "compact" cachait juste
 * les sections riches des cards. Maintenant c'est une vraie table avec :
 *
 * - 1 ligne par profil (densité maximale, scan rapide 50+ profils)
 * - Logos entreprise + école conservés (visuels !)
 * - Colonnes critères du job (✅ / ⚠️ / ❌ / ?) depuis criteriaEvaluations
 * - Column picker — l'user choisit quelles colonnes afficher (persisté localStorage)
 * - Click sur une ligne ouvre le sheet de détail
 * - Actions menu accessible par ligne
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
import {
  Building2, GraduationCap, Check, X, AlertTriangle, HelpCircle,
  ExternalLink, Linkedin, Mail, Archive, MoreHorizontal, Columns3, Eye, EyeOff,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CriteriaEvaluation {
  label: string;
  verdict: 'pass' | 'partial' | 'fail' | 'unknown';
  reason?: string;
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

type StandardColumnId = 'avatar' | 'name' | 'headline' | 'score' | 'company' | 'school' | 'experience' | 'location' | 'connections' | 'status' | 'actions';

interface ColumnConfig {
  id: string;
  label: string;
  defaultVisible: boolean;
  /** True = colonne dynamique générée depuis un critère */
  isCriterion?: boolean;
  /** Largeur min-w fixe en px (sinon flex) */
  minWidth?: number;
}

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

function VerdictIcon({ verdict, label, reason }: { verdict: CriteriaEvaluation['verdict'] | null; label: string; reason?: string }) {
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
  // unknown / not yet scored
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
}

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
  // ─── Compute available criteria (union de tous les profils scorés) ────────
  const availableCriteria = useMemo(() => {
    const labels = new Set<string>();
    for (const profile of profiles) {
      const score = jobScores[profile.id];
      if (score?.criteriaEvaluations) {
        for (const ev of score.criteriaEvaluations) {
          if (ev.label) labels.add(ev.label);
        }
      }
    }
    return Array.from(labels).sort();
  }, [profiles, jobScores]);

  // ─── Build column registry (standard + dynamic criteria) ──────────────────
  const allColumns: ColumnConfig[] = useMemo(() => {
    const standard: ColumnConfig[] = [
      { id: 'avatar', label: 'Avatar', defaultVisible: true, minWidth: 40 },
      { id: 'name', label: 'Nom', defaultVisible: true, minWidth: 140 },
      { id: 'headline', label: 'Headline', defaultVisible: true, minWidth: 200 },
      { id: 'score', label: 'Score IA', defaultVisible: true, minWidth: 60 },
      { id: 'company', label: 'Entreprise', defaultVisible: true, minWidth: 130 },
      { id: 'school', label: 'Formation', defaultVisible: true, minWidth: 130 },
      { id: 'experience', label: 'Expérience', defaultVisible: false, minWidth: 80 },
      { id: 'location', label: 'Lieu', defaultVisible: false, minWidth: 100 },
      { id: 'connections', label: 'Connexions', defaultVisible: false, minWidth: 70 },
      { id: 'status', label: 'Statut', defaultVisible: false, minWidth: 80 },
    ];
    const criteria: ColumnConfig[] = availableCriteria.map((label) => ({
      id: `crit:${label}`,
      label,
      defaultVisible: true,
      isCriterion: true,
      minWidth: 60,
    }));
    const actions: ColumnConfig[] = [
      { id: 'actions', label: 'Actions', defaultVisible: true, minWidth: 50 },
    ];
    return [...standard, ...criteria, ...actions];
  }, [availableCriteria]);

  // ─── Column visibility (persisted localStorage) ───────────────────────────
  const lsKey = `konekt_table_columns_${storageKey || 'default'}`;
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(lsKey);
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) return new Set(arr);
      }
    } catch {/* noop */}
    // Default : cache les colonnes avec defaultVisible=false
    return new Set(allColumns.filter(c => !c.defaultVisible).map(c => c.id));
  });

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

  // ─── Render ──────────────────────────────────────────────────────────────

  if (profiles.length === 0) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="border border-border bg-background overflow-hidden">
        {/* Toolbar : column picker */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
          <p className="text-xs text-muted-foreground">
            {profiles.length} profil{profiles.length > 1 ? 's' : ''} · {visibleColumns.length} colonne{visibleColumns.length > 1 ? 's' : ''} affichée{visibleColumns.length > 1 ? 's' : ''}
            {availableCriteria.length > 0 && (
              <> · <span className="text-foreground font-medium">{availableCriteria.length} critère{availableCriteria.length > 1 ? 's' : ''}</span> du poste</>
            )}
          </p>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                <Columns3 className="w-3.5 h-3.5" aria-hidden="true" />
                Colonnes ({visibleColumns.length}/{allColumns.length})
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-h-[60vh] overflow-y-auto">
              <DropdownMenuLabel className="text-xs">Colonnes affichées</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {allColumns.map((col) => {
                const visible = !hiddenColumns.has(col.id);
                return (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={visible}
                    onCheckedChange={() => toggleColumn(col.id)}
                    onSelect={(e) => e.preventDefault()}
                    className="text-xs cursor-pointer"
                  >
                    <span className="flex-1 truncate">
                      {col.label}
                      {col.isCriterion && (
                        <span className="ml-1.5 text-[9px] uppercase tracking-wider text-info bg-info/10 px-1 py-0.5">
                          Critère
                        </span>
                      )}
                    </span>
                  </DropdownMenuCheckboxItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => { e.preventDefault(); setHiddenColumns(new Set(allColumns.filter(c => !c.defaultVisible).map(c => c.id))); }}
                className="text-xs cursor-pointer text-muted-foreground"
              >
                <Eye className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                Afficher les colonnes par défaut
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

        {/* Table — scroll horizontal pour beaucoup de critères */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/20 sticky top-0 z-10">
                <th className="p-1.5 text-left align-middle w-8">
                  <Checkbox
                    checked={allSelected && profiles.length > 0}
                    onCheckedChange={onToggleSelectAll}
                    aria-label="Tout sélectionner"
                  />
                </th>
                {visibleColumns.map((col) => (
                  <th
                    key={col.id}
                    className="px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap"
                    style={{ minWidth: col.minWidth ? `${col.minWidth}px` : undefined }}
                  >
                    {col.isCriterion ? (
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">
                          <span className="truncate max-w-[100px] inline-block align-middle">
                            {col.label}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{col.label}</TooltipContent>
                      </Tooltip>
                    ) : col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {profiles.map((profile) => {
                const score = jobScores[profile.id];
                const isSelected = selectedProfiles.has(profile.id);
                const status = treatedCandidates.get(profile.id);
                const fullName = profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Profil LinkedIn';
                const initials = getInitials(fullName);
                const profileUrl = profile.profile_url || profile.public_profile_url;

                // Current job & top education
                const currentJob = profile.work_experience?.find((j: any) => !j.end || j.current) || profile.work_experience?.[0];
                const topEducation = profile.education?.[0];
                const yearsExp = profile.work_experience?.length ?? 0;

                // Build criteria lookup map for this profile
                const critByLabel = new Map<string, CriteriaEvaluation>();
                if (score?.criteriaEvaluations) {
                  for (const ev of score.criteriaEvaluations) {
                    if (ev.label) critByLabel.set(ev.label, ev as CriteriaEvaluation);
                  }
                }

                return (
                  <tr
                    key={profile.id}
                    className={`transition-colors cursor-pointer ${isSelected ? 'bg-accent/30' : 'hover:bg-muted/30'}`}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest('button, a, input, [role="checkbox"], [data-no-detail]')) return;
                      onOpenDetail(profile);
                    }}
                  >
                    {/* Checkbox */}
                    <td className="p-1.5 align-middle" data-no-detail>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onToggleSelect(profile.id)}
                        aria-label={`Sélectionner ${fullName}`}
                      />
                    </td>

                    {visibleColumns.map((col) => {
                      // Standard columns
                      if (col.id === 'avatar') {
                        return (
                          <td key={col.id} className="px-2 py-1.5 align-middle">
                            <Avatar className="w-7 h-7 border border-border">
                              <AvatarImage src={profile.profile_picture_url} alt={fullName} className="object-cover" />
                              <AvatarFallback className="bg-primary/10 text-foreground text-[10px] font-medium">{initials}</AvatarFallback>
                            </Avatar>
                          </td>
                        );
                      }
                      if (col.id === 'name') {
                        return (
                          <td key={col.id} className="px-2 py-1.5 align-middle">
                            <div className="font-medium text-foreground truncate max-w-[160px]">{fullName}</div>
                          </td>
                        );
                      }
                      if (col.id === 'headline') {
                        return (
                          <td key={col.id} className="px-2 py-1.5 align-middle">
                            <div className="text-muted-foreground truncate max-w-[280px]">{profile.headline || '—'}</div>
                          </td>
                        );
                      }
                      if (col.id === 'score') {
                        return (
                          <td key={col.id} className="px-2 py-1.5 align-middle text-center">
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
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </td>
                        );
                      }
                      if (col.id === 'company') {
                        const logo = getCompanyLogo(currentJob);
                        return (
                          <td key={col.id} className="px-2 py-1.5 align-middle">
                            {currentJob?.company ? (
                              <div className="flex items-center gap-1.5 min-w-0">
                                {logo ? (
                                  <img src={logo} alt="" className="w-4 h-4 rounded-sm object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                ) : (
                                  <Building2 className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" aria-hidden="true" />
                                )}
                                <span className="truncate max-w-[120px]">{currentJob.company}</span>
                              </div>
                            ) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                        );
                      }
                      if (col.id === 'school') {
                        const logo = getSchoolLogo(topEducation);
                        return (
                          <td key={col.id} className="px-2 py-1.5 align-middle">
                            {topEducation?.school ? (
                              <div className="flex items-center gap-1.5 min-w-0">
                                {logo ? (
                                  <img src={logo} alt="" className="w-4 h-4 rounded-sm object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                ) : (
                                  <GraduationCap className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" aria-hidden="true" />
                                )}
                                <span className="truncate max-w-[120px]">{topEducation.school}</span>
                              </div>
                            ) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                        );
                      }
                      if (col.id === 'experience') {
                        return (
                          <td key={col.id} className="px-2 py-1.5 align-middle text-center">
                            <span className="tabular-nums text-muted-foreground">{yearsExp}</span>
                          </td>
                        );
                      }
                      if (col.id === 'location') {
                        return (
                          <td key={col.id} className="px-2 py-1.5 align-middle">
                            <span className="truncate max-w-[120px] inline-block">{profile.location?.split(',')[0] || <span className="text-muted-foreground/40">—</span>}</span>
                          </td>
                        );
                      }
                      if (col.id === 'connections') {
                        return (
                          <td key={col.id} className="px-2 py-1.5 align-middle text-right">
                            {profile.connections_count ? (
                              <span className="tabular-nums text-muted-foreground">
                                {profile.connections_count >= 1000
                                  ? `${Math.round(profile.connections_count / 100) / 10}k`
                                  : profile.connections_count}
                              </span>
                            ) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                        );
                      }
                      if (col.id === 'status') {
                        const statusLabel = status?.status === 'messaged' ? 'Contacté'
                          : status?.status === 'replied' ? 'Répondu'
                          : status?.status === 'shortlisted' ? 'Pressenti'
                          : status?.status === 'dismissed' ? 'Archivé'
                          : status?.status === 'scored' ? 'Scoré'
                          : null;
                        return (
                          <td key={col.id} className="px-2 py-1.5 align-middle">
                            {statusLabel ? (
                              <span className={`text-[10px] px-1.5 py-0.5 uppercase tracking-wider font-bold ${
                                status?.status === 'replied' ? 'bg-success/10 text-success'
                                : status?.status === 'messaged' ? 'bg-info/10 text-info'
                                : status?.status === 'dismissed' ? 'bg-destructive/10 text-destructive'
                                : 'bg-muted text-muted-foreground'
                              }`}>
                                {statusLabel}
                              </span>
                            ) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                        );
                      }
                      if (col.id === 'actions') {
                        return (
                          <td key={col.id} className="px-2 py-1.5 align-middle" data-no-detail>
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

                      // Dynamic criterion columns
                      if (col.id.startsWith('crit:')) {
                        const label = col.id.slice(5);
                        const ev = critByLabel.get(label);
                        return (
                          <td key={col.id} className="px-2 py-1.5 align-middle text-center">
                            <VerdictIcon
                              verdict={ev?.verdict ?? null}
                              label={label}
                              reason={ev?.reason}
                            />
                          </td>
                        );
                      }

                      return <td key={col.id} className="px-2 py-1.5" />;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer info si pas encore scoré */}
        {selectedJob && availableCriteria.length === 0 && (
          <div className="px-3 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground flex items-center gap-1.5">
            <HelpCircle className="w-3 h-3" aria-hidden="true" />
            <span>Aucun critère évalué — sélectionnez des profils et lancez le scoring pour voir les colonnes critères.</span>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};
