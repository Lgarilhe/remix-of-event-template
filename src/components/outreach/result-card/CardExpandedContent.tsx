import React from 'react';
import { LinkedInProfile } from '../types';
import { JobMatchResult } from '../JobScoreDisplay';
import { Job } from '@/pages/JobSpace';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ExternalLink, Briefcase, GraduationCap, Zap, X,
  MessageSquare, Newspaper, Clock, Target, Star,
  Archive, CheckCircle2,
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
    <div className="px-2.5 sm:px-4 pb-4 border-t border-border pt-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-foreground">Détails du profil</h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Candidate Activity Timeline */}
      {candidateStatus && (
        <div className="mb-3 p-2.5 bg-muted/30 rounded-lg border border-border/50">
          <div className="flex items-center gap-1.5 mb-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Historique</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {candidateStatus.score != null && candidateStatus.score > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-purple-50 text-purple-700 border border-purple-200/50">
                <Target className="w-3 h-3" />
                Score: {candidateStatus.score}%
                {candidateStatus.recommendation && (
                  <span className={`ml-0.5 font-medium ${
                    candidateStatus.recommendation === 'go' ? 'text-green-600' :
                    candidateStatus.recommendation === 'maybe' ? 'text-amber-600' : 'text-red-500'
                  }`}>
                    ({candidateStatus.recommendation === 'go' ? '✓ Go' : candidateStatus.recommendation === 'maybe' ? '~ Maybe' : '✗ Skip'})
                  </span>
                )}
              </span>
            )}
            {(candidateStatus.status === 'messaged' || candidateStatus.status === 'replied') && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200/50">
                <MessageSquare className="w-3 h-3" />
                {candidateStatus.status === 'replied' ? 'A répondu' : 'Contacté'}
              </span>
            )}
            {candidateStatus.status === 'shortlisted' && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200/50">
                <Star className="w-3 h-3" />
                Shortlisté
              </span>
            )}
            {candidateStatus.status === 'dismissed' && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-orange-50 text-orange-600 border border-orange-200/50">
                <Archive className="w-3 h-3" />
                Archivé
              </span>
            )}
            {candidateStatus.updated_at && (
              <span className="text-muted-foreground/60 text-[10px] ml-auto">
                {new Date(candidateStatus.updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Airtable History */}
      {airtableMatch && (historyLoading || historyData) && (
        <div className="mb-3 rounded-lg border border-teal-200/50 bg-teal-50/30 overflow-hidden">
          {/* Import inline to avoid circular deps */}
          {historyData && (
            <div className="p-3 text-xs text-teal-700">
              {historyData.placements.length > 0 && <p>🏆 {historyData.placements.length} placement(s)</p>}
              {historyData.shortlists.length > 0 && <p>⭐ {historyData.shortlists.length} shortlist(s)</p>}
              {historyData.notes.length > 0 && <p>📝 {historyData.notes.length} note(s)</p>}
            </div>
          )}
        </div>
      )}

      <Tabs defaultValue="experience" className="w-full">
        <TabsList className="w-full justify-start bg-muted/50 p-1 h-auto flex-wrap gap-1">
          <TabsTrigger value="experience" className="text-[10px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 data-[state=active]:bg-background gap-1">
            <Briefcase className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            Exp.
          </TabsTrigger>
          <TabsTrigger value="education" className="text-[10px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 data-[state=active]:bg-background gap-1">
            <GraduationCap className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            Form.
          </TabsTrigger>
          <TabsTrigger value="skills" className="text-[10px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 data-[state=active]:bg-background gap-1">
            <Zap className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            Skills
          </TabsTrigger>
          <TabsTrigger value="messages" className="text-[10px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 data-[state=active]:bg-background gap-1">
            <MessageSquare className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            Msg
          </TabsTrigger>
          <TabsTrigger value="posts" className="text-[10px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 data-[state=active]:bg-background gap-1">
            <Newspaper className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            Posts
          </TabsTrigger>
        </TabsList>

        {/* Experience Tab */}
        <TabsContent value="experience" className="mt-4 space-y-4">
          {workExperience.length > 0 ? (
            <div className="space-y-4">
              {workExperience.map((exp: any, index: number) => (
                <div key={index} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${!exp.end ? 'bg-green-500' : 'bg-primary/40'}`} />
                    {index < workExperience.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                  </div>
                  <div className="flex-1 pb-4">
                    <p className="font-medium text-foreground">{exp.role}</p>
                    <p className="text-sm text-muted-foreground">{exp.company}</p>
                    {(exp.start?.year || exp.end?.year) && (
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {exp.start?.year && `${exp.start.year}`}
                        {' - '}
                        {exp.end?.year ? `${exp.end.year}` : 'Présent'}
                      </p>
                    )}
                    {exp.description && (
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-3">{exp.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Briefcase className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Aucune expérience disponible</p>
            </div>
          )}
        </TabsContent>

        {/* Education Tab */}
        <TabsContent value="education" className="mt-4 space-y-4">
          {education.length > 0 ? (
            <div className="space-y-4">
              {education.map((edu: any, index: number) => (
                <div key={index} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400 mt-1.5" />
                    {index < education.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                  </div>
                  <div className="flex-1 pb-4">
                    <p className="font-medium text-foreground">{edu.school}</p>
                    <p className="text-sm text-muted-foreground">
                      {edu.degree}
                      {edu.field_of_study && ` - ${edu.field_of_study}`}
                    </p>
                    {(edu.start?.year || edu.end?.year) && (
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {edu.start?.year && `${edu.start.year}`}
                        {edu.start?.year && edu.end?.year && ' - '}
                        {edu.end?.year && `${edu.end.year}`}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <GraduationCap className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Aucune formation disponible</p>
            </div>
          )}
        </TabsContent>

        {/* Skills Tab */}
        <TabsContent value="skills" className="mt-4 space-y-4">
          {skills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {skills.map((skill: any, index: number) => (
                <Badge
                  key={index}
                  variant="secondary"
                  className="text-xs px-3 py-1.5 bg-primary/10 text-primary font-normal"
                >
                  {skill.name || skill}
                  {skill.endorsement_count && (
                    <span className="ml-1.5 text-[10px] text-primary/60">
                      ({skill.endorsement_count})
                    </span>
                  )}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Zap className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Aucune compétence disponible</p>
            </div>
          )}
        </TabsContent>

        {/* Messages Tab */}
        <TabsContent value="messages" className="mt-4">
          <CardMessageThread
            accountId={accountId}
            profileId={profile.id}
            profileName={fullName}
            onMessageSent={onMessageSent}
            onProfileTreated={onProfileTreated}
          />
        </TabsContent>

        {/* Posts Tab */}
        <TabsContent value="posts" className="mt-4">
          <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-lg">
            <Newspaper className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium mb-1">Publications LinkedIn</p>
            <p className="text-xs text-muted-foreground mb-4">
              Consultez les dernières publications de ce candidat
            </p>
            <Button
              variant="outline"
              size="sm"
              className="text-primary border-primary/30 hover:bg-primary/10"
            >
              <Newspaper className="w-4 h-4 mr-2" />
              Voir les posts
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* Quick actions */}
      <div className="flex gap-2 pt-4 mt-4 border-t border-border">
        {profileUrl && (
          <Button variant="outline" size="sm" asChild className="flex-1 h-9">
            <a href={profileUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Voir le profil complet
            </a>
          </Button>
        )}
        {jobScore?.recommendation === 'skip' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" disabled className="flex-1 h-9 bg-gray-300 cursor-not-allowed">
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
            className="flex-1 h-9 bg-primary hover:bg-primary/90"
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
