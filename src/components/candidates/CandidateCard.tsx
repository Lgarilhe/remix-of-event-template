/**
 * Ligne d'une candidature dans l'affichage « Liste » de la shortlist client
 * (revue design E-28) : primitives du kit, badges neutres lisibles dans les
 * deux thèmes, bouton de détail nommé avec son état (aria-expanded).
 */
import React, { useId, useState } from 'react';
import { ChevronDown, Mail, Phone } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ShortlistEntry } from '@/types/shortlist';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface CandidateCardProps {
  entry: ShortlistEntry;
}

const LINK = 'inline-flex items-center gap-1.5 rounded-sm text-sm text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export const CandidateCard: React.FC<CandidateCardProps> = ({ entry }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const detailsId = useId();
  const candidate = entry.candidate;
  const name = candidate?.name || entry.name;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      return format(new Date(dateStr), 'd MMM yyyy', { locale: fr });
    } catch {
      return dateStr;
    }
  };

  const milestones = [
    { label: 'Préqualification', date: formatDate(entry.preQualifDate) },
    { label: 'CV présenté', date: formatDate(entry.cvPresentationDate) },
    { label: 'Retour du manager', date: formatDate(entry.managerReturnDate) },
    { label: 'Offre validée', date: formatDate(entry.offerValidationDate) },
  ].filter((m) => m.date);

  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-md font-semibold text-foreground">{name}</h3>
            {entry.stage && <Badge variant="outline">{entry.stage}</Badge>}
            {entry.entity && <Badge variant="muted">{entry.entity}</Badge>}
          </div>

          {candidate?.expertise && candidate.expertise.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {candidate.expertise.map(exp => (
                <Badge key={exp} variant="muted">{exp}</Badge>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {candidate?.email && (
              <a href={`mailto:${candidate.email}`} className={LINK}>
                <Mail className="h-4 w-4" aria-hidden="true" />
                {candidate.email}
              </a>
            )}
            {candidate?.phone && (
              <a href={`tel:${candidate.phone}`} className={LINK}>
                <Phone className="h-4 w-4" aria-hidden="true" />
                {candidate.phone}
              </a>
            )}
            {candidate?.linkedin && (
              <a
                href={candidate.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Profil LinkedIn de ${name}`}
                className={LINK}
              >
                <ChannelIcon channel="linkedin" showLabel />
              </a>
            )}
          </div>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsExpanded(!isExpanded)}
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              aria-label={`Détail de la candidature de ${name}`}
              className="shrink-0 max-md:h-11 max-md:w-11"
            >
              <ChevronDown className={cn('transition-transform duration-150', isExpanded && 'rotate-180')} aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isExpanded ? 'Masquer le détail' : 'Afficher le détail'}</TooltipContent>
        </Tooltip>
      </div>

      {isExpanded && (
        <div id={detailsId} className="mt-4 border-t border-border pt-4">
          {milestones.length > 0 ? (
            <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              {milestones.map((m) => (
                <div key={m.label}>
                  <dt className="mb-1 text-xs text-muted-foreground">{m.label}</dt>
                  <dd className="text-foreground">{m.date}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Aucune date d'étape enregistrée.</p>
          )}

          {entry.presentiComments && (
            <div className="mt-4">
              <p className="mb-1 text-xs text-muted-foreground">Commentaires</p>
              <p className="text-sm text-foreground-secondary">{entry.presentiComments}</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
};
