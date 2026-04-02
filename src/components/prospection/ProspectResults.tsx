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
import { ProspectProfile } from '@/types/prospects';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

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
  if (linkedinUsername) candidates.push(`https://unavatar.io/linkedin/${linkedinUsername}`);
  if (prospect.full_name) candidates.push(`https://ui-avatars.com/api/?name=${encodeURIComponent(prospect.full_name)}&background=E2E8F0&color=111827&size=128&bold=true`);
  return [...new Set(candidates.filter(Boolean))];
}

function getCompanyLogoCandidates(companyName?: string, website?: string | null) {
  const candidates: string[] = [];
  if (website) {
    try {
      const domain = new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '');
      candidates.push(`https://logo.clearbit.com/${domain}`);
      candidates.push(`https://unavatar.io/${domain}`);
    } catch {}
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
    return <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
  }
  return (
    <img
      src={logos[logoIndex]}
      alt={companyName || ''}
      className="w-4 h-4 border border-border/30 object-contain bg-background shrink-0"
      onError={() => setLogoIndex((prev) => (prev < logos.length - 1 ? prev + 1 : prev))}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

function ProspectCard({ prospect, index }: { prospect: ProspectProfile; index: number }) {
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
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.4) }}
      className="group relative border border-border bg-card hover:bg-muted/30 transition-all duration-200"
      style={{ wordBreak: 'break-word' }}
    >
      <div className="p-3 sm:p-4">
        <div className="relative flex items-start gap-3 sm:gap-4 min-w-0 w-full">
          {/* Avatar */}
          <div className="relative shrink-0 hidden sm:block">
            <Avatar className="w-12 h-12 border border-border">
              <AvatarImage src={avatarUrl} alt={displayName} className="object-cover" onError={fallbackToNextAvatar} />
              <AvatarFallback className="bg-muted text-foreground text-sm font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            {prospect.score !== undefined && prospect.score >= 80 && (
              <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 flex items-center justify-center border-2 border-background">
                <Check className="w-2.5 h-2.5 text-white" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            {/* Row 1: Name + badges */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0 max-w-full">
                  {/* Mobile avatar */}
                  <div className="relative shrink-0 sm:hidden">
                    <Avatar className="w-8 h-8 border border-border">
                      <AvatarImage src={avatarUrl} alt={displayName} className="object-cover" onError={fallbackToNextAvatar} />
                      <AvatarFallback className="bg-muted text-foreground text-xs font-medium">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <h3 className="font-semibold text-foreground text-sm sm:text-sm leading-tight break-words sm:truncate">{displayName}</h3>
                  {prospect.score !== undefined && (
                     <Badge variant="outline" className={cn(
                      "text-xs shrink-0 font-bold tabular-nums px-2",
                      prospect.score >= 80 ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" :
                      prospect.score >= 60 ? "bg-amber-500/10 text-amber-600 border-amber-500/30" :
                      "bg-muted text-muted-foreground border-border/50"
                    )}>
                      {prospect.score}%
                    </Badge>
                  )}
                  {prospect.source && (
                     <Badge className="text-xs border gap-0.5 px-1.5 py-0 bg-muted text-muted-foreground border-border/50">
                      🔍 Base
                    </Badge>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="hidden sm:flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
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

            {/* Intent signals */}
            {(signals?.job_change || signals?.recently_funded || signals?.hiring) && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {signals?.job_change && (
                  <Badge className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/20 border gap-1 px-2 py-0.5">
                    <Zap className="w-2.5 h-2.5" /> Nouveau poste
                  </Badge>
                )}
                {signals?.recently_funded && (
                  <Badge className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border gap-1 px-2 py-0.5">
                    <TrendingUp className="w-2.5 h-2.5" /> Levée récente
                  </Badge>
                )}
                {signals?.hiring && (
                  <Badge className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/20 border gap-1 px-2 py-0.5">
                    📢 Recrute
                  </Badge>
                )}
              </div>
            )}

            {/* Current position */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-x-3 sm:gap-x-4 gap-y-0.5 mt-2 text-xs sm:text-xs text-muted-foreground">
              {displayCompany && (
                <span className="flex items-center gap-1.5 font-medium text-foreground/80 min-w-0">
                  <CompanyLogo companyName={prospect.job_company_name} website={prospect.job_company_website} />
                  <span className="min-w-0 break-words sm:truncate">{displayCompany}</span>
                  {jobTenure && (
                    <span className="text-muted-foreground/50 font-normal shrink-0">depuis {jobTenure}</span>
                  )}
                </span>
              )}
              {displayTitle && (
                <span className="flex items-center gap-1 min-w-0">
                  <Briefcase className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
                  <span className="min-w-0 break-words sm:truncate">{displayTitle}</span>
                </span>
              )}
              {displayLocation && (
                <span className="flex items-center gap-1 min-w-0">
                  <MapPin className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
                  <span className="min-w-0 break-words sm:truncate">{displayLocation}</span>
                </span>
              )}
            </div>

            {/* Company details */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
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
              <div className="flex flex-wrap gap-1 mt-2.5">
                {prospect.skills.slice(0, 4).map((skill, i) => (
                  <Badge key={i} variant="outline" className="text-xs border-border/50 font-normal px-2 py-0.5 bg-muted/30">{skill}</Badge>
                ))}
                {prospect.skills.length > 4 && (
                  <Badge variant="outline" className="text-xs border-border/50 font-normal px-2 py-0.5">+{prospect.skills.length - 4}</Badge>
                )}
              </div>
            )}

            {/* Contact */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs">
              {prospect.emails?.[0] && (
                <button onClick={() => copyEmail(prospect.emails![0])}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors group/email">
                  <Mail className="w-3 h-3" />
                  <span className="truncate max-w-[160px]">{prospect.emails[0]}</span>
                  {copiedEmail ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-2.5 h-2.5 opacity-0 group-hover/email:opacity-100 transition-opacity" />}
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
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-2.5 ml-0 sm:ml-[60px]">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'Moins' : 'Voir détails'}
          </button>
        )}
      </div>

      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="border-t border-border px-4 py-3 sm:ml-[60px] space-y-3"
        >
          {prospect.experience && prospect.experience.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                <Briefcase className="w-3 h-3" /> Expérience
              </h4>
              <div className="space-y-1.5">
                {prospect.experience.map((exp, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 bg-foreground mt-1.5 shrink-0" />
                    <div className="text-xs">
                      <span className="font-medium text-foreground">{exp.title}</span>
                      {exp.company && <span className="text-muted-foreground"> · {exp.company}</span>}
                      {(exp.start_date || exp.end_date) && (
                        <span className="text-muted-foreground/50 text-xs ml-1">
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
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                <GraduationCap className="w-3 h-3" /> Formation
              </h4>
              <div className="space-y-1.5">
                {prospect.education.map((edu, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 bg-foreground mt-1.5 shrink-0" />
                    <div className="text-xs">
                      <span className="font-medium text-foreground">{edu.school}</span>
                      {edu.degree && <span className="text-muted-foreground"> — {edu.degree}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

interface ProspectResultsProps {
  results: ProspectProfile[];
  searching?: boolean;
}

export function ProspectResults({ results, searching }: ProspectResultsProps) {
  return (
    <div className="border border-border bg-card flex w-full max-w-full min-w-0 flex-col lg:h-full overflow-hidden">
      {/* HEADER */}
       <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 min-w-0">
         <div className="flex items-center gap-2">
           <div className="w-8 h-8 bg-foreground text-background flex items-center justify-center">
             <Search className="w-4 h-4" />
           </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Résultats</h3>
            {results.length > 0 && (
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{results.length}</span> prospect{results.length > 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
        {searching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />}
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2">
        {results.length === 0 && !searching && (
          <div className="text-center py-16 px-4">
            <div className="w-16 h-16 bg-muted/50 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">👥</span>
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1 uppercase tracking-wider">Aucun prospect</h3>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Utilisez les filtres à gauche pour lancer une recherche
            </p>
          </div>
        )}

        {searching && results.length === 0 && (
           <div className="text-center py-16 px-4">
             <div className="w-16 h-16 bg-muted/50 flex items-center justify-center mx-auto mb-4">
               <Loader2 className="w-7 h-7 animate-spin text-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">Recherche en cours…</h3>
            <p className="text-xs text-muted-foreground">Recherche dans nos bases de données</p>
          </div>
        )}

        {results.map((prospect, i) => (
          <ProspectCard key={prospect.id || i} prospect={prospect} index={i} />
        ))}
      </div>
    </div>
  );
}
