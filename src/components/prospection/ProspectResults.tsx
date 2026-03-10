import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, Building2, MapPin, Briefcase, Mail, Phone, Zap, ExternalLink, TrendingUp } from 'lucide-react';
import { ProspectProfile } from '@/pages/Prospection';
import { cn } from '@/lib/utils';

function ProspectCard({ prospect }: { prospect: ProspectProfile }) {
  const signals = prospect.intent_signals;
  const hasSignals = signals?.job_change || signals?.recently_funded || signals?.hiring;

  return (
    <div className="border border-foreground/15 bg-background hover:border-foreground/30 transition-colors group p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-foreground truncate">{prospect.full_name}</h3>
            {prospect.score !== undefined && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] shrink-0 border-foreground/20 font-bold",
                  prospect.score >= 80 ? "bg-green-500/10 text-green-700 border-green-500/30" :
                  prospect.score >= 60 ? "bg-yellow-500/10 text-yellow-700 border-yellow-500/30" :
                  "bg-muted"
                )}
              >
                {prospect.score}%
              </Badge>
            )}
          </div>

          {prospect.headline && (
            <p className="text-xs text-muted-foreground mb-1.5 line-clamp-1">{prospect.headline}</p>
          )}

          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mb-2">
            {prospect.job_title && (
              <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{prospect.job_title}</span>
            )}
            {prospect.job_company_name && (
              <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{prospect.job_company_name}</span>
            )}
            {prospect.location_name && (
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{prospect.location_name}</span>
            )}
          </div>

          {/* Company details */}
          {(prospect.job_company_industry || prospect.job_company_size || prospect.job_company_funding_stage) && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {prospect.job_company_industry && (
                <Badge variant="outline" className="text-[10px] border-foreground/15 font-normal">
                  {prospect.job_company_industry}
                </Badge>
              )}
              {prospect.job_company_size && (
                <Badge variant="outline" className="text-[10px] border-foreground/15 font-normal">
                  {prospect.job_company_size} employés
                </Badge>
              )}
              {prospect.job_company_funding_stage && (
                <Badge variant="outline" className="text-[10px] border-foreground/15 font-normal gap-0.5">
                  <TrendingUp className="w-2.5 h-2.5" /> {prospect.job_company_funding_stage}
                </Badge>
              )}
            </div>
          )}

          {/* Intent signals */}
          {hasSignals && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {signals?.job_change && (
                <Badge className="text-[10px] bg-blue-500/10 text-blue-700 border-blue-500/30 border gap-0.5">
                  <Zap className="w-2.5 h-2.5" /> Changement de poste
                </Badge>
              )}
              {signals?.recently_funded && (
                <Badge className="text-[10px] bg-green-500/10 text-green-700 border-green-500/30 border gap-0.5">
                  <TrendingUp className="w-2.5 h-2.5" /> Levée récente
                </Badge>
              )}
              {signals?.hiring && (
                <Badge className="text-[10px] bg-purple-500/10 text-purple-700 border-purple-500/30 border gap-0.5">
                  <Users className="w-2.5 h-2.5" /> Recrute
                </Badge>
              )}
            </div>
          )}

          {/* Contact info */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {prospect.emails?.[0] && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Mail className="w-3 h-3" />{prospect.emails[0]}
              </span>
            )}
            {prospect.phone_numbers?.[0] && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Phone className="w-3 h-3" />{prospect.phone_numbers[0]}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {prospect.linkedin_url && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
              <a href={prospect.linkedin_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProspectResults({ results }: { results: ProspectProfile[] }) {
  if (results.length === 0) {
    return (
      <div className="bg-background border border-foreground p-3 sm:p-6">
        <div className="text-center py-12 border border-dashed border-foreground/20">
          <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
          <h3 className="text-sm font-semibold text-foreground mb-1">Aucun prospect</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Lancez une recherche depuis l'onglet Recherche pour découvrir des prospects qualifiés.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background border border-foreground p-3 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" />
          <h2 className="text-sm font-bold uppercase tracking-wider">Résultats</h2>
          <Badge variant="outline" className="text-[10px] border-foreground/20">{results.length}</Badge>
        </div>
      </div>

      <div className="space-y-2">
        {results.map(prospect => (
          <ProspectCard key={prospect.id} prospect={prospect} />
        ))}
      </div>
    </div>
  );
}
