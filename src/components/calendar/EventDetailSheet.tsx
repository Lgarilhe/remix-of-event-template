/**
 * EventDetailSheet — slide-in panel droit avec tous les détails d'un event
 * du calendrier + actions (voir candidat, voir mission, copier lien, etc.).
 *
 * Affiché au click sur une EventCard. Le contenu varie selon le type :
 * - qualification : candidat preview + mission + manager + lieu + Calendly badge
 * - inmail : destinataire + sujet + message preview
 * - sequence_step : enrollment + sequence + preview du message
 *
 * Pattern Cal.com / Notion Calendar : panneau riche mais pas overwhelming,
 * actions en haut et en bas pour mobile-friendly.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO, differenceInMinutes } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ExternalLink,
  Copy,
  Briefcase,
  MapPin,
  Clock,
  User as UserIcon,
  Building2,
  StickyNote,
  Mail,
  Zap,
  CheckCircle2,
  Sparkles,
  Video,
  Phone,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { CandidateAvatar } from '@/components/dashboard/CandidateAvatar';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';

interface EventDetailSheetProps {
  event: CalendarEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TYPE_TONES: Record<
  CalendarEvent['type'],
  { label: string; bg: string; iconBg: string; iconColor: string; ring: string }
> = {
  qualification: {
    label: 'Entretien',
    bg: 'bg-violet-500/10',
    iconBg: 'bg-violet-500/15',
    iconColor: 'text-violet-600 dark:text-violet-400',
    ring: 'ring-violet-500/30',
  },
  inmail: {
    label: 'InMail',
    bg: 'bg-info/10',
    iconBg: 'bg-info/15',
    iconColor: 'text-info',
    ring: 'ring-info/30',
  },
  sequence_step: {
    label: 'Séquence',
    bg: 'bg-cyan-500/10',
    iconBg: 'bg-cyan-500/15',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    ring: 'ring-cyan-500/30',
  },
  reminder: {
    label: 'Rappel',
    bg: 'bg-warning/10',
    iconBg: 'bg-warning/15',
    iconColor: 'text-warning',
    ring: 'ring-warning/30',
  },
};

/** Détecte le type de meeting depuis l'URL de location pour afficher l'icône appropriée. */
const getLocationMeta = (
  location: string | null | undefined,
): { icon: React.ReactNode; label: string; href: string | null } => {
  if (!location) return { icon: <MapPin className="w-4 h-4" />, label: 'Lieu non précisé', href: null };
  const lower = location.toLowerCase();
  if (lower.includes('meet.google')) {
    return { icon: <Video className="w-4 h-4" />, label: 'Google Meet', href: location };
  }
  if (lower.includes('zoom.us')) {
    return { icon: <Video className="w-4 h-4" />, label: 'Zoom', href: location };
  }
  if (lower.includes('teams.microsoft') || lower.includes('teams.live')) {
    return { icon: <Video className="w-4 h-4" />, label: 'Microsoft Teams', href: location };
  }
  if (lower.startsWith('http')) {
    return { icon: <ExternalLink className="w-4 h-4" />, label: 'Lien visio', href: location };
  }
  if (lower.includes('téléphone') || lower.includes('phone') || lower.includes('appel')) {
    return { icon: <Phone className="w-4 h-4" />, label: location, href: null };
  }
  return { icon: <MapPin className="w-4 h-4" />, label: location, href: null };
};

const getInitials = (name: string | null | undefined): string => {
  if (!name) return '?';
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
};

