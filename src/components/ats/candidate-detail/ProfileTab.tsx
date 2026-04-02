import React from 'react';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import { ATSCandidate } from '@/hooks/useATSData';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { ScoringRecord } from '@/hooks/useCandidateFullProfile';
import {
  Mail, Phone, MapPin, Briefcase, Clock, ExternalLink, GraduationCap,
  Languages, Calendar, Award, FileText, Target, Activity
} from 'lucide-react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { EmptyState as EmptyStateUI } from '@/components/ui/EmptyState';
import { Section, BadgeItem, ContactLine, CollapsibleSection, ExperienceItem, EducationItem, CenteredLoader } from './shared';

interface ProfileTabProps {
  candidate: ATSCandidate;
  enrichedProfile: EnrichedProfile | null;
  enrichLoading: boolean;
  fullProfile: {
    loading: boolean;
    qualificationSessions: Array<{
      id: string;
      verdict: string | null;
      verdictNotes: string | null;
      jobTitle: string | null;
      eventStartAt: string | null;
    }>;
    airtableMatch: {
      status: string | null;
      experience: string | null;
    } | null;
    airtableShortlists: Array<{
      id: string;
      jobTitle?: string;
      companyName?: string;
      status: string;
      dateAdded: string;
    }>;
  };
}

