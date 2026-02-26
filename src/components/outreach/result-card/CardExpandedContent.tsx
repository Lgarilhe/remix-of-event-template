import React from 'react';
import { LinkedInProfile } from '../types';
import { JobMatchResult } from '../JobScoreDisplay';
import { Job } from '@/pages/JobSpace';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Briefcase, GraduationCap, Zap,
  MessageSquare, Newspaper, CalendarDays, Building2,
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
  accountId,
  onOpenMessage,
  onMessageSent,
  onProfileTreated,
}) => {
  const { education, skills, fullName } = profileData;
  const workExperience = profile.work_experience || [];

  return (
    <div className="rounded-none sm:rounded-xl border border-border/60 bg-background overflow-hidden">
      <Tabs defaultValue="experience" className="w-full">
        <div className="border-b border-border/50 bg-muted/20 overflow-x-auto">
          <TabsList className="w-max min-w-full h-11 sm:h-12 bg-transparent p-0 rounded-none gap-0">
            {[
              { value: 'experience', icon: Briefcase, label: 'Expérience', shortLabel: 'Exp.' },
              { value: 'education', icon: GraduationCap, label: 'Formation', shortLabel: 'Form.' },
              { value: 'skills', icon: Zap, label: 'Compétences', shortLabel: 'Skills' },
              { value: 'messages', icon: MessageSquare, label: 'Messages', shortLabel: 'Msg' },
              { value: 'posts', icon: Newspaper, label: 'Posts', shortLabel: 'Posts' },
            ].map(tab => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="shrink-0 min-w-[74px] sm:min-w-0 sm:flex-1 text-[11px] sm:text-xs h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none gap-1 sm:gap-1.5 px-1.5 sm:px-2 transition-all"
              >
                <tab.icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Experience Tab */}
        <TabsContent value="experience" className="mt-0 p-2 sm:p-4">
          {workExperience.length > 0 ? (
            <div className="space-y-2 sm:space-y-3">
              {workExperience.map((exp: any, index: number) => {
                const isCurrent = !exp.end;
                const tenure = getTenureLabel(exp.start, exp.end);
                return (
                  <div
                    key={index}
                    className={`relative p-3 sm:p-4 rounded-none sm:rounded-xl border transition-colors ${
                      isCurrent
                        ? 'bg-primary/[0.03] border-primary/20 shadow-sm'
                        : 'bg-background border-border/50 hover:border-border'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 sm:gap-3">
                      {exp.logo ? (
                        <img
                          src={exp.logo}
                          alt={exp.company || ''}
                          className="mt-0.5 w-9 h-9 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl object-contain bg-white border border-border/40 shrink-0 p-0.5"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).classList.remove('hidden'); }}
                        />
                      ) : null}
                      <div className={`mt-0.5 w-9 h-9 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 ${
                        isCurrent ? 'bg-primary/10' : 'bg-muted/60'
                      } ${exp.logo ? 'hidden' : ''}`}>
                        <Briefcase className={`w-4 h-4 ${isCurrent ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-foreground text-sm leading-tight">{exp.role}</p>
                          {isCurrent && (
                            <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 border-0 px-1.5 py-0 font-semibold shrink-0">
                              En poste
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Building2 className="w-3 h-3 shrink-0" />
                          {exp.company}
                        </p>
                        {(exp.start?.year || exp.end?.year) && (
                          <div className="flex items-center gap-2 mt-1 text-[11px] sm:text-xs text-muted-foreground/60">
                            <CalendarDays className="w-3 h-3 shrink-0" />
                            <span>{exp.start?.year || '?'} → {exp.end?.year || 'Présent'}</span>
                            {tenure && <span className="text-muted-foreground/40">• {tenure}</span>}
                          </div>
                        )}
                        {exp.description && (
                          <div className="text-xs text-muted-foreground/70 mt-2 leading-relaxed whitespace-pre-line">{exp.description}</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={Briefcase} text="Aucune expérience disponible" />
          )}
        </TabsContent>

        {/* Education Tab */}
        <TabsContent value="education" className="mt-0 p-2 sm:p-4">
          {education.length > 0 ? (
            <div className="space-y-2 sm:space-y-3">
              {education.map((edu: any, index: number) => {
                const schoolLogo = edu.logo || edu.school_logo || edu.school_details?.logo;
                return (
                <div key={index} className="p-3 sm:p-4 rounded-none sm:rounded-xl border border-border/50 bg-background hover:border-border transition-colors">
                  <div className="flex items-start gap-2.5 sm:gap-3">
                    {schoolLogo ? (
                      <img
                        src={schoolLogo}
                        alt={edu.school || ''}
                        className="mt-0.5 w-9 h-9 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl object-contain bg-white border border-border/40 shrink-0 p-0.5"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).classList.remove('hidden'); }}
                      />
                    ) : null}
                    <div className={`mt-0.5 w-9 h-9 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-amber-100/60 flex items-center justify-center shrink-0 ${schoolLogo ? 'hidden' : ''}`}>
                      <GraduationCap className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground text-sm">{edu.school}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                        {edu.degree}{edu.field_of_study && ` · ${edu.field_of_study}`}
                      </p>
                      {(edu.start?.year || edu.end?.year) && (
                        <div className="flex items-center gap-2 mt-1 text-[11px] sm:text-xs text-muted-foreground/60">
                          <CalendarDays className="w-3 h-3" />
                          <span>{edu.start?.year || '?'}{edu.end?.year && ` → ${edu.end.year}`}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={GraduationCap} text="Aucune formation disponible" />
          )}
        </TabsContent>

        {/* Skills Tab */}
        <TabsContent value="skills" className="mt-0 p-2 sm:p-4">
          {skills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {skills.map((skill: any, index: number) => (
                <Badge
                  key={index}
                  variant="outline"
                  className="text-xs px-3 py-2 bg-background text-foreground/80 border-border/80 font-medium hover:bg-muted/50 transition-colors rounded-lg"
                >
                  {skill.name || skill}
                  {skill.endorsement_count && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">+{skill.endorsement_count}</span>
                  )}
                </Badge>
              ))}
            </div>
          ) : (
            <EmptyState icon={Zap} text="Aucune compétence disponible" />
          )}
        </TabsContent>

        {/* Messages Tab */}
        <TabsContent value="messages" className="mt-0 p-2 sm:p-4">
          <CardMessageThread
            accountId={accountId}
            profileId={profile.id}
            profileName={fullName}
            onMessageSent={onMessageSent}
            onProfileTreated={onProfileTreated}
          />
        </TabsContent>

        {/* Posts Tab */}
        <TabsContent value="posts" className="mt-0 p-2 sm:p-4">
          <div className="text-center py-12 text-muted-foreground">
            <Newspaper className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium mb-1">Publications LinkedIn</p>
            <p className="text-xs text-muted-foreground mb-4">
              Consultez les dernières publications de ce candidat
            </p>
            <Button variant="outline" size="sm" className="text-primary border-primary/20 hover:bg-primary/5 rounded-lg">
              <Newspaper className="w-4 h-4 mr-2" />
              Voir les posts
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const EmptyState: React.FC<{ icon: React.FC<any>; text: string }> = ({ icon: Icon, text }) => (
  <div className="text-center py-12 text-muted-foreground">
    <Icon className="w-10 h-10 mx-auto mb-3 opacity-30" />
    <p className="text-sm font-medium">{text}</p>
  </div>
);
