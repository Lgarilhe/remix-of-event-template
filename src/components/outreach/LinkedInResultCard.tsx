import React from 'react';
import { LinkedInProfile } from './LinkedInSearch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ExternalLink, UserPlus, Briefcase, MapPin, Zap } from 'lucide-react';

interface LinkedInResultCardProps {
  profile: LinkedInProfile;
}

export const LinkedInResultCard: React.FC<LinkedInResultCardProps> = ({ profile }) => {
  const initials = `${profile.first_name?.[0] || ''}${profile.last_name?.[0] || ''}`.toUpperCase();
  const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();

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
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-[#1A1A1A] truncate">
                {fullName || 'Profil LinkedIn'}
              </h3>
              {profile.connection_level && profile.connection_level <= 2 && (
                <Badge variant="outline" className="text-xs px-1.5 py-0">
                  {profile.connection_level}°
                </Badge>
              )}
              {profile.open_to_work && (
                <Badge className="bg-green-500 text-white text-xs px-1.5 py-0 gap-0.5">
                  <Zap className="w-3 h-3" />
                  Open
                </Badge>
              )}
            </div>
            <p className="text-sm text-[#1A1A1A]/70 truncate mt-0.5">
              {profile.headline || profile.current_position}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="text-[#0077B5] hover:text-[#005E93] hover:bg-[#0077B5]/10"
            >
              <a href={profile.profile_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4" />
              </a>
            </Button>
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
          {profile.current_company && (
            <span className="flex items-center gap-1">
              <Briefcase className="w-3 h-3" />
              {profile.current_company}
            </span>
          )}
          {profile.location && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {profile.location}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
