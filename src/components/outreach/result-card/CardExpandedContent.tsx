import React from 'react';
import { LinkedInProfile } from '../types';
import { JobMatchResult } from '../JobScoreDisplay';
import { Job } from '@/pages/JobSpace';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ExternalLink, Briefcase, GraduationCap, Zap,
  MessageSquare, Newspaper, Clock, Target, Star,
  Archive, CheckCircle2, CalendarDays, Building2,
} from 'lucide-react';
import { CardMessageThread } from './CardMessageThread';
import { ProfileData } from './types';

interface CardExpandedContentProps {
  profile: LinkedInProfile;
  profileData: ProfileData;
  selectedJob?: Job | null;
  jobScore?: JobMatchResult;
  accountId?: string;
  candidateStatus?: { status: string; score?: number | null; recommendation?: string | null; updated_at?: string } | null;
  airtableMatch?: any;
  historyData?: any;
  historyLoading?: boolean;
  onClose: () => void;
  onOpenMessage: () => void;
  onMessageSent?: () => void;
  onProfileTreated?: () => void;
}

const getTenureLabel = (start?: { year?: number; month?: number }, end?: { year?: number; month?: number }) => {
  if (!start?.year) return null;
  const s = new Date(start.year, (start.month || 1) - 1);
  const e = end?.year ? new Date(end.year, (end.month || 12) - 1) : new Date();
  const diff = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  const y = Math.floor(diff / 12);
  const m = diff % 12;
  if (y > 0 && m > 0) return `${y} an${y > 1 ? 's' : ''} ${m} mois`;
  if (y > 0) return `${y} an${y > 1 ? 's' : ''}`;
  if (m > 0) return `${m} mois`;
  return null;
};

