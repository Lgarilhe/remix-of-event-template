/**
 * ProfileDetailedTab — vue détaillée du profil candidat (Expérience +
 * Formation + Compétences + Langues + summary).
 *
 * Refonte 2026-05-06 : avant on réutilisait les ProfileExperienceList /
 * ProfileEducationList qui sont OK pour un cards préview compact en
 * sourcing, mais visuellement étriqués dans un tab plein écran. Ici on
 * fait une version "full presence" avec :
 *   - Logos 40px (vs 24px)
 *   - Titres 15px font-display
 *   - Spacing aéré (gap-4, space-y-5)
 *   - Description du poste affichée si dispo
 *   - Localisation, lieu de travail
 *   - Durée prominente avec puce verte si poste actuel
 *   - Séparateurs visuels nets entre sections
 */

import React, { useState } from 'react';
import {
  Briefcase, GraduationCap, Award, Languages, Sparkles, Building2,
  MapPin, Calendar, ChevronDown, ChevronUp,
} from 'lucide-react';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { cn } from '@/lib/utils';

interface Props {
  /** Le linkedin_profile_data raw (JSONB) du candidat. */
  linkedinProfileData: any | null;
  /** Profile dérivé déjà parsé (skills, languages, experiences/education
   *  pré-formattés). Peut être null si pas de data. */
  enrichedProfile: EnrichedProfile | null;
}