export const ProfileTab = React.memo<ProfileTabProps>(({ candidate, enrichedProfile, enrichLoading, fullProfile }) => {
  if (enrichLoading) return <CenteredLoader />;

  return (
    <div className="space-y-4">
      {/* Summary */}
      {enrichedProfile?.summary && (
        <Section title="À propos">
          <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{enrichedProfile.summary}</p>
        </Section>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {enrichedProfile?.location && (
          <div className="p-3 border border-border">
            <MapPin className="w-4 h-4 text-muted-foreground mb-1" />
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Localisation</p>
            <p className="text-sm font-medium text-foreground mt-0.5">{enrichedProfile.location}</p>
          </div>
        )}
        {enrichedProfile?.yearsOfExperience && (
          <div className="p-3 border border-border">
            <Briefcase className="w-4 h-4 text-muted-foreground mb-1" />
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Expérience</p>
            <p className="text-sm font-medium text-foreground mt-0.5">~{enrichedProfile.yearsOfExperience} ans</p>
          </div>
        )}
        {enrichedProfile?.currentCompany && (
          <div className="p-3 border border-border">
            <Target className="w-4 h-4 text-muted-foreground mb-1" />
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Entreprise</p>
            <p className="text-sm font-medium text-foreground mt-0.5 truncate">{enrichedProfile.currentCompany}</p>
          </div>
        )}
        {enrichedProfile?.currentRole && (
          <div className="p-3 border border-border">
            <Activity className="w-4 h-4 text-muted-foreground mb-1" />
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Poste</p>
            <p className="text-sm font-medium text-foreground mt-0.5 truncate">{enrichedProfile.currentRole}</p>
          </div>
        )}
      </div>

      {/* Experiences */}
      {enrichedProfile?.experiences && enrichedProfile.experiences.length > 0 && (
        <Section title="Expériences">
          <div className="relative pl-3 space-y-0">
            <div className="absolute left-[5px] top-2 bottom-2 w-px bg-foreground/15" />
            {enrichedProfile.experiences.map((exp, i) => (
              <ExperienceItem key={i} exp={exp} />
            ))}
          </div>
        </Section>
      )}

      {/* Education */}
      {enrichedProfile?.education && enrichedProfile.education.length > 0 && (
        <Section title="Formation">
          <div className="relative pl-3 space-y-0">
            <div className="absolute left-[5px] top-2 bottom-2 w-px bg-foreground/15" />
            {enrichedProfile.education.map((edu, i) => (
              <EducationItem key={i} edu={edu} />
            ))}
          </div>
        </Section>
      )}

      {/* Skills */}
      {enrichedProfile?.skills && enrichedProfile.skills.length > 0 && (
        <Section title="Compétences">
          <div className="flex flex-wrap gap-1.5">
            {enrichedProfile.skills.map(s => (
              <span key={s} className="text-xs px-2 py-0.5 border border-border text-foreground font-medium uppercase tracking-wider">{s}</span>
            ))}
          </div>
        </Section>
      )}

      {/* Languages */}
      {enrichedProfile?.languages && enrichedProfile.languages.length > 0 && (
        <Section title="Langues">
          <div className="flex flex-wrap gap-2">
            {enrichedProfile.languages.map(l => (
              <span key={l} className="flex items-center gap-1 text-sm text-foreground">
                <Languages className="w-4 h-4 text-muted-foreground" /> {l}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Qualification sessions */}
      {fullProfile.qualificationSessions.length > 0 && (
        <Section title="Qualifications">
          <div className="space-y-3">
            {fullProfile.qualificationSessions.map(qs => (
              <div key={qs.id} className="flex items-start gap-3">
                <div className={cn("h-8 w-8 flex items-center justify-center border shrink-0 text-xs font-bold",
                  qs.verdict === 'go' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' :
                  qs.verdict === 'no_go' ? 'border-destructive/40 bg-destructive/5 text-destructive' :
                  qs.verdict === 'maybe' ? 'border-amber-400 bg-amber-50 text-amber-700' :
                  'border-border bg-foreground/5 text-muted-foreground'
                )}>
                  {qs.verdict === 'go' ? '✓' : qs.verdict === 'no_go' ? '✗' : qs.verdict === 'maybe' ? '?' : '📅'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {qs.verdict === 'go' ? 'Go' : qs.verdict === 'no_go' ? 'No-Go' : qs.verdict === 'maybe' ? 'Maybe' : 'Planifié'}
                    </span>
                    {qs.jobTitle && <span className="text-xs text-muted-foreground">• {qs.jobTitle}</span>}
                  </div>
                  {qs.eventStartAt && (
                    <span className="text-xs text-muted-foreground">
                      {format(parseISO(qs.eventStartAt), 'd MMM yyyy à HH:mm', { locale: fr })}
                    </span>
                  )}
                  {qs.verdictNotes && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{qs.verdictNotes}</p>
                  )}
                  <a href={`/qualification/${qs.id}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-foreground underline underline-offset-2 hover:text-brutal-accent flex items-center gap-1 mt-1">
                    <ExternalLink className="w-3 h-3" /> Voir la scorecard
                  </a>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Airtable CRM */}
      {fullProfile.airtableMatch && (
        <Section title="Historique CRM">
          <div className="space-y-2 text-sm">
            {fullProfile.airtableMatch.status && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Statut Airtable</span>
                <BadgeItem>{fullProfile.airtableMatch.status}</BadgeItem>
              </div>
            )}
            {fullProfile.airtableMatch.experience && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Expérience</span>
                <span className="text-foreground font-medium">{fullProfile.airtableMatch.experience}</span>
              </div>
            )}
            {fullProfile.airtableShortlists.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border">
                <span className="text-xs font-bold uppercase tracking-wider text-foreground mb-2 block">
                  Shortlists précédentes ({fullProfile.airtableShortlists.length})
                </span>
                <div className="space-y-1.5">
                  {fullProfile.airtableShortlists.slice(0, 5).map(s => (
                    <div key={s.id} className="flex items-center justify-between text-xs">
                      <span className="text-foreground">{s.jobTitle || s.companyName || 'Shortlist'}</span>
                      <div className="flex items-center gap-2">
                        {s.status && <BadgeItem>{s.status}</BadgeItem>}
                        {s.dateAdded && <span className="text-muted-foreground">{s.dateAdded}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Contact */}
      {(candidate.email || candidate.phone || candidate.linkedin) && (
        <Section title="Contact">
          <div className="space-y-2 text-sm">
            {candidate.email && <ContactLine icon={<Mail className="w-4 h-4" />}>{candidate.email}</ContactLine>}
            {candidate.phone && <ContactLine icon={<Phone className="w-4 h-4" />}>{candidate.phone}</ContactLine>}
            {candidate.linkedin && (
              <ContactLine icon={<img src={linkedinLogo} alt="LinkedIn" className="w-4 h-4 object-contain" />}>
                <a href={candidate.linkedin} target="_blank" rel="noopener noreferrer"
                  className="text-foreground hover:text-brutal-accent underline underline-offset-2">Voir le profil</a>
              </ContactLine>
            )}
          </div>
        </Section>
      )}

      {/* History */}
      <Section title="Historique">
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Créé le</span>
            <span className="text-foreground font-medium">{format(parseISO(candidate.createdAt), 'd MMMM yyyy', { locale: fr })}</span>
          </div>
          {candidate.lastActivity && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Dernière activité</span>
              <span className="text-foreground font-medium">{format(parseISO(candidate.lastActivity), 'd MMMM yyyy', { locale: fr })}</span>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
});

ProfileTab.displayName = 'ProfileTab';
