import React from 'react';
import { LinkedInProfile } from './types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ExternalLink, UserPlus, Briefcase, MapPin, Zap, Star } from 'lucide-react';

interface LinkedInResultCardProps {
  profile: LinkedInProfile;
}

export const LinkedInResultCard: React.FC<LinkedInResultCardProps> = ({ profile }) => {
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

  return (
    <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg border border-transparent hover:border-[#0077B5]/20 hover:bg-white transition-all">
      {/* Avatar */}
      <Avatar className="w-14 h-14 border-2 border-white shadow">
        <AvatarImage src={profile.profile_picture_url} alt={fullName} />
        <AvatarFallback className="bg-[#0077B5] text-white text-lg">
          {initials || '?'}
        </AvatarFallback>
      </Avatar>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-[#1A1A1A] truncate">
                {fullName || 'Profil LinkedIn'}
              </h3>
              {networkDistance && networkDistance <= 3 && (
                <Badge variant="outline" className="text-xs px-1.5 py-0 shrink-0">
                  {networkDistance}°
                </Badge>
              )}
              {profile.premium && (
                <Badge variant="outline" className="text-xs px-1.5 py-0 text-amber-600 border-amber-300 shrink-0">
                  <Star className="w-3 h-3 mr-0.5" />
                  Premium
                </Badge>
              )}
              {profile.open_profile && (
                <Badge variant="outline" className="text-xs px-1.5 py-0 text-blue-600 border-blue-300 shrink-0">
                  Open Profile
                </Badge>
              )}
              {profile.open_to_work && (
                <Badge className="bg-green-500 text-white text-xs px-1.5 py-0 gap-0.5 shrink-0">
                  <Zap className="w-3 h-3" />
                  Open
                </Badge>
              )}
            </div>
            <p className="text-sm text-[#1A1A1A]/70 truncate mt-0.5">
              {profile.headline || currentRole || 'Profil LinkedIn'}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {profileUrl && (
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="text-[#0077B5] hover:text-[#005E93] hover:bg-[#0077B5]/10"
              >
                <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-[#0077B5] hover:text-[#005E93] hover:bg-[#0077B5]/10"
            >
              <UserPlus className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Meta info */}
        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-[#1A1A1A]/50">
          {currentCompany && (
            <span className="flex items-center gap-1">
              <Briefcase className="w-3 h-3" />
              {currentCompany}
            </span>
          )}
          {profile.location && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {profile.location}
            </span>
          )}
          {profile.industry && (
            <span className="text-[#1A1A1A]/40">
              {profile.industry}
            </span>
          )}
        </div>

        {/* Tenure info if available */}
        {currentPosition?.tenure_at_company?.years && (
          <div className="mt-1 text-xs text-[#1A1A1A]/40">
            {currentPosition.tenure_at_company.years} an{currentPosition.tenure_at_company.years > 1 ? 's' : ''} dans l'entreprise
          </div>
        )}
      </div>
    </div>
  );
};
