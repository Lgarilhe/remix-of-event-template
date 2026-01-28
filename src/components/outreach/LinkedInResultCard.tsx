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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  FileText,
  Newspaper,
  X,
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
  accountId?: string;
}

interface ChatMessage {
  id: string;
  text: string;
  sender_id?: string;
  timestamp?: string;
  is_sender?: boolean;
  attachments?: Array<{ type: string; url?: string; name?: string }>;
}

interface Chat {
  id: string;
  attendees?: Array<{ id: string; name?: string; display_name?: string }>;
  last_message?: { text?: string; timestamp?: string };
  unread_count?: number;
}

export const LinkedInResultCard: React.FC<LinkedInResultCardProps> = ({ 
  profile,
  selectedJob,
  isSelected = false,
  onToggleSelect,
  jobScore,
  onScoreProfile,
  accountId,
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
  
  // Message history state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [noConversation, setNoConversation] = useState(false);

  // Handle both API formats
  const firstName = profile.first_name || profile.name?.split(' ')[0] || '';
  const lastName = profile.last_name || profile.name?.split(' ').slice(1).join(' ') || '';
  const initials = `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
  const fullName = profile.name || `${firstName} ${lastName}`.trim();

  // Get work experience - API returns work_experience array
  const workExperience = profile.work_experience || [];
  
  // Get ALL current jobs (without end date) - there can be multiple simultaneous positions
  const currentJobs = workExperience.filter(exp => !exp.end);
  // For display purposes, use the first current job as the "main" one
  const currentJob = currentJobs[0] || workExperience[0];
  // Other current jobs (if multiple simultaneous positions)
  const otherCurrentJobs = currentJobs.slice(1);
  // Past jobs have an end date
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
  
  // Get education - all for display
  const education = profile.education || [];
  const educationPreview = education.slice(0, 2);
  
  // Connection count
  const connectionsCount = profile.connections_count;

  // Check for interest indicators
  const interests = profile.interests || [];
  const isLikelyToRespond = interests.includes('LIKELY_TO_RESPOND');
  const isActiveTalent = interests.includes('ACTIVE_TALENT');

  // Calculate experience based on last relevant diploma date
  // Relevant diplomas: Bachelor's, Master's, MBA, PhD, Engineering, etc.
  const calculateExperienceFromDiploma = () => {
    if (!education || education.length === 0) return null;
    
    // List of relevant degree keywords (case insensitive)
    const relevantDegreeKeywords = [
      'bachelor', 'licence', 'bac+3', 'bac +3',
      'master', 'msc', 'm.sc', 'bac+5', 'bac +5', 'maîtrise',
      'mba',
      'ingénieur', 'engineer', 'engineering',
      'phd', 'doctorat', 'doctorate', 'bac+8', 'bac +8',
      'diplôme', 'degree', 'graduate',
      'grande école', 'grande ecole'
    ];
    
    // Find the last relevant diploma with an end date
    const relevantEducation = education
      .filter((edu: any) => {
        if (!edu.end?.year) return false;
        const degree = (edu.degree || '').toLowerCase();
        const school = (edu.school || '').toLowerCase();
        const field = (edu.field_of_study || '').toLowerCase();
        const combined = `${degree} ${school} ${field}`;
        return relevantDegreeKeywords.some(keyword => combined.includes(keyword));
      })
      .sort((a: any, b: any) => (b.end?.year || 0) - (a.end?.year || 0));
    
    // If no relevant diploma found, try to use any education with an end date
    const diplomaToUse = relevantEducation[0] || 
      education.filter((edu: any) => edu.end?.year).sort((a: any, b: any) => (b.end?.year || 0) - (a.end?.year || 0))[0];
    
    if (!diplomaToUse?.end?.year) return null;
    
    const diplomaYear = diplomaToUse.end.year;
    const currentYear = new Date().getFullYear();
    const yearsOfExperience = currentYear - diplomaYear;
    
    if (yearsOfExperience <= 0) return null;
    return {
      years: yearsOfExperience,
      diplomaYear,
      diplomaName: diplomaToUse.degree || diplomaToUse.school,
    };
  };

  const experienceFromDiploma = calculateExperienceFromDiploma();
  const totalExperience = experienceFromDiploma 
    ? `${experienceFromDiploma.years} an${experienceFromDiploma.years > 1 ? 's' : ''} d'exp.`
    : null;

  // Load message history
  const loadMessages = async () => {
    if (!accountId || messagesLoaded || messagesLoading) return;
    
    setMessagesLoading(true);
    setNoConversation(false);
    
    try {
      // Get the profile identifier to search for conversations
      // We need to find a chat that includes this person
      const profileIdentifier = profile.public_identifier || profile.id;
      
      // First, get all chats and find one with this attendee
      const chatsResponse = await supabase.functions.invoke('unipile-search', {
        body: {
          action: 'get_chats',
          account_id: accountId,
          limit: 100,
        },
      });

      if (chatsResponse.error) throw chatsResponse.error;
      
      if (!chatsResponse.data?.success || !chatsResponse.data?.chats?.length) {
        setNoConversation(true);
        setMessagesLoaded(true);
        return;
      }

      // Find a chat that contains this profile as attendee
      const profileName = profile.name || `${profile.first_name} ${profile.last_name}`.trim();
      const foundChat = chatsResponse.data.chats.find((chat: Chat) => {
        if (!chat.attendees) return false;
        return chat.attendees.some((attendee: { id: string; name?: string; display_name?: string }) => {
          // Match by ID or by name
          if (attendee.id === profileIdentifier) return true;
          if (attendee.name && profileName && attendee.name.toLowerCase().includes(profileName.toLowerCase())) return true;
          if (attendee.display_name && profileName && attendee.display_name.toLowerCase().includes(profileName.toLowerCase())) return true;
          return false;
        });
      });

      if (!foundChat) {
        setNoConversation(true);
        setMessagesLoaded(true);
        return;
      }

      setChatId(foundChat.id);

      // Get messages from this chat
      const messagesResponse = await supabase.functions.invoke('unipile-search', {
        body: {
          action: 'get_messages',
          account_id: accountId,
          chat_id: foundChat.id,
          limit: 50,
        },
      });

      if (messagesResponse.error) throw messagesResponse.error;
      
      if (messagesResponse.data?.success && messagesResponse.data?.messages) {
        setMessages(messagesResponse.data.messages);
      }
      
      setMessagesLoaded(true);
    } catch (error) {
      console.error('Error loading messages:', error);
      toast.error("Erreur lors du chargement des messages");
    } finally {
      setMessagesLoading(false);
    }
  };

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

  // Format message timestamp
  const formatMessageTime = (timestamp?: string) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Hier';
    } else if (diffDays < 7) {
      return date.toLocaleDateString('fr-FR', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
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

              {/* Experience preview - show other current jobs + past jobs */}
              {(otherCurrentJobs.length > 0 || pastJobs.length > 0) && (
                <div className="mt-3 pt-3 border-t border-[#1A1A1A]/5">
                  <div className="flex items-center gap-2 mb-2">
                    <Briefcase className="w-3.5 h-3.5 text-[#1A1A1A]/40" />
                    <span className="text-[10px] font-semibold text-[#1A1A1A]/40 uppercase tracking-wider">
                      {otherCurrentJobs.length > 0 ? 'Autres postes actuels + Parcours récent' : 'Parcours récent'}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {/* Show other current jobs first (simultaneous positions) */}
                    {otherCurrentJobs.slice(0, 2).map((pos, index) => (
                      <div key={`current-${index}`} className="flex items-center gap-2 text-xs">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                        <span className="text-[#1A1A1A]/70 truncate">
                          <span className="font-medium">{pos.role}</span>
                          <span className="text-[#1A1A1A]/40"> chez </span>
                          <span>{pos.company}</span>
                          <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[9px] border-green-300 text-green-600 bg-green-50">
                            Actuel
                          </Badge>
                        </span>
                      </div>
                    ))}
                    {/* Then show past jobs */}
                    {pastJobs.slice(0, otherCurrentJobs.length > 0 ? 1 : 2).map((pos, index) => (
                      <div key={`past-${index}`} className="flex items-center gap-2 text-xs">
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
                    {(otherCurrentJobs.length + pastJobs.length) > 2 && (
                      <span className="text-[10px] text-[#0077B5] font-medium">
                        +{otherCurrentJobs.length + pastJobs.length - 2} autres expériences
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Education preview - show in compact view */}
              {educationPreview.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#1A1A1A]/5">
                  <div className="flex items-center gap-2 mb-2">
                    <GraduationCap className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-[10px] font-semibold text-[#1A1A1A]/40 uppercase tracking-wider">
                      Formation
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {educationPreview.map((edu: any, index: number) => (
                      <div key={index} className="flex items-center gap-2 text-xs">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                        <span className="text-[#1A1A1A]/70 truncate">
                          <span className="font-medium">{edu.degree || edu.school}</span>
                          {edu.degree && edu.school && (
                            <span className="text-[#1A1A1A]/40"> - {edu.school}</span>
                          )}
                          {edu.end?.year && (
                            <span className="text-[#1A1A1A]/30 ml-1">({edu.end.year})</span>
                          )}
                        </span>
                      </div>
                    ))}
                    {education.length > 2 && (
                      <span className="text-[10px] text-amber-600 font-medium">
                        +{education.length - 2} autres formations
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

        {/* Expanded content with tabs */}
        <CollapsibleContent>
          <div className="px-4 pb-4 border-t border-[#1A1A1A]/5 pt-4">
            {/* Header with close button */}
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-[#1A1A1A]">Détails du profil</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(false)}
                className="h-7 w-7 p-0 text-[#1A1A1A]/40 hover:text-[#1A1A1A]"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            <Tabs defaultValue="experience" className="w-full">
              <TabsList className="w-full justify-start bg-[#1A1A1A]/5 p-1 h-auto flex-wrap gap-1">
                <TabsTrigger value="experience" className="text-xs px-3 py-1.5 data-[state=active]:bg-white gap-1.5">
                  <Briefcase className="w-3.5 h-3.5" />
                  Expérience
                </TabsTrigger>
                <TabsTrigger value="education" className="text-xs px-3 py-1.5 data-[state=active]:bg-white gap-1.5">
                  <GraduationCap className="w-3.5 h-3.5" />
                  Formation
                </TabsTrigger>
                <TabsTrigger value="skills" className="text-xs px-3 py-1.5 data-[state=active]:bg-white gap-1.5">
                  <Zap className="w-3.5 h-3.5" />
                  Compétences
                </TabsTrigger>
                <TabsTrigger value="messages" className="text-xs px-3 py-1.5 data-[state=active]:bg-white gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Messages
                </TabsTrigger>
                <TabsTrigger value="posts" className="text-xs px-3 py-1.5 data-[state=active]:bg-white gap-1.5">
                  <Newspaper className="w-3.5 h-3.5" />
                  Posts
                </TabsTrigger>
              </TabsList>

              {/* Experience Tab */}
              <TabsContent value="experience" className="mt-4 space-y-4">
                {/* All current positions */}
                {currentJobs.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-[#1A1A1A]/50 uppercase tracking-wider flex items-center gap-2">
                      <Briefcase className="w-3.5 h-3.5" />
                      {currentJobs.length > 1 ? `Postes actuels (${currentJobs.length})` : 'Poste actuel'}
                    </h4>
                    <div className="space-y-2">
                      {currentJobs.map((pos, index) => (
                        <div key={index} className="bg-gradient-to-r from-green-50 to-white rounded-lg p-3 border border-green-100">
                          <div className="flex items-start gap-3">
                            {pos.logo ? (
                              <img src={pos.logo} alt={pos.company} className="w-10 h-10 rounded object-contain bg-white border" />
                            ) : (
                              <div className="w-10 h-10 rounded bg-green-100 flex items-center justify-center shrink-0">
                                <Building2 className="w-5 h-5 text-green-600" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm text-[#1A1A1A]">{pos.role}</p>
                                <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-green-300 text-green-600 bg-green-50">
                                  Actuel
                                </Badge>
                              </div>
                              <p className="text-sm text-[#1A1A1A]/60">{pos.company}</p>
                              <div className="flex gap-4 mt-2 text-xs text-[#1A1A1A]/50">
                                {pos.start && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    Depuis {pos.start.month ? `${pos.start.month}/` : ''}{pos.start.year}
                                    {getTenureDisplay(pos.start, pos.end) && (
                                      <span className="text-green-600 font-medium ml-1">
                                        ({getTenureDisplay(pos.start, pos.end)})
                                      </span>
                                    )}
                                  </span>
                                )}
                              </div>
                              {pos.description && (
                                <p className="text-xs text-[#1A1A1A]/60 mt-2 line-clamp-3">{pos.description}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* All past positions */}
                {pastJobs.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-[#1A1A1A]/50 uppercase tracking-wider flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5" />
                      Expérience passée ({pastJobs.length} postes)
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
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Summary */}
                {(profile as any).summary && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-[#1A1A1A]/50 uppercase tracking-wider flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5" />
                      À propos
                    </h4>
                    <p className="text-sm text-[#1A1A1A]/70 leading-relaxed bg-[#1A1A1A]/3 p-3 rounded-lg">
                      {(profile as any).summary}
                    </p>
                  </div>
                )}
              </TabsContent>

              {/* Education Tab */}
              <TabsContent value="education" className="mt-4 space-y-4">
                {education.length > 0 ? (
                  <div className="space-y-2">
                    {education.map((edu: any, index: number) => (
                      <div key={index} className="flex items-start gap-3 text-sm p-3 bg-amber-50/50 rounded-lg border border-amber-100">
                        {edu.school_details?.logo ? (
                          <img src={edu.school_details.logo} alt={edu.school} className="w-10 h-10 rounded object-contain bg-white border" />
                        ) : (
                          <div className="w-10 h-10 rounded bg-amber-100 flex items-center justify-center shrink-0">
                            <GraduationCap className="w-5 h-5 text-amber-600" />
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="font-medium text-[#1A1A1A]">{edu.school}</p>
                          <p className="text-sm text-[#1A1A1A]/70">
                            {edu.degree}
                            {edu.field_of_study && ` - ${edu.field_of_study}`}
                          </p>
                          {(edu.start?.year || edu.end?.year) && (
                            <p className="text-xs text-[#1A1A1A]/50 mt-1">
                              {edu.start?.year && `${edu.start.year}`}
                              {edu.start?.year && edu.end?.year && ' - '}
                              {edu.end?.year && `${edu.end.year}`}
                            </p>
                          )}
                          {edu.school_details?.description && (
                            <p className="text-xs text-[#1A1A1A]/50 mt-2 line-clamp-2">
                              {edu.school_details.description}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-[#1A1A1A]/40">
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
                        className="text-xs px-3 py-1.5 bg-[#0077B5]/10 text-[#0077B5] font-normal"
                      >
                        {skill.name || skill}
                        {skill.endorsement_count && (
                          <span className="ml-1.5 text-[10px] text-[#0077B5]/60">
                            ({skill.endorsement_count})
                          </span>
                        )}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-[#1A1A1A]/40">
                    <Zap className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Aucune compétence disponible</p>
                  </div>
                )}
              </TabsContent>

              {/* Messages Tab */}
              <TabsContent value="messages" className="mt-4">
                {!accountId ? (
                  <div className="text-center py-8 text-[#1A1A1A]/40 bg-[#1A1A1A]/3 rounded-lg">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
                    <p className="text-sm font-medium mb-1">Compte non disponible</p>
                    <p className="text-xs text-[#1A1A1A]/50">
                      Sélectionnez un compte LinkedIn pour voir l'historique des messages
                    </p>
                  </div>
                ) : messagesLoading ? (
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-[#0077B5]" />
                    <p className="text-sm text-[#1A1A1A]/60">Chargement des messages...</p>
                  </div>
                ) : !messagesLoaded ? (
                  <div className="text-center py-8 text-[#1A1A1A]/40 bg-[#1A1A1A]/3 rounded-lg">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
                    <p className="text-sm font-medium mb-1">Historique des messages</p>
                    <p className="text-xs text-[#1A1A1A]/50 mb-4">
                      Consultez l'historique des échanges avec ce candidat
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadMessages}
                      className="text-[#0077B5] border-[#0077B5]/30 hover:bg-[#0077B5]/10"
                    >
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Charger l'historique
                    </Button>
                  </div>
                ) : noConversation ? (
                  <div className="text-center py-8 text-[#1A1A1A]/40 bg-amber-50/50 rounded-lg border border-amber-200">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 text-amber-400" />
                    <p className="text-sm font-medium mb-1 text-amber-700">Aucune conversation</p>
                    <p className="text-xs text-amber-600/70">
                      Vous n'avez pas encore échangé avec ce candidat
                    </p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-8 text-[#1A1A1A]/40 bg-[#1A1A1A]/3 rounded-lg">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
                    <p className="text-sm font-medium mb-1">Conversation vide</p>
                    <p className="text-xs text-[#1A1A1A]/50">
                      La conversation existe mais aucun message n'a été trouvé
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {/* Messages header */}
                    <div className="flex items-center justify-between pb-2 border-b border-[#1A1A1A]/10">
                      <span className="text-xs font-medium text-[#1A1A1A]/60">
                        {messages.length} message{messages.length > 1 ? 's' : ''}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setMessagesLoaded(false);
                          setMessages([]);
                        }}
                        className="text-xs h-6 px-2 text-[#1A1A1A]/40 hover:text-[#1A1A1A]"
                      >
                        Actualiser
                      </Button>
                    </div>
                    
                    {/* Message list - reversed for chronological order */}
                    <div className="space-y-2">
                      {[...messages].reverse().map((msg, index) => (
                        <div 
                          key={msg.id || index}
                          className={`flex ${msg.is_sender ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-[80%] rounded-lg px-3 py-2 ${
                            msg.is_sender 
                              ? 'bg-[#0077B5] text-white' 
                              : 'bg-[#1A1A1A]/5 text-[#1A1A1A]'
                          }`}>
                            <p className="text-sm whitespace-pre-wrap break-words">
                              {msg.text || '(Message sans texte)'}
                            </p>
                            {msg.timestamp && (
                              <p className={`text-[10px] mt-1 ${
                                msg.is_sender ? 'text-white/60' : 'text-[#1A1A1A]/40'
                              }`}>
                                {formatMessageTime(msg.timestamp)}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Posts Tab */}
              <TabsContent value="posts" className="mt-4">
                <div className="text-center py-8 text-[#1A1A1A]/40 bg-[#1A1A1A]/3 rounded-lg">
                  <Newspaper className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <p className="text-sm font-medium mb-1">Publications LinkedIn</p>
                  <p className="text-xs text-[#1A1A1A]/50 mb-4">
                    Consultez les dernières publications de ce candidat
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[#0077B5] border-[#0077B5]/30 hover:bg-[#0077B5]/10"
                  >
                    <Newspaper className="w-4 h-4 mr-2" />
                    Voir les posts
                  </Button>
                </div>
              </TabsContent>
            </Tabs>

            {/* Quick actions */}
            <div className="flex gap-2 pt-4 mt-4 border-t border-[#1A1A1A]/5">
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