export const ProfileDetailedTab: React.FC<Props> = ({ linkedinProfileData, enrichedProfile }) => {
  const summary = enrichedProfile?.summary || linkedinProfileData?.summary;
  const workExperience = (linkedinProfileData?.work_experience || []) as any[];
  const education = (linkedinProfileData?.education || []) as any[];
  const skills = enrichedProfile?.skills || [];
  const languages = enrichedProfile?.languages || [];

  if (!summary && workExperience.length === 0 && education.length === 0 && skills.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-semibold">Profil LinkedIn non disponible</p>
        <p className="text-xs mt-1">
          Ce candidat n'a pas encore de données LinkedIn enrichies.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ═══ À PROPOS ═══ */}
      {summary && (
        <Section title="À propos" icon={Sparkles}>
          <p className="text-[13.5px] leading-relaxed text-foreground/90 whitespace-pre-line">
            {summary}
          </p>
        </Section>
      )}

      {/* ═══ EXPÉRIENCE PRO ═══ */}
      {workExperience.length > 0 && (
        <Section
          title="Expérience"
          subtitle={`${workExperience.length} position${workExperience.length > 1 ? 's' : ''}`}
          icon={Briefcase}
        >
          <ExperienceList experiences={workExperience} />
        </Section>
      )}

      {/* ═══ FORMATION ═══ */}
      {education.length > 0 && (
        <Section
          title="Formation"
          subtitle={`${education.length} école${education.length > 1 ? 's' : ''}`}
          icon={GraduationCap}
        >
          <EducationList education={education} />
        </Section>
      )}

      {/* ═══ COMPÉTENCES + LANGUES (2-cols sur lg) ═══ */}
      {(skills.length > 0 || languages.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
          {skills.length > 0 && (
            <Section
              title="Compétences"
              subtitle={`${skills.length} skill${skills.length > 1 ? 's' : ''}`}
              icon={Award}
            >
              <div className="flex flex-wrap gap-1.5">
                {skills.map((skill, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center text-[12px] px-2.5 py-1 rounded-full bg-foreground/[0.06] text-foreground/85 border border-border"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {languages.length > 0 && (
            <Section
              title="Langues"
              icon={Languages}
            >
              <div className="flex flex-wrap gap-1.5">
                {languages.map((lang, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center text-[12px] px-2.5 py-1 rounded-full bg-info/10 text-info border border-info/30 font-medium"
                  >
                    {lang}
                  </span>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// Sub-components — version "rich" avec logos plus gros + plus d'air
// ═══════════════════════════════════════════════════════════════════

function Section({
  title, subtitle, icon: Icon, children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/15">
        <div className="h-8 w-8 rounded-lg bg-emerald-500/15 grid place-items-center shrink-0">
          <Icon className="w-4 h-4 text-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-[14px] tracking-tight text-foreground leading-tight">
            {title}
          </h3>
          {subtitle && (
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/70">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─── Experience list (rich) ────────────────────────────────────────

interface RawExperience {
  company?: string;
  company_logo?: string;
  logo_url?: string;
  logo?: string;
  company_picture_url?: string;
  role?: string;
  position?: string;
  title?: string;
  description?: string;
  location?: string;
  start?: { year?: number; month?: number };
  end?: { year?: number; month?: number };
  current?: boolean;
}

function ExperienceList({ experiences }: { experiences: RawExperience[] }) {
  // Tri par date de début descendante (plus récent en premier)
  const sorted = [...experiences].sort((a, b) => {
    const aYear = a.start?.year ?? 0;
    const bYear = b.start?.year ?? 0;
    if (aYear !== bYear) return bYear - aYear;
    return (b.start?.month ?? 0) - (a.start?.month ?? 0);
  });

  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? sorted : sorted.slice(0, 3);
  const hidden = sorted.length - visible.length;

  return (
    <div className="space-y-4">
      {visible.map((exp, i) => (
        <ExperienceItem key={i} exp={exp} />
      ))}
      {hidden > 0 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full inline-flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-foreground/30 py-2 rounded-lg transition-colors"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          Voir {hidden} expérience{hidden > 1 ? 's' : ''} de plus
        </button>
      )}
      {showAll && sorted.length > 3 && (
        <button
          onClick={() => setShowAll(false)}
          className="w-full inline-flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground py-1.5 transition-colors"
        >
          <ChevronUp className="w-3.5 h-3.5" />
          Réduire
        </button>
      )}
    </div>
  );
}

function ExperienceItem({ exp }: { exp: RawExperience }) {
  const role = exp.role || exp.position || exp.title || 'Poste';
  const company = exp.company || '—';
  const logo = exp.company_logo || exp.logo_url || exp.logo || exp.company_picture_url;
  const isCurrent = exp.current || !exp.end;
  const period = formatPeriod(exp.start, exp.end, isCurrent);
  const tenure = computeTenure(exp.start, exp.end);

  return (
    <div className="flex items-start gap-3.5">
      {/* Logo entreprise — 40px (vs 24px avant) */}
      {logo ? (
        <img
          src={logo}
          alt=""
          className="w-10 h-10 rounded-lg object-contain bg-card border border-border shrink-0"
        />
      ) : (
        <div className="h-10 w-10 rounded-lg bg-emerald-500/15 grid place-items-center shrink-0">
          <Building2 className="w-4 h-4 text-foreground" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        {/* Titre du poste — 14px font-display */}
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="font-display font-bold text-[14px] text-foreground tracking-tight leading-tight">
            {role}
          </h4>
          {isCurrent && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-success/15 text-success border border-success/30">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Actuel
            </span>
          )}
        </div>

        {/* Entreprise + lieu + période */}
        <p className="text-[12.5px] text-foreground/70 mt-0.5 font-medium">
          {company}
        </p>

        <div className="flex items-center gap-3 mt-1 text-[11.5px] text-muted-foreground flex-wrap">
          {period && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Calendar className="w-3 h-3" />
              {period}
              {tenure && <span className="opacity-70">· {tenure}</span>}
            </span>
          )}
          {exp.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {exp.location}
            </span>
          )}
        </div>

        {/* Description du poste — affichée si présente, line-clamp 4 */}
        {exp.description && (
          <p className="text-[12px] leading-relaxed text-foreground/75 mt-2 whitespace-pre-line line-clamp-4">
            {exp.description}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Education list (rich) ─────────────────────────────────────────

interface RawEducation {
  school?: string | { name?: string; logo?: string };
  school_name?: string;
  school_logo?: string;
  school_details?: { name?: string; logo?: string; logo_url?: string; image?: string };
  logo_url?: string;
  logo?: string;
  degree?: string;
  degree_name?: string;
  field_of_study?: string;
  field?: string;
  description?: string;
  start?: { year?: number };
  end?: { year?: number };
}

function EducationList({ education }: { education: RawEducation[] }) {
  // Tri par année de début descendante
  const sorted = [...education].sort((a, b) => (b.start?.year ?? 0) - (a.start?.year ?? 0));
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? sorted : sorted.slice(0, 2);
  const hidden = sorted.length - visible.length;

  return (
    <div className="space-y-4">
      {visible.map((edu, i) => (
        <EducationItem key={i} edu={edu} />
      ))}
      {hidden > 0 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full inline-flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-foreground/30 py-2 rounded-lg transition-colors"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          Voir {hidden} formation{hidden > 1 ? 's' : ''} de plus
        </button>
      )}
      {showAll && sorted.length > 2 && (
        <button
          onClick={() => setShowAll(false)}
          className="w-full inline-flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground py-1.5 transition-colors"
        >
          <ChevronUp className="w-3.5 h-3.5" />
          Réduire
        </button>
      )}
    </div>
  );
}

function EducationItem({ edu }: { edu: RawEducation }) {
  const schoolName =
    typeof edu.school === 'string'
      ? edu.school
      : edu.school?.name || edu.school_name || edu.school_details?.name || 'École';
  const logo =
    edu.school_logo || edu.logo_url || edu.logo ||
    edu.school_details?.logo || edu.school_details?.logo_url || edu.school_details?.image ||
    (typeof edu.school === 'object' ? edu.school?.logo : undefined);

  const degree = edu.degree || edu.degree_name;
  const field = edu.field_of_study || edu.field;
  const startYear = edu.start?.year;
  const endYear = edu.end?.year;

  return (
    <div className="flex items-start gap-3.5">
      {/* Logo école — 40px */}
      {logo ? (
        <img
          src={logo}
          alt=""
          className="w-10 h-10 rounded-lg object-contain bg-card border border-border shrink-0"
        />
      ) : (
        <div className="h-10 w-10 rounded-lg bg-emerald-500/15 grid place-items-center shrink-0">
          <GraduationCap className="w-4 h-4 text-foreground" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <h4 className="font-display font-bold text-[14px] text-foreground tracking-tight leading-tight">
          {schoolName}
        </h4>
        {(degree || field) && (
          <p className="text-[12.5px] text-foreground/70 mt-0.5 font-medium">
            {[degree, field].filter(Boolean).join(' · ')}
          </p>
        )}
        {(startYear || endYear) && (
          <p className="text-[11.5px] text-muted-foreground mt-1 tabular-nums inline-flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {startYear || '?'} — {endYear || 'en cours'}
          </p>
        )}
        {edu.description && (
          <p className="text-[12px] leading-relaxed text-foreground/75 mt-2 whitespace-pre-line line-clamp-3">
            {edu.description}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function formatPeriod(
  start?: { year?: number; month?: number },
  end?: { year?: number; month?: number },
  isCurrent?: boolean,
): string | null {
  if (!start?.year) return null;
  const monthNames = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
  const startStr = `${start.month ? monthNames[start.month - 1] : ''} ${start.year}`.trim();
  if (isCurrent) {
    return `${startStr} → Aujourd'hui`;
  }
  if (end?.year) {
    const endStr = `${end.month ? monthNames[end.month - 1] : ''} ${end.year}`.trim();
    return `${startStr} → ${endStr}`;
  }
  return startStr;
}

function computeTenure(
  start?: { year?: number; month?: number },
  end?: { year?: number; month?: number },
): string | null {
  if (!start?.year) return null;
  const s = new Date(start.year, (start.month || 1) - 1);
  const e = end?.year ? new Date(end.year, (end.month || 12) - 1) : new Date();
  const diff = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (diff < 1) return null;
  const y = Math.floor(diff / 12);
  const m = diff % 12;
  if (y > 0 && m > 0) return `${y} an${y > 1 ? 's' : ''} ${m} mois`;
  if (y > 0) return `${y} an${y > 1 ? 's' : ''}`;
  if (m > 0) return `${m} mois`;
  return null;
}
