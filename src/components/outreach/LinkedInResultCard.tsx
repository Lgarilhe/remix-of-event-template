import React, { useState } from 'react';
import { LinkedInProfile } from './types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
} from 'lucide-react';

interface LinkedInResultCardProps {
  profile: LinkedInProfile;
}

export const LinkedInResultCard: React.FC<LinkedInResultCardProps> = ({ profile }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Handle both API formats
  const firstName = profile.first_name || profile.name?.split(' ')[0] || '';
  const lastName = profile.last_name || profile.name?.split(' ').slice(1).join(' ') || '';
  const initials = `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
  const fullName = profile.name || `${firstName} ${lastName}`.trim();

  // Get current position info
  const currentPosition = profile.current_positions?.[0];
  const currentCompany = currentPosition?.company;
  const currentRole = currentPosition?.role;

  // Network distance - handle different formats
  const networkDistance = typeof profile.network_distance === 'string'
    ? parseInt(profile.network_distance.replace('DISTANCE_', ''))
    : profile.network_distance;

  // Profile URL - handle different formats
  const profileUrl = profile.profile_url || profile.public_profile_url;

  // Calculate tenure display
  const getTenureDisplay = (tenure?: { years?: number; months?: number }) => {
    if (!tenure) return null;
    const years = tenure.years || 0;
    const months = tenure.months || 0;
    if (years > 0 && months > 0) return `${years} an${years > 1 ? 's' : ''} ${months} mois`;
    if (years > 0) return `${years} an${years > 1 ? 's' : ''}`;
    if (months > 0) return `${months} mois`;
    return null;
  };

  const companyTenure = getTenureDisplay(currentPosition?.tenure_at_company);
  const roleTenure = getTenureDisplay(currentPosition?.tenure_at_role);

  // Get skills (first 5)
  const skills = (profile as any).skills?.slice(0, 8) || [];
  
  // Get education
  const education = (profile as any).education?.slice(0, 2) || [];
  
  // Get past positions
  const pastPositions = profile.past_positions?.slice(0, 3) || [];
  
  // Connection count
  const connectionsCount = (profile as any).connections_count;

  // Check for interest indicators
  const interests = (profile as any).interests || [];
  const isLikelyToRespond = interests.includes('LIKELY_TO_RESPOND');
  const isRecentlyOpenToWork = interests.includes('RECENTLY_OPEN_TO_WORK');
  const isActiveTalent = interests.includes('ACTIVE_TALENT');

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
            {/* Avatar */}
            <div className="relative">
              <Avatar className="w-14 h-14 border-2 border-white shadow-md">
                <AvatarImage src={profile.profile_picture_url} alt={fullName} />
                <AvatarFallback className="bg-gradient-to-br from-[#0077B5] to-[#005E93] text-white text-lg font-medium">
                  {initials || '?'}
                </AvatarFallback>
              </Avatar>
              {/* Network badge overlay */}
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
                    {profile.open_profile && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-blue-600 border-blue-300 bg-blue-50">
                        Open Link
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
                    {companyTenure && (
                      <span className="text-[#1A1A1A]/40 font-normal">• {companyTenure}</span>
                    )}
                  </span>
                )}
                {profile.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {profile.location}
                  </span>
                )}
                {connectionsCount && (
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {connectionsCount.toLocaleString()} connexions
                  </span>
                )}
              </div>

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
                    {roleTenure && (
                      <span>{roleTenure} dans ce rôle</span>
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

            {/* Past positions */}
            {pastPositions.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-[#1A1A1A]/50 uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" />
                  Expérience précédente
                </h4>
                <div className="space-y-2">
                  {pastPositions.map((pos, index) => (
                    <div key={index} className="flex items-start gap-3 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#1A1A1A]/20 mt-2 shrink-0" />
                      <div>
                        <p className="font-medium text-[#1A1A1A]/80">{pos.role}</p>
                        <p className="text-xs text-[#1A1A1A]/50">
                          {pos.company}
                          {pos.start?.year && pos.end?.year && (
                            <span> • {pos.start.year} - {pos.end.year}</span>
                          )}
                        </p>
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
                    <div key={index} className="flex items-start gap-3 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#1A1A1A]/20 mt-2 shrink-0" />
                      <div>
                        <p className="font-medium text-[#1A1A1A]/80">{edu.school}</p>
                        <p className="text-xs text-[#1A1A1A]/50">
                          {edu.degree}
                          {edu.field_of_study && ` - ${edu.field_of_study}`}
                          {edu.end?.year && ` (${edu.end.year})`}
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
      </div>
    </Collapsible>
  );
};
