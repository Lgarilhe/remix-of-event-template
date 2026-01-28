import React, { useState } from 'react';
import { LinkedInProfile } from './types';
import { JobScoreDisplay, JobMatchResult } from './JobScoreDisplay';
import { OutreachMessageModal } from './OutreachMessageModal';
import { Job } from '@/pages/JobSpace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  ExternalLink, 
  UserPlus, 
  Briefcase, 
  MapPin, 
  Zap, 
  Star, 
  ChevronDown, 
  GraduationCap,
  Clock,
  Building2,
  Mail,
  MessageSquare,
  Users,
  Sparkles,
  Bot,
  Loader2,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Target,
  PenLine,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface LinkedInResultCardProps {
  profile: LinkedInProfile;
  selectedJob?: Job | null;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  jobScore?: JobMatchResult;
  onScoreProfile?: () => void;
}

export const LinkedInResultCard: React.FC<LinkedInResultCardProps> = ({ 
  profile,
  selectedJob,
  isSelected = false,
  onToggleSelect,
  jobScore,
  onScoreProfile,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<{
    summary: string;
    strengths: string[];
    concerns: string[];
    fit_score: number;
    recommendation: string;
  } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isScoring, setIsScoring] = useState(false);

  // Handle both API formats
  const firstName = profile.first_name || profile.name?.split(' ')[0] || '';
  const lastName = profile.last_name || profile.name?.split(' ').slice(1).join(' ') || '';
  const initials = `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
  const fullName = profile.name || `${firstName} ${lastName}`.trim();

  // Get work experience - API returns work_experience array
  const workExperience = profile.work_experience || [];
  const currentJob = workExperience.find(exp => !exp.end) || workExperience[0];
  const pastJobs = workExperience.filter(exp => exp.end).slice(0, 5);

  // Fallback to legacy fields if work_experience is empty
  const currentPosition = profile.current_positions?.[0];
  const currentCompany = currentJob?.company || currentPosition?.company;
  const currentRole = currentJob?.role || currentPosition?.role;

  // Network distance - handle different formats
  const networkDistance = typeof profile.network_distance === 'string'
    ? parseInt(profile.network_distance.replace('DISTANCE_', ''))
    : profile.network_distance;

  // Profile URL - handle different formats
  const profileUrl = profile.profile_url || profile.public_profile_url;

  // Calculate tenure display
  const getTenureDisplay = (start?: { year?: number; month?: number }, end?: { year?: number; month?: number }) => {
    if (!start?.year) return null;
    const startDate = new Date(start.year, (start.month || 1) - 1);
    const endDate = end?.year ? new Date(end.year, (end.month || 12) - 1) : new Date();
    const diffMonths = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
    const years = Math.floor(diffMonths / 12);
    const months = diffMonths % 12;
    if (years > 0 && months > 0) return `${years} an${years > 1 ? 's' : ''} ${months} mois`;
    if (years > 0) return `${years} an${years > 1 ? 's' : ''}`;
    if (months > 0) return `${months} mois`;
    return null;
  };

  const currentJobTenure = currentJob ? getTenureDisplay(currentJob.start, currentJob.end) : null;

  // Get skills
  const skills = profile.skills?.slice(0, 8) || [];
  
  // Get education
  const education = profile.education?.slice(0, 2) || [];
  
  // Connection count
  const connectionsCount = profile.connections_count;

  // Check for interest indicators
  const interests = profile.interests || [];
  const isLikelyToRespond = interests.includes('LIKELY_TO_RESPOND');
  const isActiveTalent = interests.includes('ACTIVE_TALENT');

  // Calculate total experience years
  const calculateTotalExperience = () => {
    let totalMonths = 0;
    workExperience.forEach(exp => {
      const tenure = getTenureDisplay(exp.start, exp.end);
      if (exp.start?.year) {
        const startDate = new Date(exp.start.year, (exp.start.month || 1) - 1);
        const endDate = exp.end?.year ? new Date(exp.end.year, (exp.end.month || 12) - 1) : new Date();
        totalMonths += (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
      }
    });
    
    const years = Math.floor(totalMonths / 12);
    return years > 0 ? `${years}+ ans d'exp.` : null;
  };

  const totalExperience = calculateTotalExperience();

  // AI Analysis function
  const handleAiAnalysis = async () => {
    if (aiAnalysis) {
      setAiAnalysis(null);
      return;
    }

    setIsAnalyzing(true);
    try {
      const profileSummary = {
        name: fullName,
        headline: profile.headline,
        currentRole,
        currentCompany,
        location: profile.location,
        skills: skills.map((s: any) => s.name || s).slice(0, 10),
        pastPositions: pastJobs.map(p => `${p.role} chez ${p.company}`),
        education: education.map((e: any) => `${e.degree || ''} - ${e.school}`),
      };

      const { data, error } = await supabase.functions.invoke('analyze-linkedin-profile', {
        body: { profile: profileSummary }
      });

      if (error) throw error;
      setAiAnalysis(data.analysis);
    } catch (error) {
      console.error('AI analysis error:', error);
      toast.error("Erreur lors de l'analyse IA");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className={`bg-white rounded-xl border transition-all ${
        isExpanded 
          ? 'border-[#0077B5]/30 shadow-lg shadow-[#0077B5]/5' 
          : 'border-[#1A1A1A]/10 hover:border-[#0077B5]/20 hover:shadow-md'
      }`}>
        {/* Main card content */}
        <div className="p-4">
          <div className="flex items-start gap-4">
            {/* Checkbox for batch selection */}
            {selectedJob && onToggleSelect && (
              <div className="pt-3">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={onToggleSelect}
                  className="border-purple-300 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                />
              </div>
            )}
            
            {/* Avatar */}
            <div className="relative">
              <Avatar className="w-14 h-14 border-2 border-white shadow-md">
                <AvatarImage src={profile.profile_picture_url} alt={fullName} />
                <AvatarFallback className="bg-gradient-to-br from-[#0077B5] to-[#005E93] text-white text-lg font-medium">
                  {initials || '?'}
                </AvatarFallback>
              </Avatar>
              {networkDistance && networkDistance <= 3 && (
                <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-white border-2 border-[#0077B5] rounded-full flex items-center justify-center text-[10px] font-bold text-[#0077B5]">
                  {networkDistance}°
                </span>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {/* Name and badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-[#1A1A1A] text-base">
                      {fullName || 'Profil LinkedIn'}
                    </h3>
                    {profile.premium && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-amber-600 border-amber-300 bg-amber-50">
                        <Star className="w-3 h-3 mr-0.5 fill-amber-400" />
                        Premium
                      </Badge>
                    )}
                    {profile.open_to_work && (
                      <Badge className="bg-green-500 text-white text-[10px] px-1.5 py-0 h-5 gap-0.5">
                        <Zap className="w-3 h-3" />
                        Open to Work
                      </Badge>
                    )}
                    {isLikelyToRespond && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-purple-600 border-purple-300 bg-purple-50">
                        <Sparkles className="w-3 h-3 mr-0.5" />
                        Réactif
                      </Badge>
                    )}
                  </div>
                  
                  {/* Headline */}
                  <p className="text-sm text-[#1A1A1A]/70 line-clamp-2 mt-1 leading-snug">
                    {profile.headline || currentRole || 'Profil LinkedIn'}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Job score button */}
                  {selectedJob && onScoreProfile && !jobScore && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onScoreProfile}
                      disabled={isScoring}
                      className="text-purple-600 hover:text-purple-700 hover:bg-purple-50 h-8 px-2 gap-1"
                      title={`Scorer pour ${selectedJob.title}`}
                    >
                      {isScoring ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Target className="w-4 h-4" />
                          <span className="text-xs hidden sm:inline">Score</span>
                        </>
                      )}
                    </Button>
                  )}
                  
                  {/* Generate message button - only show when job is selected */}
                  {selectedJob && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowMessageModal(true)}
                      className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 h-8 px-2 gap-1"
                      title="Générer un message d'approche"
                    >
                      <PenLine className="w-4 h-4" />
                      <span className="text-xs hidden sm:inline">Message</span>
                    </Button>
                  )}
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAiAnalysis}
                    disabled={isAnalyzing}
                    className="text-purple-600 hover:text-purple-700 hover:bg-purple-50 h-8 w-8 p-0"
                    title="Analyse IA du profil"
                  >
                    {isAnalyzing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Bot className="w-4 h-4" />
                    )}
                  </Button>
                  {profile.can_send_inmail && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[#0077B5] hover:text-[#005E93] hover:bg-[#0077B5]/10 h-8 w-8 p-0"
                      title="Envoyer InMail"
                    >
                      <Mail className="w-4 h-4" />
                    </Button>
                  )}
                  {profileUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      className="text-[#0077B5] hover:text-[#005E93] hover:bg-[#0077B5]/10 h-8 w-8 p-0"
                      title="Voir le profil"
                    >
                      <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[#0077B5] border-[#0077B5]/30 hover:bg-[#0077B5] hover:text-white h-8 px-3 gap-1.5"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span className="hidden sm:inline text-xs">Ajouter</span>
                  </Button>
                </div>
              </div>

              {/* Meta info row */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-[#1A1A1A]/60">
                {currentCompany && (
                  <span className="flex items-center gap-1.5 font-medium text-[#1A1A1A]/80">
                    <Building2 className="w-3.5 h-3.5 text-[#0077B5]" />
                    {currentCompany}
                    {currentJobTenure && (
                      <span className="text-[#1A1A1A]/40 font-normal">• {currentJobTenure}</span>
                    )}
                  </span>
                )}
                {profile.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {profile.location}
                  </span>
                )}
                {totalExperience && (
                  <span className="flex items-center gap-1 text-emerald-600 font-medium">
                    <TrendingUp className="w-3.5 h-3.5" />
                    {totalExperience}
                  </span>
                )}
                {connectionsCount && (
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {connectionsCount.toLocaleString()} connexions
                  </span>
                )}
              </div>

              {/* Job Score Display */}
              {jobScore && (
                <div className="mt-3">
                  <JobScoreDisplay 
                    result={jobScore} 
                    jobTitle={selectedJob?.title}
                    compact={!isExpanded}
                  />
                </div>
              )}

              {/* AI Analysis panel */}
              {aiAnalysis && (
                <div className="mt-3 p-3 bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 rounded-lg border border-purple-200/50">
                  {/* Header with score */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4 text-purple-600" />
                      <span className="text-xs font-semibold text-purple-700">Analyse IA</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5 text-purple-500" />
                      <span className={`text-sm font-bold ${
                        aiAnalysis.fit_score >= 70 ? 'text-green-600' : 
                        aiAnalysis.fit_score >= 50 ? 'text-amber-600' : 'text-red-500'
                      }`}>
                        {aiAnalysis.fit_score}/100
                      </span>
                    </div>
                  </div>

                  {/* Summary */}
                  <p className="text-sm text-[#1A1A1A]/80 font-medium mb-3">{aiAnalysis.summary || 'Analyse en cours...'}</p>

                  {/* Strengths & Concerns grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Strengths */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1 text-[10px] font-semibold text-green-700 uppercase tracking-wider">
                        <CheckCircle2 className="w-3 h-3" />
                        Points forts
                      </div>
                      {(aiAnalysis.strengths || []).map((strength, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-green-800 bg-green-100/50 px-2 py-1 rounded">
                          <span className="text-green-500 mt-0.5">✓</span>
                          <span>{strength}</span>
                        </div>
                      ))}
                      {(!aiAnalysis.strengths || aiAnalysis.strengths.length === 0) && (
                        <p className="text-xs text-green-600/60 italic">Aucun point fort identifié</p>
                      )}
                    </div>

                    {/* Concerns */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 uppercase tracking-wider">
                        <AlertTriangle className="w-3 h-3" />
                        À vérifier
                      </div>
                      {(aiAnalysis.concerns || []).map((concern, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-100/50 px-2 py-1 rounded">
                          <span className="text-amber-500 mt-0.5">!</span>
                          <span>{concern}</span>
                        </div>
                      ))}
                      {(!aiAnalysis.concerns || aiAnalysis.concerns.length === 0) && (
                        <p className="text-xs text-amber-600/60 italic">Aucun point à vérifier</p>
                      )}
                    </div>
                  </div>

                  {/* Recommendation */}
                  {aiAnalysis.recommendation && (
                    <div className="mt-3 pt-2 border-t border-purple-200/50">
                      <p className="text-xs text-purple-700 italic">
                        💡 {aiAnalysis.recommendation}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Experience preview - always visible */}
              {pastJobs.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#1A1A1A]/5">
                  <div className="flex items-center gap-2 mb-2">
                    <Briefcase className="w-3.5 h-3.5 text-[#1A1A1A]/40" />
                    <span className="text-[10px] font-semibold text-[#1A1A1A]/40 uppercase tracking-wider">
                      Parcours récent
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {pastJobs.slice(0, 2).map((pos, index) => (
                      <div key={index} className="flex items-center gap-2 text-xs">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#0077B5]/40 shrink-0" />
                        <span className="text-[#1A1A1A]/70 truncate">
                          <span className="font-medium">{pos.role}</span>
                          <span className="text-[#1A1A1A]/40"> chez </span>
                          <span>{pos.company}</span>
                          {pos.start?.year && pos.end?.year && (
                            <span className="text-[#1A1A1A]/30 ml-1">
                              ({pos.start.year}-{pos.end.year})
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                    {pastJobs.length > 2 && (
                      <span className="text-[10px] text-[#0077B5] font-medium">
                        +{pastJobs.length - 2} autres expériences
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Skills preview */}
              {skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {skills.slice(0, 5).map((skill: any, index: number) => (
                    <Badge 
                      key={index} 
                      variant="secondary" 
                      className="text-[10px] px-2 py-0.5 bg-[#1A1A1A]/5 text-[#1A1A1A]/70 font-normal"
                    >
                      {skill.name || skill}
                    </Badge>
                  ))}
                  {skills.length > 5 && (
                    <Badge 
                      variant="secondary" 
                      className="text-[10px] px-2 py-0.5 bg-[#0077B5]/10 text-[#0077B5] font-medium"
                    >
                      +{skills.length - 5}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Expand trigger */}
          <CollapsibleTrigger asChild>
            <button className="w-full mt-3 pt-3 border-t border-[#1A1A1A]/5 flex items-center justify-center gap-1 text-xs text-[#1A1A1A]/40 hover:text-[#0077B5] transition-colors">
              <span>{isExpanded ? 'Moins de détails' : 'Plus de détails'}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </CollapsibleTrigger>
        </div>

        {/* Expanded content */}
        <CollapsibleContent>
          <div className="px-4 pb-4 border-t border-[#1A1A1A]/5 pt-4 space-y-4">
            {/* Current role details */}
            {currentPosition && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-[#1A1A1A]/50 uppercase tracking-wider flex items-center gap-2">
                  <Briefcase className="w-3.5 h-3.5" />
                  Poste actuel
                </h4>
                <div className="bg-[#1A1A1A]/3 rounded-lg p-3">
                  <p className="font-medium text-sm text-[#1A1A1A]">{currentRole}</p>
                  <p className="text-sm text-[#1A1A1A]/60">{currentCompany}</p>
                  <div className="flex gap-4 mt-2 text-xs text-[#1A1A1A]/50">
                    {currentPosition.start && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Depuis {currentPosition.start.month ? `${currentPosition.start.month}/` : ''}{currentPosition.start.year}
                      </span>
                    )}
                  </div>
                  {currentPosition.description && (
                    <p className="text-xs text-[#1A1A1A]/60 mt-2 line-clamp-3">
                      {currentPosition.description}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* All past positions */}
            {pastJobs.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-[#1A1A1A]/50 uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" />
                  Expérience complète ({workExperience.length} postes)
                </h4>
                <div className="space-y-2">
                  {pastJobs.map((pos, index) => (
                    <div key={index} className="flex items-start gap-3 text-sm p-2 bg-[#1A1A1A]/3 rounded-lg">
                      {pos.logo ? (
                        <img src={pos.logo} alt={pos.company} className="w-8 h-8 rounded object-contain bg-white border" />
                      ) : (
                        <div className="w-8 h-8 rounded bg-[#0077B5]/10 flex items-center justify-center shrink-0">
                          <Building2 className="w-4 h-4 text-[#0077B5]/60" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-[#1A1A1A]/80">{pos.role}</p>
                        <p className="text-xs text-[#1A1A1A]/50">
                          {pos.company}
                          {pos.start?.year && pos.end?.year && (
                            <span className="ml-2 px-1.5 py-0.5 bg-[#1A1A1A]/5 rounded text-[10px]">
                              {pos.start.year} - {pos.end.year} ({getTenureDisplay(pos.start, pos.end)})
                            </span>
                          )}
                        </p>
                        {pos.description && (
                          <p className="text-xs text-[#1A1A1A]/40 mt-1 line-clamp-2">{pos.description}</p>
                        )}
                        {pos.skills && pos.skills.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {pos.skills.slice(0, 4).map((skill, i) => (
                              <span key={i} className="text-[9px] px-1.5 py-0.5 bg-[#0077B5]/5 text-[#0077B5] rounded">
                                {skill.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Education */}
            {education.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-[#1A1A1A]/50 uppercase tracking-wider flex items-center gap-2">
                  <GraduationCap className="w-3.5 h-3.5" />
                  Formation
                </h4>
                <div className="space-y-2">
                  {education.map((edu: any, index: number) => (
                    <div key={index} className="flex items-start gap-3 text-sm p-2 bg-[#1A1A1A]/3 rounded-lg">
                      <div className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                      <div>
                        <p className="font-medium text-[#1A1A1A]/80">{edu.school}</p>
                        <p className="text-xs text-[#1A1A1A]/50">
                          {edu.degree}
                          {edu.field_of_study && ` - ${edu.field_of_study}`}
                          {edu.end?.year && (
                            <span className="ml-2 px-1.5 py-0.5 bg-[#1A1A1A]/5 rounded">
                              {edu.end.year}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All skills */}
            {skills.length > 5 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-[#1A1A1A]/50 uppercase tracking-wider">
                  Toutes les compétences
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((skill: any, index: number) => (
                    <Badge 
                      key={index} 
                      variant="secondary" 
                      className="text-[10px] px-2 py-0.5 bg-[#1A1A1A]/5 text-[#1A1A1A]/70 font-normal"
                    >
                      {skill.name || skill}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Summary */}
            {(profile as any).summary && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-[#1A1A1A]/50 uppercase tracking-wider">
                  À propos
                </h4>
                <p className="text-sm text-[#1A1A1A]/70 leading-relaxed line-clamp-4">
                  {(profile as any).summary}
                </p>
              </div>
            )}

            {/* Quick actions */}
            <div className="flex gap-2 pt-2">
              {profileUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="flex-1 h-9"
                >
                  <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Voir le profil complet
                  </a>
                </Button>
              )}
              <Button
                size="sm"
                className="flex-1 h-9 bg-[#0077B5] hover:bg-[#005E93]"
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                Envoyer un message
              </Button>
            </div>
          </div>
        </CollapsibleContent>

        {/* Outreach message modal */}
        {selectedJob && (
          <OutreachMessageModal
            open={showMessageModal}
            onOpenChange={setShowMessageModal}
            profile={profile}
            job={selectedJob}
          />
        )}
      </div>
    </Collapsible>
  );
};