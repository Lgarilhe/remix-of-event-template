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
      (prospect as any).location_locality,
      (prospect as any).location_region,
      (prospect as any).location_country,
    ] : []),
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return titleCase(parts[0]);
}

function getCompanyLogoUrl(companyName?: string, website?: string | null) {
  if (website) {
    try {
      const domain = new URL(website.startsWith('http') ? website : `https://${website}`).hostname;
      return `https://logo.clearbit.com/${domain}`;
    } catch { /* fall through */ }
  }
  if (companyName) {
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `https://logo.clearbit.com/${slug}.com`;
  }
  return null;
}

function ProspectCard({ prospect }: { prospect: ProspectProfile }) {
  const [expanded, setExpanded] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const signals = prospect.intent_signals;
  const initials = getInitials(prospect.full_name);
  const companyLogo = getCompanyLogoUrl(prospect.job_company_name, prospect.job_company_website);
  const displayName = titleCase(prospect.full_name);
  const displayTitle = prospect.job_title ? titleCase(prospect.job_title) : null;
  const displayCompany = prospect.job_company_name ? titleCase(prospect.job_company_name) : null;
  const displayLocation = buildLocation(prospect);

  const copyEmail = (email: string) => {
    navigator.clipboard.writeText(email);
    setCopiedEmail(true);
    toast.success('Email copié');
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const jobTenure = prospect.job_start_date ? formatDate(prospect.job_start_date) : null;

  return (
    <div className="border border-foreground/15 bg-background hover:border-foreground/30 transition-all group">
      <div className="p-3">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="relative shrink-0">
            <Avatar className="w-10 h-10 border-2 border-border shadow-sm">
              <AvatarImage src={prospect.profile_pic_url || undefined} alt={displayName} className="object-cover" />
              <AvatarFallback className="bg-foreground text-background text-xs font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* Main info */}
          <div className="flex-1 min-w-0">
            {/* Row 1: Name + badges */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-foreground truncate">{displayName}</h3>
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
                  {(prospect as any).source && (
                    <Badge className={cn(
                      "text-[9px] border gap-0.5 px-1.5 py-0",
                      (prospect as any).source === 'apollo'
                        ? "bg-orange-500/10 text-orange-700 border-orange-500/30"
                        : "bg-purple-500/10 text-purple-700 border-purple-500/30"
                    )}>
                      {(prospect as any).source === 'apollo' ? '🚀 Apollo' : '🔬 PDL'}
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
                {prospect.headline && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{prospect.headline}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
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

            {/* Row 2: Current position */}
            <div className="flex items-center gap-2 mt-1.5">
              {companyLogo && (
                <img
                  src={companyLogo} alt=""
                  className="w-4 h-4 rounded border border-foreground/10 object-contain bg-white shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-foreground">
                {displayTitle && (
                  <span className="font-medium flex items-center gap-1">
                    <Briefcase className="w-3 h-3 text-muted-foreground" />
                    {displayTitle}
                  </span>
                )}
                {displayCompany && (
                  <span className="text-muted-foreground">
                    chez <span className="font-medium text-foreground">{displayCompany}</span>
                  </span>
                )}
                {jobTenure && (
                  <span className="text-muted-foreground/60 text-[10px]">depuis {jobTenure}</span>
                )}
              </div>
            </div>

            {/* Row 3: Location + company details */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-muted-foreground">
              {displayLocation && (<span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{displayLocation}</span>)}
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
              <div className="flex flex-wrap gap-1 mt-1.5">
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
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-2 ml-[52px]">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'Moins' : 'Détails'}
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-foreground/10 px-3 py-2 ml-[52px] space-y-2">
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
    <div className="bg-background border border-foreground flex flex-col min-h-[420px] lg:h-[calc(100vh-180px)]">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Search className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wider">Résultats</span>
        {results.length > 0 && (
          <Badge variant="outline" className="text-[10px] border-foreground/20 tabular-nums">{results.length}</Badge>
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
