/**
 * OverviewTab — vue d'ensemble synthétique d'un candidat.
 *
 * Premier onglet par défaut quand on ouvre la modale. Objectif : montrer
 * en 1 coup d'œil tout le contexte essentiel sans cliquer dans les autres
 * onglets. Layout en grille de cartes, type "dashboard" recruteur.
 *
 * Sections :
 *   1. Score Hero  — score IA visualisé en ring + recommandation + résumé
 *   2. Stats grid  — 4 cards : Engagement / CV / Séquences / Rappels
 *   3. About       — résumé LinkedIn (si dispo)
 *   4. Skills      — chips top compétences
 *   5. Experience  — 2 dernières positions (preview)
 *   6. Education   — école principale
 *   7. Notes       — 2 dernières notes en preview
 *
 * Note : chaque card peut potentiellement déclencher une nav vers son
 * onglet dédié (TODO : exposer un setActiveTab depuis Tabs Radix). Pour
 * l'instant, l'user voit un aperçu et clique manuellement le bon onglet.
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Target, Phone, FileText, GitBranch, Bell, Briefcase, GraduationCap,
  Sparkles, Building2, MapPin, TrendingUp, Calendar, MessageCircle,
  StickyNote, Languages, Award, Clock,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ATSCandidate } from '@/hooks/useATSData';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { CandidateFullProfile } from '@/hooks/useCandidateFullProfile';
import { listCVs, CandidateCV } from '@/lib/cvStorage';
import { cn } from '@/lib/utils';

interface Note {
  id: string;
  content: string;
  created_at: string;
  created_by: string;
}

interface Reminder {
  id: string;
  title: string;
  description: string | null;
  due_at: string;
  completed_at: string | null;
}

interface Props {
  candidate: ATSCandidate;
  enrichedProfile: EnrichedProfile | null;
  fullProfile: CandidateFullProfile;
  notes: Note[];
  reminders: Reminder[];
  organizationId: string | null;
}

export const OverviewTab: React.FC<Props> = ({
  candidate, enrichedProfile, fullProfile, notes, reminders, organizationId,
}) => {
  // Fetch CV count en background (pas critique, fail silently)
  const [cvs, setCvs] = useState<CandidateCV[]>([]);
  const [cvLoading, setCvLoading] = useState(false);
  useEffect(() => {
    if (!organizationId) return;
    setCvLoading(true);
    listCVs(candidate.candidateId, organizationId)
      .then(setCvs)
      .catch(err => console.warn('[OverviewTab] CV count fetch failed:', err))
      .finally(() => setCvLoading(false));
  }, [candidate.candidateId, organizationId]);

  // Compute stats
  const activeSequences = fullProfile.sequenceEnrollments.filter(e => e.status === 'active');
  const repliedSequences = fullProfile.sequenceEnrollments.filter(e => e.status === 'replied');
  const aircallStats = (() => {
    const calls = fullProfile.aircallCalls || [];
    const totalDuration = calls.reduce((sum, c) => sum + (c.duration || 0), 0);
    const lastCall = calls[0]; // déjà trié desc
    return {
      count: calls.length,
      totalMin: Math.floor(totalDuration / 60),
      lastDate: lastCall?.startedAt || null,
    };
  })();
  const upcomingReminders = reminders
    .filter(r => !r.completed_at && new Date(r.due_at) > new Date())
    .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
  const nextReminder = upcomingReminders[0] || null;

  const primaryCV = cvs.find(c => c.isPrimary) || cvs[0] || null;

  const summary = enrichedProfile?.summary || (candidate.linkedinProfileData as any)?.summary;
  const skills = enrichedProfile?.skills || [];
  const languages = enrichedProfile?.languages || [];
  const recentExp = enrichedProfile?.experiences?.slice(0, 2) || [];
  const topEducation = enrichedProfile?.education?.[0] || null;

  // Score breakdown du dernier scoring si dispo
  const latestScoring = fullProfile.scoringHistory[0];
  const strengths = latestScoring?.scoringDetails?.strengths || [];
  const concerns = latestScoring?.scoringDetails?.concerns || [];
  const summaryFromAI = latestScoring?.scoringDetails?.summary;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* ═══ 1. SCORE HERO (si score dispo) ═══ */}
      {candidate.score != null && candidate.score > 0 && (
        <ScoreHero
          score={candidate.score}
          recommendation={candidate.recommendation}
          summary={summaryFromAI}
          strengths={strengths}
          concerns={concerns}
        />
      )}

      {/* ═══ 2. STATS GRID — 4 cards en 2x2 (sm) ou 4-col (lg) ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <StatCard
          icon={Phone}
          label="Engagement"
          tone="info"
          primary={aircallStats.count > 0 ? `${aircallStats.count} appel${aircallStats.count > 1 ? 's' : ''}` : 'Aucun appel'}
          secondary={
            aircallStats.count > 0
              ? `${aircallStats.totalMin} min · dernier ${aircallStats.lastDate ? formatDistanceToNow(new Date(aircallStats.lastDate), { addSuffix: true, locale: fr }) : ''}`
              : 'Pas encore contacté par téléphone'
          }
        />
        <StatCard
          icon={FileText}
          label="CV / Documents"
          tone="brand"
          primary={
            cvLoading ? '…' :
            cvs.length === 0 ? 'Aucun CV' :
            cvs.length === 1 ? '1 CV' : `${cvs.length} versions`
          }
          secondary={
            primaryCV
              ? `${primaryCV.fileName.length > 24 ? primaryCV.fileName.slice(0, 24) + '…' : primaryCV.fileName} · ${formatDistanceToNow(new Date(primaryCV.uploadedAt), { addSuffix: true, locale: fr })}`
              : 'Drop un PDF dans l\'onglet CV'
          }
          highlight={cvs.length === 0}
        />
        <StatCard
          icon={GitBranch}
          label="Séquences"
          tone="success"
          primary={
            activeSequences.length === 0 && repliedSequences.length === 0
              ? 'Aucune'
              : activeSequences.length > 0
                ? `${activeSequences.length} active${activeSequences.length > 1 ? 's' : ''}`
                : `${repliedSequences.length} terminée${repliedSequences.length > 1 ? 's' : ''}`
          }
          secondary={(() => {
            if (activeSequences.length === 0 && repliedSequences.length === 0) return 'Pas dans une séquence';
            const parts: string[] = [];
            if (activeSequences.length > 0) parts.push(`${activeSequences.length} en cours`);
            if (repliedSequences.length > 0) parts.push(`${repliedSequences.length} répondu`);
            return parts.join(' · ');
          })()}
        />
        <StatCard
          icon={Bell}
          label="Prochain rappel"
          tone={nextReminder ? 'warning' : 'muted'}
          primary={
            nextReminder
              ? formatDistanceToNow(new Date(nextReminder.due_at), { addSuffix: true, locale: fr })
              : `${reminders.length} rappel${reminders.length > 1 ? 's' : ''}`
          }
          secondary={
            nextReminder
              ? nextReminder.title
              : reminders.length === 0
                ? 'Aucun rappel programmé'
                : 'Tout est traité'
          }
        />
      </div>

      {/* ═══ 3. ABOUT ═══ */}
      {summary && (
        <SectionCard
          icon={Sparkles}
          title="À propos"
          eyebrow="Résumé LinkedIn"
        >
          <p className="text-[12.5px] leading-relaxed text-foreground/85 whitespace-pre-line line-clamp-6">
            {summary}
          </p>
        </SectionCard>
      )}

      {/* ═══ 4. EXPÉRIENCE RÉCENTE (2 dernières) ═══ */}
      {recentExp.length > 0 && (
        <SectionCard
          icon={Briefcase}
          title="Expérience récente"
          eyebrow={`${enrichedProfile?.experiences?.length || 0} positions`}
        >
          <div className="space-y-2.5">
            {recentExp.map((exp, i) => (
              <ExperienceRow
                key={i}
                title={exp.title}
                company={exp.company}
                logo={exp.logo}
                startDate={exp.startDate}
                endDate={exp.endDate}
                isCurrent={exp.isCurrent}
              />
            ))}
            {(enrichedProfile?.experiences?.length || 0) > 2 && (
              <p className="text-[11px] text-muted-foreground/70 italic pl-9">
                +{(enrichedProfile?.experiences?.length || 0) - 2} autres positions — voir l'onglet Expérience
              </p>
            )}
          </div>
        </SectionCard>
      )}

      {/* ═══ 5. EDUCATION ═══ */}
      {topEducation?.school && (
        <SectionCard
          icon={GraduationCap}
          title="Formation"
          eyebrow={`${enrichedProfile?.education?.length || 0} écoles`}
        >
          <div className="flex items-start gap-2.5">
            {topEducation.logo ? (
              <img
                src={topEducation.logo}
                alt=""
                className="w-9 h-9 rounded-lg object-contain bg-card border border-border shrink-0"
              />
            ) : (
              <div className="h-9 w-9 rounded-lg bg-foreground/[0.06] grid place-items-center shrink-0">
                <GraduationCap className="w-4 h-4 text-foreground/60" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-foreground truncate">{topEducation.school}</p>
              {(topEducation.degree || topEducation.field) && (
                <p className="text-[11.5px] text-muted-foreground truncate">
                  {[topEducation.degree, topEducation.field].filter(Boolean).join(' · ')}
                </p>
              )}
              {(topEducation.startYear || topEducation.endYear) && (
                <p className="text-[10.5px] text-muted-foreground/70 tabular-nums mt-0.5">
                  {topEducation.startYear || '?'} — {topEducation.endYear || 'en cours'}
                </p>
              )}
            </div>
          </div>
        </SectionCard>
      )}

      {/* ═══ 6. SKILLS + LANGUAGES ═══ */}
      {(skills.length > 0 || languages.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
          {skills.length > 0 && (
            <SectionCard
              icon={Award}
              title="Compétences"
              eyebrow={`${skills.length} skills`}
            >
              <div className="flex flex-wrap gap-1.5">
                {skills.slice(0, 12).map((skill, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-foreground/[0.06] text-foreground/85 border border-border"
                  >
                    {skill}
                  </span>
                ))}
                {skills.length > 12 && (
                  <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full text-muted-foreground border border-border bg-muted/30">
                    +{skills.length - 12}
                  </span>
                )}
              </div>
            </SectionCard>
          )}
          {languages.length > 0 && (
            <SectionCard
              icon={Languages}
              title="Langues"
            >
              <div className="flex flex-wrap gap-1.5">
                {languages.map((lang, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-info/10 text-info border border-info/30"
                  >
                    {lang}
                  </span>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {/* ═══ 7. NOTES PREVIEW (2 dernières) ═══ */}
      {notes.length > 0 && (
        <SectionCard
          icon={StickyNote}
          title="Dernières notes"
          eyebrow={`${notes.length} note${notes.length > 1 ? 's' : ''} · voir tout dans Notes`}
        >
          <div className="space-y-2">
            {notes.slice(0, 2).map(note => (
              <div
                key={note.id}
                className="rounded-lg bg-muted/20 border border-border/60 px-3 py-2"
              >
                <p className="text-[12px] leading-relaxed text-foreground/85 line-clamp-3">
                  {note.content}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(note.created_at), { addSuffix: true, locale: fr })}
                </p>
              </div>
            ))}
            {notes.length > 2 && (
              <p className="text-[11px] text-muted-foreground/70 italic">
                +{notes.length - 2} autre{notes.length - 2 > 1 ? 's' : ''} note{notes.length - 2 > 1 ? 's' : ''}
              </p>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════

function ScoreHero({
  score, recommendation, summary, strengths, concerns,
}: {
  score: number;
  recommendation: string | null;
  summary?: string;
  strengths?: string[];
  concerns?: string[];
}) {
  const tone = score >= 70 ? 'success' : score >= 50 ? 'warning' : 'destructive';
  const colors = {
    success: { ring: 'hsl(142 76% 36%)', text: 'hsl(142 76% 36%)', bg: 'hsl(142 76% 36% / 0.08)', border: 'hsl(142 76% 36% / 0.3)' },
    warning: { ring: 'hsl(38 92% 50%)', text: 'hsl(38 92% 50%)', bg: 'hsl(38 92% 50% / 0.08)', border: 'hsl(38 92% 50% / 0.3)' },
    destructive: { ring: 'hsl(0 84% 60%)', text: 'hsl(0 84% 60%)', bg: 'hsl(0 84% 60% / 0.08)', border: 'hsl(0 84% 60% / 0.3)' },
  }[tone];

  const recoLabel =
    recommendation === 'shortlist' ? 'Recommandé' :
    recommendation === 'skip' ? 'Non recommandé' :
    recommendation === 'maybe' ? 'À évaluer' :
    null;

  // Score ring viz (~72px)
  const size = 72;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (Math.min(score, 100) / 100) * circumference;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border p-4 sm:p-5"
      style={{ background: colors.bg, borderColor: colors.border }}
    >
      <div className="flex items-start gap-4">
        {/* Score ring */}
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle cx={size / 2} cy={size / 2} r={radius} stroke="hsl(var(--border))" strokeWidth={stroke} fill="none" />
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={colors.ring}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              style={{ strokeDasharray: circumference }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <span className="font-display font-bold text-[18px] tabular-nums" style={{ color: colors.text }}>
              {score}
            </span>
          </div>
        </div>

        {/* Texte côté droit */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
              Score IA · sur 100
            </span>
            {recoLabel && (
              <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider"
                style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
              >
                <Target className="w-2.5 h-2.5" />
                {recoLabel}
              </span>
            )}
          </div>
          <h3 className="font-display font-bold text-[15px] sm:text-[16px] tracking-tight mt-0.5" style={{ color: colors.text }}>
            {score >= 70 ? 'Bon profil pour ce poste' :
             score >= 50 ? 'Profil à examiner plus en détail' :
             'Profil peu adapté'}
          </h3>
          {summary && (
            <p className="text-[12.5px] leading-relaxed text-foreground/85 mt-1.5 line-clamp-3">
              {summary}
            </p>
          )}
        </div>
      </div>

      {/* Strengths + concerns */}
      {(strengths.length > 0 || concerns.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pt-3 border-t" style={{ borderColor: colors.border }}>
          {strengths.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-success mb-1">
                ✓ Points forts
              </p>
              <ul className="space-y-0.5">
                {strengths.slice(0, 3).map((s, i) => (
                  <li key={i} className="text-[11.5px] text-foreground/80 leading-snug pl-1">• {s}</li>
                ))}
              </ul>
            </div>
          )}
          {concerns.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-warning mb-1">
                ⚠ Points d'attention
              </p>
              <ul className="space-y-0.5">
                {concerns.slice(0, 3).map((s, i) => (
                  <li key={i} className="text-[11.5px] text-foreground/80 leading-snug pl-1">• {s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function StatCard({
  icon: Icon, label, primary, secondary, tone, highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: string;
  secondary?: string;
  tone: 'info' | 'success' | 'warning' | 'brand' | 'muted';
  highlight?: boolean;
}) {
  const toneStyles = {
    info: { iconBg: 'bg-info/10', iconText: 'text-info' },
    success: { iconBg: 'bg-success/10', iconText: 'text-success' },
    warning: { iconBg: 'bg-warning/10', iconText: 'text-warning' },
    brand: { iconBg: 'bg-brand-purple/10', iconText: 'text-brand-purple' },
    muted: { iconBg: 'bg-foreground/[0.06]', iconText: 'text-foreground/60' },
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'rounded-xl border p-3 transition-all',
        highlight
          ? 'border-dashed border-foreground/30 bg-muted/10 hover:bg-muted/20'
          : 'border-border bg-card hover:bg-muted/20',
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className={cn('h-7 w-7 rounded-lg grid place-items-center shrink-0', toneStyles.iconBg)}>
          <Icon className={cn('w-3.5 h-3.5', toneStyles.iconText)} />
        </div>
        <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground truncate">
          {label}
        </span>
      </div>
      <p className="font-display text-[15px] font-bold text-foreground tracking-tight leading-tight tabular-nums">
        {primary}
      </p>
      {secondary && (
        <p className="text-[10.5px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
          {secondary}
        </p>
      )}
    </motion.div>
  );
}

function SectionCard({
  icon: Icon, title, eyebrow, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="h-7 w-7 rounded-lg bg-foreground/[0.06] grid place-items-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-[13px] tracking-tight text-foreground">
            {title}
          </h3>
          {eyebrow && (
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/70">
              {eyebrow}
            </p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function ExperienceRow({
  title, company, logo, startDate, endDate, isCurrent,
}: {
  title: string;
  company: string;
  logo?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      {logo ? (
        <img
          src={logo}
          alt=""
          className="w-8 h-8 rounded-lg object-contain bg-card border border-border shrink-0"
        />
      ) : (
        <div className="h-8 w-8 rounded-lg bg-foreground/[0.06] grid place-items-center shrink-0">
          <Building2 className="w-3.5 h-3.5 text-foreground/60" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-foreground truncate leading-tight">
          {title || 'Poste'}
        </p>
        <p className="text-[11.5px] text-muted-foreground truncate">
          {company || '—'}
        </p>
        <p className="text-[10.5px] text-muted-foreground/70 tabular-nums mt-0.5">
          {startDate || '?'} — {isCurrent ? 'Actuel' : (endDate || '?')}
        </p>
      </div>
    </div>
  );
}