export const EventDetailSheet: React.FC<EventDetailSheetProps> = ({
  event,
  open,
  onOpenChange,
}) => {
  const navigate = useNavigate();

  if (!event) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md p-0" />
      </Sheet>
    );
  }

  const tone = TYPE_TONES[event.type];
  const meta = event.meta || {};
  const locationMeta = getLocationMeta(meta.location);

  const startDate = (() => {
    try {
      return parseISO(event.startAt);
    } catch {
      return null;
    }
  })();
  const endDate = event.endAt
    ? (() => {
        try {
          return parseISO(event.endAt);
        } catch {
          return null;
        }
      })()
    : null;
  const durationMin = startDate && endDate ? differenceInMinutes(endDate, startDate) : null;

  const dateLabel = startDate
    ? format(startDate, 'EEEE d MMMM', { locale: fr }).replace(/^./, (c) => c.toUpperCase())
    : '—';
  const timeRangeLabel = startDate
    ? endDate
      ? `${format(startDate, 'HH:mm')} – ${format(endDate, 'HH:mm')}`
      : format(startDate, 'HH:mm')
    : '—';

  const isCalendly = !!meta.calendlyEventId;

  const handleCopyLocation = async () => {
    if (!meta.location) return;
    try {
      await navigator.clipboard.writeText(meta.location);
      toast.success('Lien copié');
    } catch {
      toast.error('Impossible de copier');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 overflow-y-auto flex flex-col">
        {/* Header */}
        <SheetHeader
          className={cn('px-6 pt-6 pb-5 space-y-3 border-b border-border', tone.bg)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'h-9 w-9 rounded-lg flex items-center justify-center shrink-0',
                  tone.iconBg,
                  tone.iconColor,
                )}
              >
                {event.type === 'qualification' ? (
                  <Briefcase className="w-4 h-4" />
                ) : event.type === 'inmail' ? (
                  <Mail className="w-4 h-4" />
                ) : event.type === 'sequence_step' ? (
                  <Zap className="w-4 h-4" />
                ) : (
                  <Clock className="w-4 h-4" />
                )}
              </div>
              <div className="flex flex-col">
                <span className={cn('text-[10px] uppercase tracking-wider font-bold', tone.iconColor)}>
                  {tone.label}
                </span>
                {isCalendly && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground font-medium mt-0.5">
                    <Sparkles className="w-2.5 h-2.5" />
                    Via Calendly
                  </span>
                )}
              </div>
            </div>
          </div>

          <SheetTitle asChild>
            <h2 className="font-display font-bold text-foreground text-xl tracking-tight leading-tight text-left">
              {event.title}
            </h2>
          </SheetTitle>

          <SheetDescription asChild>
            <div className="text-sm text-muted-foreground space-y-1 text-left">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>
                  <span className="font-medium text-foreground">{dateLabel}</span>
                  {' · '}
                  <span className="font-medium text-foreground tabular-nums">{timeRangeLabel}</span>
                  {durationMin && (
                    <span className="text-muted-foreground"> · {durationMin} min</span>
                  )}
                </span>
              </div>
            </div>
          </SheetDescription>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 px-6 py-5 space-y-5">
          {/* Candidate */}
          {meta.candidateName && (
            <Section title="Candidat" icon={<UserIcon className="w-3.5 h-3.5" />}>
              <button
                type="button"
                onClick={() => {
                  if (meta.candidateId) {
                    navigate(`/pipeline?candidate=${meta.candidateId}`);
                    onOpenChange(false);
                  }
                }}
                disabled={!meta.candidateId}
                className="w-full text-left rounded-xl border border-border bg-card p-3 flex items-center gap-3 hover:bg-muted/30 transition-colors group disabled:cursor-default"
              >
                <CandidateAvatar
                  name={meta.candidateName}
                  avatarUrl={meta.candidateAvatarUrl ?? null}
                  size={40}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-display font-semibold text-foreground text-sm truncate tracking-tight">
                    {meta.candidateName}
                  </div>
                  {meta.candidateHeadline && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {meta.candidateHeadline}
                    </div>
                  )}
                </div>
                {meta.candidateId && (
                  <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                )}
              </button>
            </Section>
          )}

          {/* Mission */}
          {(meta.projectName || meta.jobTitle || meta.clientName) && (
            <Section title="Mission" icon={<Briefcase className="w-3.5 h-3.5" />}>
              <button
                type="button"
                onClick={() => {
                  if (meta.projectId) {
                    navigate(`/missions/${meta.projectId}`);
                    onOpenChange(false);
                  }
                }}
                disabled={!meta.projectId}
                className="w-full text-left rounded-xl border border-border bg-card p-3 hover:bg-muted/30 transition-colors group disabled:cursor-default"
              >
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-emerald-500/15 text-foreground flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {meta.projectName && (
                      <div className="font-display font-semibold text-foreground text-sm tracking-tight">
                        {meta.projectName}
                      </div>
                    )}
                    {meta.jobTitle && !meta.projectName && (
                      <div className="font-display font-semibold text-foreground text-sm tracking-tight">
                        {meta.jobTitle}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                      {meta.clientName && (
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {meta.clientName}
                        </span>
                      )}
                      {meta.jobTitle && meta.projectName && (
                        <>
                          <span>·</span>
                          <span>{meta.jobTitle}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {meta.projectId && (
                    <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-2" />
                  )}
                </div>
              </button>
            </Section>
          )}

          {/* Manager */}
          {meta.manager && (
            <Section title="Animé par" icon={<UserIcon className="w-3.5 h-3.5" />}>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                {meta.manager.avatarUrl ? (
                  <img
                    src={meta.manager.avatarUrl}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover ring-1 ring-border shrink-0"
                  />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-emerald-500/15 text-foreground flex items-center justify-center font-display font-bold text-sm shrink-0">
                    {getInitials(meta.manager.displayName)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground truncate">
                    {meta.manager.displayName || 'Manager'}
                  </div>
                  <div className="text-xs text-muted-foreground">Manager</div>
                </div>
              </div>
            </Section>
          )}

          {/* Lieu */}
          {meta.location && (
            <Section title="Lieu" icon={locationMeta.icon}>
              <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-emerald-500/15 text-foreground flex items-center justify-center shrink-0">
                  {locationMeta.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">
                    {locationMeta.label}
                  </div>
                  {locationMeta.href && (
                    <div className="text-xs text-muted-foreground truncate">
                      {meta.location}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {locationMeta.href && (
                    <a
                      href={locationMeta.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                      title="Ouvrir le lien"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  <button
                    onClick={handleCopyLocation}
                    className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    title="Copier"
                    type="button"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Section>
          )}

          {/* Notes */}
          {meta.notes && (
            <Section title="Notes" icon={<StickyNote className="w-3.5 h-3.5" />}>
              <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {meta.notes}
              </div>
            </Section>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-border px-6 py-4 flex items-center gap-2 bg-card sticky bottom-0">
          {locationMeta.href ? (
            <a
              href={locationMeta.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Video className="w-4 h-4" />
              Rejoindre la réunion
            </a>
          ) : (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-full border border-border bg-background hover:bg-accent text-sm font-medium text-foreground transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              OK
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <div>
    <div className="flex items-center gap-1.5 mb-2 px-1">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
        {title}
      </span>
    </div>
    {children}
  </div>
);
