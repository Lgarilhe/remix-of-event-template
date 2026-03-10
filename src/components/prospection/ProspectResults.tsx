import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Users, Building2, MapPin, Briefcase, Mail, Phone, Zap,
  ExternalLink, TrendingUp, GraduationCap, ChevronDown, ChevronUp,
  Globe, Copy, Check, Loader2, Search,
} from 'lucide-react';
import { ProspectProfile } from '@/pages/Prospection';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

function titleCase(str: string) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function formatDate(dateStr?: string) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  } catch { return null; }
}

function buildLocation(prospect: ProspectProfile) {
  const parts = [
    prospect.location_name,
    ...(!prospect.location_name ? [
      prospect.location_locality,
      prospect.location_region,
      prospect.location_country,
    ] : []),
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return titleCase(parts[0] as string);
}

function extractLinkedInUsername(url?: string | null) {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/(?:in|pub)\/([^\/\?]+)/i);
  return match?.[1] || null;
}

function getProfilePicCandidates(prospect: ProspectProfile): string[] {
  const candidates: string[] = [];

  if (prospect.profile_pic_url) candidates.push(prospect.profile_pic_url);

  const linkedinUsername = extractLinkedInUsername(prospect.linkedin_url);
  if (linkedinUsername) {
    candidates.push(`https://unavatar.io/linkedin/${linkedinUsername}`);
  }

  if (prospect.full_name) {
    candidates.push(`https://ui-avatars.com/api/?name=${encodeURIComponent(prospect.full_name)}&background=E2E8F0&color=111827&size=128&bold=true`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function getCompanyLogoCandidates(companyName?: string, website?: string | null) {
  const candidates: string[] = [];

  if (website) {
    try {
      const domain = new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '');
      candidates.push(`https://logo.clearbit.com/${domain}`);
      candidates.push(`https://unavatar.io/${domain}`);
    } catch {
      // ignore malformed website
    }
  }

  if (companyName) {
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (slug) candidates.push(`https://unavatar.io/${slug}.com`);
    candidates.push(`https://ui-avatars.com/api/?name=${encodeURIComponent(companyName)}&background=E2E8F0&color=111827&size=64&bold=true`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function CompanyLogo({ companyName, website }: { companyName?: string; website?: string | null }) {
  const [logoIndex, setLogoIndex] = useState(0);
  const logos = getCompanyLogoCandidates(companyName, website);

  if (logos.length === 0 || logoIndex >= logos.length) {
    return <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />;
  }

  return (
    <img
      src={logos[logoIndex]}
      alt=""
      className="w-4 h-4 rounded border border-border/30 object-contain bg-background shrink-0"
      onError={() => setLogoIndex((prev) => (prev < logos.length - 1 ? prev + 1 : prev))}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

function ProspectCard({ prospect }: { prospect: ProspectProfile }) {
  const [expanded, setExpanded] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const signals = prospect.intent_signals;
  const initials = getInitials(prospect.full_name);
  const displayName = titleCase(prospect.full_name);
  const displayTitle = prospect.job_title ? titleCase(prospect.job_title) : null;
  const displayCompany = prospect.job_company_name ? titleCase(prospect.job_company_name) : null;
  const displayLocation = buildLocation(prospect);
  const avatarCandidates = getProfilePicCandidates(prospect);
  const [avatarIndex, setAvatarIndex] = useState(0);
  const avatarUrl = avatarCandidates[avatarIndex];
  const fallbackToNextAvatar = () => setAvatarIndex((prev) => (prev < avatarCandidates.length - 1 ? prev + 1 : prev));

  const copyEmail = (email: string) => {
    navigator.clipboard.writeText(email);
    setCopiedEmail(true);
    toast.success('Email copié');
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const jobTenure = prospect.job_start_date ? formatDate(prospect.job_start_date) : null;

  return (
    <div
      className="relative bg-background border border-foreground transition-all max-w-full group hover:shadow-md"
      style={{ wordBreak: 'break-word' }}
    >
      <div className="p-2.5 sm:p-4">
        <div className="relative flex items-start gap-2 sm:gap-4 min-w-0 w-full">
          {/* Avatar - separate column on desktop */}
          <div className="relative shrink-0 hidden sm:block">
            <Avatar className="w-14 h-14 border-2 border-border shadow-md">
              <AvatarImage src={avatarUrl} alt={displayName} className="object-cover" onError={fallbackToNextAvatar} />
              <AvatarFallback className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground text-lg font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            {/* Row 1: Name + badges + actions */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0 max-w-full">
                  {/* Avatar inline next to name on mobile */}
                  <div className="relative shrink-0 sm:hidden">
                    <Avatar className="w-8 h-8 border border-border shadow-sm">
                      <AvatarImage src={avatarUrl} alt={displayName} className="object-cover" onError={() => setAvatarIndex((prev) => prev + 1)} />
                      <AvatarFallback className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground text-xs font-medium">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <h3 className="font-semibold text-foreground text-sm sm:text-base leading-tight break-words sm:truncate">{displayName}</h3>
                  {prospect.score !== undefined && (
                    <Badge variant="outline" className={cn(
                      "text-[10px] shrink-0 font-bold tabular-nums",
                      prospect.score >= 80 ? "bg-green-500/10 text-green-700 border-green-500/30" :
                      prospect.score >= 60 ? "bg-yellow-500/10 text-yellow-700 border-yellow-500/30" :
                      "bg-muted border-foreground/15"
                    )}>
                      {prospect.score}%
                    </Badge>
                  )}
                  {prospect.source && (
                    <Badge className={cn(
                      "text-[9px] border gap-0.5 px-1.5 py-0",
                      prospect.source === 'apollo'
                        ? "bg-orange-500/10 text-orange-700 border-orange-500/30"
                        : "bg-purple-500/10 text-purple-700 border-purple-500/30"
                    )}>
                      {prospect.source === 'apollo' ? '🚀 Apollo' : '🔬 PDL'}
                    </Badge>
                  )}
                  {signals?.job_change && (
                    <Badge className="text-[9px] bg-blue-500/10 text-blue-700 border-blue-500/30 border gap-0.5 px-1.5 py-0">
                      <Zap className="w-2.5 h-2.5" /> Nouveau poste
                    </Badge>
                  )}
                  {signals?.recently_funded && (
                    <Badge className="text-[9px] bg-green-500/10 text-green-700 border-green-500/30 border gap-0.5 px-1.5 py-0">
                      <TrendingUp className="w-2.5 h-2.5" /> Levée
                    </Badge>
                  )}
                  {signals?.hiring && (
                    <Badge className="text-[9px] bg-amber-500/10 text-amber-700 border-amber-500/30 border gap-0.5 px-1.5 py-0">
                      📢 Recrute
                    </Badge>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="hidden sm:flex items-center gap-1 shrink-0">
                {prospect.linkedin_url && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                        <a href={prospect.linkedin_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Voir sur LinkedIn</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            {/* Headline */}
            {prospect.headline && (
              <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mt-0.5 leading-snug break-words">{prospect.headline}</p>
            )}

            {/* Row 2: Current position */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-x-2 sm:gap-x-4 gap-y-0.5 mt-1.5 text-[10px] sm:text-xs text-muted-foreground">
              {displayCompany && (
                <span className="flex items-center gap-1.5 font-medium text-foreground/80 min-w-0">
                  <CompanyLogo companyName={prospect.job_company_name} website={prospect.job_company_website} />
                  <span className="min-w-0 break-words sm:truncate">{displayCompany}</span>
                  {jobTenure && (
                    <span className="text-muted-foreground/40 font-normal shrink-0">• depuis {jobTenure}</span>
                  )}
                </span>
              )}
              {displayTitle && (
                <span className="flex items-center gap-1 min-w-0">
                  <Briefcase className="w-3.5 h-3.5 shrink-0" />
                  <span className="min-w-0 break-words sm:truncate">{displayTitle}</span>
                </span>
              )}
              {displayLocation && (
                <span className="flex items-center gap-1 min-w-0">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span className="min-w-0 break-words sm:truncate">{displayLocation}</span>
                </span>
              )}
            </div>

            {/* Company details */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-muted-foreground">
              {prospect.job_company_industry && (<span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{prospect.job_company_industry}</span>)}
              {prospect.job_company_size && (<span className="flex items-center gap-1"><Users className="w-3 h-3" />{prospect.job_company_size} emp.</span>)}
              {prospect.job_company_website && (
                <a href={prospect.job_company_website.startsWith('http') ? prospect.job_company_website : `https://${prospect.job_company_website}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-foreground transition-colors">
                  <Globe className="w-3 h-3" />Site
                </a>
              )}
            </div>

            {/* Skills */}
            {prospect.skills && prospect.skills.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2 overflow-hidden">
                {prospect.skills.slice(0, 4).map((skill, i) => (
                  <Badge key={i} variant="outline" className="text-[9px] border-foreground/10 font-normal px-1.5 py-0 bg-muted/50">{skill}</Badge>
                ))}
                {prospect.skills.length > 4 && (
                  <Badge variant="outline" className="text-[9px] border-foreground/10 font-normal px-1.5 py-0">+{prospect.skills.length - 4}</Badge>
                )}
              </div>
            )}

            {/* Contact */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px]">
              {prospect.emails?.[0] && (
                <button onClick={() => copyEmail(prospect.emails![0])}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors group/email">
                  <Mail className="w-3 h-3" />
                  <span className="truncate max-w-[160px]">{prospect.emails[0]}</span>
                  {copiedEmail ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-2.5 h-2.5 opacity-0 group-hover/email:opacity-100 transition-opacity" />}
                </button>
              )}
              {prospect.phone_numbers?.[0] && (
                <span className="flex items-center gap-1 text-muted-foreground"><Phone className="w-3 h-3" />{prospect.phone_numbers[0]}</span>
              )}
            </div>
          </div>
        </div>

        {/* Expand toggle */}
        {((prospect.experience && prospect.experience.length > 0) || (prospect.education && prospect.education.length > 0)) && (
          <button onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-2 ml-0 sm:ml-[72px]">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'Moins' : 'Détails'}
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-foreground/10 px-3 py-2 sm:ml-[72px] space-y-2">
          {prospect.experience && prospect.experience.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                <Briefcase className="w-3 h-3" /> Expérience
              </h4>
              <div className="space-y-1">
                {prospect.experience.map((exp, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
                    <div className="text-xs">
                      <span className="font-medium text-foreground">{exp.title}</span>
                      {exp.company && <span className="text-muted-foreground"> · {exp.company}</span>}
                      {(exp.start_date || exp.end_date) && (
                        <span className="text-muted-foreground/50 text-[10px] ml-1">
                          {formatDate(exp.start_date)} → {exp.end_date ? formatDate(exp.end_date) : 'Présent'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {prospect.education && prospect.education.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                <GraduationCap className="w-3 h-3" /> Formation
              </h4>
              <div className="space-y-1">
                {prospect.education.map((edu, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
                    <div className="text-xs">
                      <span className="font-medium text-foreground">{edu.school}</span>
                      {edu.degree && <span className="text-muted-foreground"> — {edu.degree}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ProspectResultsProps {
  results: ProspectProfile[];
  searching?: boolean;
}

export function ProspectResults({ results, searching }: ProspectResultsProps) {
  return (
    <div className="bg-background border border-foreground flex w-full max-w-full min-w-0 flex-col lg:h-full overflow-hidden">
      {/* HEADER */}
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-border shrink-0 min-w-0">
        <Button
          disabled={true}
          size="sm"
          className="bg-primary hover:bg-primary/90 shrink-0"
        >
          <Search className="w-3.5 h-3.5 mr-1.5" />
          Résultats
        </Button>

        {results.length > 0 && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            <span className="font-semibold text-foreground">{results.length}</span>
            <span className="text-muted-foreground/60"> prospect(s)</span>
          </span>
        )}

        {searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground ml-auto" />}
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-1.5">
        {results.length === 0 && !searching && (
          <div className="text-center py-16 px-4">
            <span className="text-4xl mb-3 block">👥</span>
            <h3 className="text-sm font-semibold text-foreground mb-1">Aucun prospect</h3>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Configurez vos filtres à gauche et lancez une recherche pour découvrir des prospects qualifiés.
            </p>
          </div>
        )}

        {searching && results.length === 0 && (
          <div className="text-center py-16 px-4">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-3" />
            <p className="text-xs text-muted-foreground">Recherche en cours sur PDL & Apollo...</p>
          </div>
        )}

        {results.map(prospect => (
          <ProspectCard key={prospect.id} prospect={prospect} />
        ))}
      </div>
    </div>
  );
}