export const CardExpandedContent: React.FC<CardExpandedContentProps> = ({
  profile,
  profileData,
  selectedJob,
  jobScore,
  accountId,
  candidateStatus,
  airtableMatch,
  historyData,
  historyLoading,
  onClose,
  onOpenMessage,
  onMessageSent,
  onProfileTreated,
}) => {
  const { education, skills, profileUrl, fullName } = profileData;
  const workExperience = profile.work_experience || [];

  return (
    <div className="space-y-5">
      {/* Candidate Status Banner */}
      {candidateStatus && (
        <div className="p-3 bg-muted/40 rounded-xl border border-border/60">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Statut candidat</span>
          </div>
          <div className="flex items-center flex-wrap gap-2 text-xs">
            {candidateStatus.score != null && candidateStatus.score > 0 && (
              <Badge variant="secondary" className="gap-1 bg-accent/60 text-accent-foreground border-0">
                <Target className="w-3 h-3" />
                Score: {candidateStatus.score}%
                {candidateStatus.recommendation && (
                  <span className={`ml-0.5 font-semibold ${
                    candidateStatus.recommendation === 'go' ? 'text-emerald-600' :
                    candidateStatus.recommendation === 'maybe' ? 'text-amber-600' : 'text-destructive'
                  }`}>
                    ({candidateStatus.recommendation === 'go' ? '✓ Go' : candidateStatus.recommendation === 'maybe' ? '~ Maybe' : '✗ Skip'})
                  </span>
                )}
              </Badge>
            )}
            {(candidateStatus.status === 'messaged' || candidateStatus.status === 'replied') && (
              <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary border-0">
                <MessageSquare className="w-3 h-3" />
                {candidateStatus.status === 'replied' ? 'A répondu' : 'Contacté'}
              </Badge>
            )}
            {candidateStatus.status === 'shortlisted' && (
              <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-700 border-0">
                <Star className="w-3 h-3" />
                Shortlisté
              </Badge>
            )}
            {candidateStatus.status === 'dismissed' && (
              <Badge variant="secondary" className="gap-1 bg-muted text-muted-foreground border-0">
                <Archive className="w-3 h-3" />
                Archivé
              </Badge>
            )}
            {candidateStatus.updated_at && (
              <span className="text-muted-foreground/50 text-[10px] ml-auto">
                {new Date(candidateStatus.updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Airtable History Summary */}
      {airtableMatch && (historyLoading || historyData) && historyData && (
        <div className="p-3 rounded-xl border border-primary/15 bg-primary/5">
          <div className="flex items-center gap-2 text-xs font-medium text-primary">
            <Building2 className="w-3.5 h-3.5" />
            Historique CRM
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-foreground/70">
            {historyData.placements.length > 0 && <span>🏆 {historyData.placements.length} placement(s)</span>}
            {historyData.shortlists.length > 0 && <span>⭐ {historyData.shortlists.length} shortlist(s)</span>}
            {historyData.notes.length > 0 && <span>📝 {historyData.notes.length} note(s)</span>}
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="experience" className="w-full">
        <TabsList className="w-full h-11 bg-muted/50 p-1 rounded-xl gap-0.5">
          <TabsTrigger value="experience" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm gap-1.5 rounded-lg py-2">
            <Briefcase className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Expérience</span>
            <span className="sm:hidden">Exp.</span>
          </TabsTrigger>
          <TabsTrigger value="education" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm gap-1.5 rounded-lg py-2">
            <GraduationCap className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Formation</span>
            <span className="sm:hidden">Form.</span>
          </TabsTrigger>
          <TabsTrigger value="skills" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm gap-1.5 rounded-lg py-2">
            <Zap className="w-3.5 h-3.5" />
            Skills
          </TabsTrigger>
          <TabsTrigger value="messages" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm gap-1.5 rounded-lg py-2">
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Messages</span>
            <span className="sm:hidden">Msg</span>
          </TabsTrigger>
          <TabsTrigger value="posts" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm gap-1.5 rounded-lg py-2">
            <Newspaper className="w-3.5 h-3.5" />
            Posts
          </TabsTrigger>
        </TabsList>

        {/* Experience Tab */}
        <TabsContent value="experience" className="mt-5">
          {workExperience.length > 0 ? (
            <div className="space-y-3">
              {workExperience.map((exp: any, index: number) => {
                const isCurrent = !exp.end;
                const tenure = getTenureLabel(exp.start, exp.end);
                return (
                  <div
                    key={index}
                    className={`relative p-4 rounded-xl border transition-colors ${
                      isCurrent
                        ? 'bg-primary/[0.03] border-primary/20 shadow-sm'
                        : 'bg-background border-border/60 hover:border-border'
                    }`}
                  >
                    {isCurrent && (
                      <div className="absolute top-3 right-3">
                        <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 border-0 px-2 py-0.5 font-semibold">
                          En poste
                        </Badge>
                      </div>
                    )}
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        isCurrent ? 'bg-primary/10' : 'bg-muted/60'
                      }`}>
                        <Briefcase className={`w-4 h-4 ${isCurrent ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground text-sm leading-tight">{exp.role}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">{exp.company}</p>
                        {(exp.start?.year || exp.end?.year) && (
                          <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground/60">
                            <CalendarDays className="w-3 h-3" />
                            <span>
                              {exp.start?.year || '?'} → {exp.end?.year || 'Présent'}
                            </span>
                            {tenure && (
                              <span className="text-muted-foreground/40">• {tenure}</span>
                            )}
                          </div>
                        )}
                        {exp.description && (
                          <p className="text-xs text-muted-foreground/70 mt-2.5 leading-relaxed line-clamp-3">
                            {exp.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Aucune expérience disponible</p>
            </div>
          )}
        </TabsContent>

        {/* Education Tab */}
        <TabsContent value="education" className="mt-5">
          {education.length > 0 ? (
            <div className="space-y-3">
              {education.map((edu: any, index: number) => (
                <div
                  key={index}
                  className="p-4 rounded-xl border border-border/60 bg-background hover:border-border transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 w-9 h-9 rounded-lg bg-amber-100/60 flex items-center justify-center shrink-0">
                      <GraduationCap className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground text-sm">{edu.school}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {edu.degree}
                        {edu.field_of_study && ` · ${edu.field_of_study}`}
                      </p>
                      {(edu.start?.year || edu.end?.year) && (
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground/60">
                          <CalendarDays className="w-3 h-3" />
                          <span>
                            {edu.start?.year || '?'}
                            {edu.end?.year && ` → ${edu.end.year}`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <GraduationCap className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Aucune formation disponible</p>
            </div>
          )}
        </TabsContent>

        {/* Skills Tab */}
        <TabsContent value="skills" className="mt-5">
          {skills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {skills.map((skill: any, index: number) => (
                <Badge
                  key={index}
                  variant="outline"
                  className="text-xs px-3 py-1.5 bg-background text-foreground/80 border-border/80 font-medium hover:bg-muted/50 transition-colors"
                >
                  {skill.name || skill}
                  {skill.endorsement_count && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">
                      +{skill.endorsement_count}
                    </span>
                  )}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Zap className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Aucune compétence disponible</p>
            </div>
          )}
        </TabsContent>

        {/* Messages Tab */}
        <TabsContent value="messages" className="mt-5">
          <CardMessageThread
            accountId={accountId}
            profileId={profile.id}
            profileName={fullName}
            onMessageSent={onMessageSent}
            onProfileTreated={onProfileTreated}
          />
        </TabsContent>

        {/* Posts Tab */}
        <TabsContent value="posts" className="mt-5">
          <div className="text-center py-12 text-muted-foreground bg-muted/20 rounded-xl border border-border/40">
            <Newspaper className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium mb-1">Publications LinkedIn</p>
            <p className="text-xs text-muted-foreground mb-4">
              Consultez les dernières publications de ce candidat
            </p>
            <Button
              variant="outline"
              size="sm"
              className="text-primary border-primary/20 hover:bg-primary/5"
            >
              <Newspaper className="w-4 h-4 mr-2" />
              Voir les posts
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* Quick actions footer */}
      <div className="flex gap-2 pt-4 border-t border-border/50">
        {profileUrl && (
          <Button variant="outline" size="sm" asChild className="flex-1 h-10 rounded-lg">
            <a href={profileUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Profil complet
            </a>
          </Button>
        )}
        {jobScore?.recommendation === 'skip' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" disabled className="flex-1 h-10 rounded-lg bg-muted text-muted-foreground cursor-not-allowed">
                <MessageSquare className="w-4 h-4 mr-2" />
                Envoyer un message
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Profil peu adapté (score &lt; 40%) — envoi désactivé</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button
            size="sm"
            className="flex-1 h-10 rounded-lg"
            onClick={onOpenMessage}
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Envoyer un message
          </Button>
        )}
      </div>
    </div>
  );
};
