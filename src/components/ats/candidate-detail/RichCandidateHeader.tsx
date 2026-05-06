/**
 * RichCandidateHeader — Header riche pour CandidateDetailModal qui mirror
 * le rendu visuel de LinkedInResultCard (la card sourcing).
 *
 * Pourquoi : avant le header du modal pipeline était basique (juste nom +
 * headline + 3 metas en ligne). Or les données riches LinkedIn sont déjà
 * disponibles via candidate.linkedinProfileData (JSONB sur job_candidate_status).
 * Cette refonte donne au pipeline le même niveau de richesse visuelle que
 * la sourcing card :
 *   - Avatar 14x14 + badge degré de connexion (1°/2°/3°)
 *   - Nom + score badge
 *   - Headline 2 lignes
 *   - Meta row : entreprise (logo) + tenure + ville + années XP + connexions
 *   - Skills preview en chips
 *   - Badges Open to Work / Premium si applicable
 *
 * Le détail (work experience / education complète) reste dans les onglets
 * existants du modal (Profil + Évaluation), pour pas dupliquer.
 */

import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Building2, MapPin, TrendingUp, Users as UsersIcon, Briefcase,
  GraduationCap, Sparkles, Target, Award, Mail, X, Link2, Phone,
} from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import { ATSCandidate, ATS_STAGES } from '@/hooks/useATSData';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Props {
  candidate: ATSCandidate;
  /** Données LinkedIn riches (linkedin_profile_data depuis job_candidate_status). */
  linkedinProfileData: any | null;
  newTag: string;
  onNewTagChange: (v: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  onStageChange: (newStage: string) => void;
  onScoreClick?: () => void;
  onClose: () => void;
  onCreatePortalLink: () => void;
}

const getInitials = (name: string): string => {
  if (!name) return '?';
  return name.split(' ').slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
};

const getNetworkDistance = (raw: any): number | null => {
  if (raw === 1 || raw === '1' || raw === 'DISTANCE_1' || raw === 'FIRST_DEGREE') return 1;
  if (raw === 2 || raw === '2' || raw === 'DISTANCE_2' || raw === 'SECOND_DEGREE') return 2;
  if (raw === 3 || raw === '3' || raw === 'DISTANCE_3' || raw === 'THIRD_DEGREE') return 3;
  return null;
};

const getTenureLabel = (start?: { year?: number; month?: number }, end?: { year?: number; month?: number }): string | null => {
  if (!start?.year) return null;
  const s = new Date(start.year, (start.month || 1) - 1);
  const e = end?.year ? new Date(end.year, (end.month || 12) - 1) : new Date();
  const diff = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  const y = Math.floor(diff / 12);
  const m = diff % 12;
  if (y > 0 && m > 0) return `${y} an${y > 1 ? 's' : ''} ${m}m`;
  if (y > 0) return `${y} an${y > 1 ? 's' : ''}`;
  if (m > 0) return `${m} mois`;
  return null;
};

export const RichCandidateHeader: React.FC<Props> = ({
  candidate, linkedinProfileData, newTag, onNewTagChange, onAddTag, onRemoveTag,
  onStageChange, onScoreClick, onClose, onCreatePortalLink,
}) => {
  // Extraction des données LinkedIn riches (ou fallback sur ATSCandidate basique)
  const fullName = linkedinProfileData?.name || candidate.name;
  const headline = linkedinProfileData?.headline || candidate.headline || null;
  const avatarUrl = linkedinProfileData?.profile_picture_url || null;
  const location = linkedinProfileData?.location || null;
  const networkDistance = getNetworkDistance(linkedinProfileData?.network_distance);
  const openToWork = !!linkedinProfileData?.open_to_work;
  const premium = !!linkedinProfileData?.premium;
  const connectionsCount = linkedinProfileData?.connections_count;

  const workExperience = linkedinProfileData?.work_experience || [];
  const currentJob = workExperience.find((e: any) => !e.end) || workExperience[0];
  const currentCompany = currentJob?.company;
  const currentRole = currentJob?.role || currentJob?.position;
  const companyLogo = currentJob?.logo;
  const currentTenure = currentJob ? getTenureLabel(currentJob.start, currentJob.end) : null;

  const yearsOfExperience = (() => {
    if (workExperience.length === 0) return null;
    const years = workExperience
      .map((e: any) => e.start?.year)
      .filter(Boolean) as number[];
    if (years.length === 0) return null;
    return new Date().getFullYear() - Math.min(...years);
  })();

  const skills = (linkedinProfileData?.skills || [])
    .map((s: any) => typeof s === 'string' ? s : s.name)
    .filter(Boolean)
    .slice(0, 8) as string[];
  const skillsOverflow = (linkedinProfileData?.skills?.length || 0) - skills.length;

  const education = linkedinProfileData?.education?.[0];
  const educationLabel = education
    ? [education.school_name || education.school, education.degree || education.degree_name].filter(Boolean).join(' · ')
    : null;

  return (
    <div className="px-3 sm:px-6 pt-3 sm:pt-5 pb-2 sm:pb-3">
      {/* ═══ Row 1 : Avatar + Identity + Close button ═══ */}
      <div className="flex items-start gap-3 sm:gap-4">
        {/* Avatar avec badge degré de connexion */}
        <div className="relative shrink-0">
          <Avatar className="w-14 h-14 sm:w-[68px] sm:h-[68px] ring-2 ring-border shadow-md">
            <AvatarImage src={avatarUrl || undefined} alt={fullName} className="object-cover" />
            <AvatarFallback className="bg-gradient-to-br from-foreground/20 to-foreground/10 text-foreground text-base sm:text-lg font-bold">
              {getInitials(fullName)}
            </AvatarFallback>
          </Avatar>
          {networkDistance && (
            <span
              className="absolute -bottom-1 -right-1 w-5 h-5 bg-background border-2 border-foreground rounded-full flex items-center justify-center text-[10px] font-bold text-foreground tabular-nums"
              title={`${networkDistance}${networkDistance === 1 ? 'er' : 'e'} degré de connexion LinkedIn`}
            >
              {networkDistance}°
            </span>
          )}
        </div>

        {/* Identity block */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <h2 className="font-display font-bold text-foreground text-[17px] sm:text-[20px] tracking-tight leading-tight break-words">
              {fullName}
            </h2>

            {/* Score badge */}
            {candidate.score != null && candidate.score > 0 && (
              <button
                onClick={onScoreClick}
                aria-label={`Score ${candidate.score}/100, clic pour évaluation`}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold tabular-nums border transition-colors hover:opacity-90',
                  candidate.score >= 70
                    ? 'bg-success/15 text-success border-success/40'
                    : candidate.score >= 50
                      ? 'bg-warning/15 text-warning border-warning/40'
                      : 'bg-destructive/15 text-destructive border-destructive/40',
                )}
              >
                <Target className="w-3 h-3" aria-hidden="true" />
                {candidate.score}
              </button>
            )}

            {openToWork && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-success/10 text-success border-success/30 font-semibold">
                <Sparkles className="w-2.5 h-2.5 mr-0.5" />
                Open to work
              </Badge>
            )}
            {premium && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-warning/10 text-warning border-warning/30 font-semibold">
                <Award className="w-2.5 h-2.5 mr-0.5" />
                Premium
              </Badge>
            )}
          </div>

          {/* Headline (2 lignes max) */}
          {headline && (
            <p className="text-[13px] sm:text-[14px] text-muted-foreground line-clamp-2 mt-1 leading-snug break-words">
              {headline}
            </p>
          )}

          {/* Meta row : entreprise + tenure + location + experience + connexions */}
          <div className="flex items-center gap-x-2 gap-y-1 mt-2 text-[11.5px] text-muted-foreground flex-wrap min-w-0">
            {currentCompany && (
              <span className="flex items-center gap-1.5 font-medium text-foreground/85 min-w-0">
                {companyLogo ? (
                  <img src={companyLogo} alt="" className="w-4 h-4 rounded object-contain bg-card border border-border/30 shrink-0" />
                ) : (
                  <Building2 className="w-3.5 h-3.5 text-foreground/50 shrink-0" />
                )}
                <span className="truncate max-w-[180px]">{currentCompany}</span>
                {currentRole && <span className="text-muted-foreground/70">· {currentRole}</span>}
                {currentTenure && (
                  <span className="text-muted-foreground/70 tabular-nums">({currentTenure})</span>
                )}
              </span>
            )}
            {location && (
              <>
                {currentCompany && <span className="text-muted-foreground/40">•</span>}
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {location.split(',')[0]}
                </span>
              </>
            )}
            {yearsOfExperience && (
              <>
                <span className="text-muted-foreground/40">•</span>
                <span className="flex items-center gap-1 text-success font-medium tabular-nums">
                  <TrendingUp className="w-3 h-3" />
                  {yearsOfExperience} ans XP
                </span>
              </>
            )}
            {connectionsCount && connectionsCount > 0 && (
              <>
                <span className="text-muted-foreground/40">•</span>
                <span className="flex items-center gap-1 tabular-nums">
                  <UsersIcon className="w-3 h-3" />
                  {connectionsCount >= 500 ? '500+' : connectionsCount}
                </span>
              </>
            )}
          </div>

          {/* Education (1 ligne) */}
          {educationLabel && (
            <p className="text-[11px] text-muted-foreground/80 mt-1 inline-flex items-center gap-1">
              <GraduationCap className="w-3 h-3 shrink-0" />
              <span className="truncate">{educationLabel}</span>
            </p>
          )}

          {/* Skills preview chips */}
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {skills.map((skill, i) => (
                <span
                  key={i}
                  className="inline-flex items-center text-[10.5px] px-1.5 py-0.5 rounded-full bg-foreground/[0.06] text-foreground/80 border border-border"
                >
                  {skill}
                </span>
              ))}
              {skillsOverflow > 0 && (
                <span className="inline-flex items-center text-[10.5px] px-1.5 py-0.5 rounded-full text-muted-foreground border border-border bg-muted/30">
                  +{skillsOverflow}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="h-8 w-8 grid place-items-center rounded-full border border-border bg-background hover:bg-accent transition-colors shrink-0"
          aria-label="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ═══ Row 2 : Stage selector + Quick actions ═══ */}
      <div className="flex flex-wrap items-center gap-2 mt-3 sm:mt-4 pb-3 border-b border-border">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hidden sm:inline">
          Étape
        </span>
        <Select value={candidate.stage} onValueChange={onStageChange}>
          <SelectTrigger className="w-[150px] sm:w-[180px] h-8 text-xs rounded-full border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-lg border-border">
            {ATS_STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          {candidate.linkedin && (
            <a
              href={candidate.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border border-border bg-background hover:bg-accent text-[11.5px] font-medium transition-colors"
              title="Ouvrir le profil LinkedIn"
            >
              <img src={linkedinLogo} alt="LinkedIn" className="w-3.5 h-3.5 object-contain" />
              <span className="hidden sm:inline">LinkedIn</span>
            </a>
          )}
          {candidate.email && (
            <a
              href={`mailto:${candidate.email}`}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border border-border bg-background hover:bg-accent text-[11.5px] font-medium transition-colors"
              title={candidate.email}
            >
              <Mail className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Email</span>
            </a>
          )}
          {candidate.phone && (
            <a
              href={`tel:${candidate.phone}`}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border border-border bg-background hover:bg-accent text-[11.5px] font-medium transition-colors"
              title={candidate.phone}
            >
              <Phone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Tél</span>
            </a>
          )}
          <button
            onClick={onCreatePortalLink}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-success text-success-foreground text-[11.5px] font-bold hover:bg-success/90 transition-colors shadow-sm"
            title="Générer un lien portail candidat (à partager avec le client)"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Portail</span>
          </button>
        </div>
      </div>

      {/* ═══ Row 3 : Tags ═══ */}
      <div className="hidden sm:flex flex-wrap items-center gap-1.5 mt-3 pb-3 border-b border-border">
        {(candidate.tags || []).map(tag => (
          <span
            key={tag}
            className="text-[11px] px-2 py-0.5 rounded-full bg-accent/20 text-foreground border border-accent/40 font-medium flex items-center gap-1 cursor-pointer hover:bg-destructive/10 hover:border-destructive/40 hover:text-destructive transition-colors"
            onClick={() => onRemoveTag(tag)}
            title="Cliquer pour supprimer"
          >
            {tag} ×
          </span>
        ))}
        <form
          className="flex items-center gap-0"
          onSubmit={(e) => {
            e.preventDefault();
            onAddTag();
          }}
        >
          <Input
            value={newTag}
            onChange={(e) => onNewTagChange(e.target.value)}
            placeholder="+ tag"
            className="h-6 w-20 text-[11px] rounded-full border-border px-2"
          />
        </form>
      </div>
    </div>
  );
};
