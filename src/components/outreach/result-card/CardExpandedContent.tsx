import React, { useState } from 'react';
import { LinkedInProfile } from '../types';
import { JobMatchResult } from '../JobScoreDisplay';
import { Job } from '@/types/jobs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Briefcase, GraduationCap, Zap, ThumbsUp,
  MessageSquare, Newspaper, CalendarDays, Building2, Loader2,
} from 'lucide-react';
import { CardMessageThread } from './CardMessageThread';
import { ProfileData } from './types';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { toast } from 'sonner';

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
    <div className="border border-border bg-background overflow-hidden">
      <Tabs defaultValue="experience" className="w-full">
        <div className="border-b border-border bg-foreground overflow-x-auto">
          <TabsList className="w-max min-w-full h-10 sm:h-11 bg-transparent p-0 rounded-none gap-0">
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
                className="shrink-0 min-w-[74px] sm:min-w-0 sm:flex-1 text-xs sm:text-xs h-full rounded-none border-b-2 border-transparent text-background/60 hover:text-background data-[state=active]:border-accent data-[state=active]:bg-accent data-[state=active]:text-foreground data-[state=active]:shadow-none gap-1 sm:gap-1.5 px-1.5 sm:px-2 transition-all uppercase tracking-wider font-semibold"
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
                    className={`relative p-3 sm:p-4 border transition-colors ${
                      isCurrent
                        ? 'bg-accent/5 border-border'
                        : 'bg-background border-border hover:border-border'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 sm:gap-3">
                      {exp.logo ? (
                        <img
                          src={exp.logo}
                          alt={exp.company || ''}
                          className="mt-0.5 w-9 h-9 sm:w-10 sm:h-10 object-contain bg-background border border-border shrink-0 p-0.5"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).classList.remove('hidden'); }}
                        />
                      ) : null}
                      <div className={`mt-0.5 w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center shrink-0 border ${
                        isCurrent ? 'bg-foreground text-background border-border' : 'bg-muted/60 border-border'
                      } ${exp.logo ? 'hidden' : ''}`}>
                        <Briefcase className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-bold text-foreground text-sm leading-tight">{exp.role}</p>
                          {isCurrent && (
                            <span className="text-xs bg-foreground text-background px-1.5 py-0.5 font-bold uppercase tracking-wider shrink-0">
                              En poste
                            </span>
                          )}
                        </div>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Building2 className="w-3 h-3 shrink-0" />
                          {exp.company}
                        </p>
                        {(exp.start?.year || exp.end?.year) && (
                          <div className="flex items-center gap-2 mt-1 text-xs sm:text-xs text-muted-foreground/60">
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
                <div key={index} className="p-3 sm:p-4 border border-border bg-background hover:border-border transition-colors">
                  <div className="flex items-start gap-2.5 sm:gap-3">
                    {schoolLogo ? (
                      <img
                        src={schoolLogo}
                        alt={edu.school || ''}
                        className="mt-0.5 w-9 h-9 sm:w-10 sm:h-10 object-contain bg-background border border-border shrink-0 p-0.5"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).classList.remove('hidden'); }}
                      />
                    ) : null}
                    <div className={`mt-0.5 w-9 h-9 sm:w-10 sm:h-10 bg-muted flex items-center justify-center shrink-0 border border-border ${schoolLogo ? 'hidden' : ''}`}>
                      <GraduationCap className="w-4 h-4 text-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-foreground text-sm">{edu.school}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                        {edu.degree}{edu.field_of_study && ` · ${edu.field_of_study}`}
                      </p>
                      {(edu.start?.year || edu.end?.year) && (
                        <div className="flex items-center gap-2 mt-1 text-xs sm:text-xs text-muted-foreground/60">
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
            <SkillsWithEndorse
              skills={skills}
              profileId={profile.id}
              accountId={accountId}
            />
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
            <p className="text-xs font-bold mb-1 uppercase tracking-wider">Publications LinkedIn</p>
            <p className="text-xs text-muted-foreground mb-4">
              Consultez les dernières publications de ce candidat
            </p>
            <Button variant="outline" size="sm" className="rounded-none border border-border text-foreground hover:bg-foreground hover:text-background uppercase tracking-wider text-xs font-semibold">
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
    <p className="text-xs font-bold uppercase tracking-wider">{text}</p>
  </div>
);

/** Skills list with inline endorsement buttons */
const SkillsWithEndorse: React.FC<{
  skills: any[];
  profileId: string;
  accountId?: string;
}> = ({ skills, profileId, accountId }) => {
  const [endorsedIds, setEndorsedIds] = useState<Set<number>>(new Set());
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const handleEndorse = async (skill: any) => {
    if (!accountId || !skill.endorsement_id) return;
    setLoadingId(skill.endorsement_id);
    try {
      const { data } = await invokeUnipile({
        body: {
          action: 'endorse_skill',
          account_id: accountId,
          profile_id: profileId,
          skill_endorsement_id: skill.endorsement_id,
        },
      });
      if (data.success) {
        setEndorsedIds(prev => new Set(prev).add(skill.endorsement_id));
        toast.success(`Compétence "${skill.name}" endorsée`);
      } else {
        toast.error(data.error || 'Erreur lors de l\'endorsement');
      }
    } catch {
      toast.error('Erreur réseau');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((skill: any, index: number) => {
        const hasEndorsementId = !!skill.endorsement_id;
        const isEndorsed = skill.endorsed || endorsedIds.has(skill.endorsement_id);
        const isLoading = loadingId === skill.endorsement_id;

        return (
          <span
            key={index}
            className="text-xs px-2.5 py-1.5 bg-background text-foreground border border-border font-medium hover:border-border transition-colors inline-flex items-center gap-1.5"
          >
            {skill.name || skill}
            {skill.endorsement_count != null && (
              <span className="text-xs text-muted-foreground font-normal">+{skill.endorsement_count}</span>
            )}
            {hasEndorsementId && accountId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => !isEndorsed && !isLoading && handleEndorse(skill)}
                    disabled={isEndorsed || isLoading}
                    className={`ml-0.5 p-0.5 rounded transition-colors ${
                      isEndorsed
                        ? 'text-primary cursor-default'
                        : 'text-muted-foreground hover:text-primary cursor-pointer'
                    }`}
                  >
                    {isLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <ThumbsUp className={`w-3 h-3 ${isEndorsed ? 'fill-current' : ''}`} />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isEndorsed ? 'Endorsé ✓' : 'Endorser cette compétence'}
                </TooltipContent>
              </Tooltip>
            )}
          </span>
        );
      })}
    </div>
  );
};
