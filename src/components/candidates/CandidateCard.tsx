import React, { useState } from 'react';
import { ShortlistEntry } from '@/pages/Candidates';
import { Mail, Phone, Linkedin, Calendar, Building2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface CandidateCardProps {
  entry: ShortlistEntry;
  compact?: boolean;
}

export const CandidateCard: React.FC<CandidateCardProps> = ({ entry, compact = false }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const candidate = entry.candidate;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      return format(new Date(dateStr), 'dd MMM yyyy', { locale: fr });
    } catch {
      return dateStr;
    }
  };

  if (compact) {
    return (
      <div
        className="bg-background border border-border p-3 hover:shadow-md transition-shadow cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-foreground truncate">
              {candidate?.name || entry.name}
            </h4>
            {candidate?.expertise && candidate.expertise.length > 0 && (
              <p className="text-xs text-muted-foreground truncate">
                {candidate.expertise.slice(0, 2).join(', ')}
              </p>
            )}
          </div>
          {entry.entity && (
            <span className={`text-xs px-2 py-0.5 ${
              entry.entity === 'Konekt' ? 'bg-success/10 text-success' : 'bg-brand-purple/10 text-brand-purple'
            }`}>
              {entry.entity}
            </span>
          )}
        </div>

        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-border space-y-2">
            {candidate?.email && (
              <a
                href={`mailto:${candidate.email}`}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={e => e.stopPropagation()}
              >
                <Mail className="w-3 h-3" />
                {candidate.email}
              </a>
            )}
            {candidate?.phone && (
              <a
                href={`tel:${candidate.phone}`}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={e => e.stopPropagation()}
              >
                <Phone className="w-3 h-3" />
                {candidate.phone}
              </a>
            )}
            {candidate?.linkedin && (
              <a
                href={candidate.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-info hover:text-info/80"
                onClick={e => e.stopPropagation()}
              >
                <Linkedin className="w-3 h-3" />
                LinkedIn
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {entry.presentiComments && (
              <p className="text-xs text-muted-foreground italic mt-2">
                "{entry.presentiComments}"
              </p>
            )}
            {entry.cvPresentationDate && (
              <p className="text-xs text-muted-foreground/70 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                CV présenté: {formatDate(entry.cvPresentationDate)}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // Full card for list view
  return (
    <div className="bg-background border border-border p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-semibold text-foreground">
              {candidate?.name || entry.name}
            </h3>
            {entry.stage && (
              <span className="text-xs px-2 py-1 bg-muted text-muted-foreground border border-border">
                {entry.stage}
              </span>
            )}
            {entry.entity && (
              <span className={`text-xs px-2 py-1 ${
                entry.entity === 'Konekt' ? 'bg-success/10 text-success' : 'bg-brand-purple/10 text-brand-purple'
              }`}>
                {entry.entity}
              </span>
            )}
          </div>

          {candidate?.expertise && candidate.expertise.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {candidate.expertise.map(exp => (
                <span key={exp} className="text-xs px-2 py-0.5 bg-muted text-muted-foreground">
                  {exp}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {candidate?.email && (
              <a
                href={`mailto:${candidate.email}`}
                className="flex items-center gap-1 hover:text-foreground"
              >
                <Mail className="w-4 h-4" />
                {candidate.email}
              </a>
            )}
            {candidate?.phone && (
              <a
                href={`tel:${candidate.phone}`}
                className="flex items-center gap-1 hover:text-foreground"
              >
                <Phone className="w-4 h-4" />
                {candidate.phone}
              </a>
            )}
            {candidate?.linkedin && (
              <a
                href={candidate.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-info hover:text-info/80"
              >
                <Linkedin className="w-4 h-4" />
                LinkedIn
              </a>
            )}
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-2 text-muted-foreground hover:text-foreground"
        >
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {entry.preQualifDate && (
              <div>
                <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wider">Pré-qualif</p>
                <p className="text-foreground">{formatDate(entry.preQualifDate)}</p>
              </div>
            )}
            {entry.cvPresentationDate && (
              <div>
                <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wider">CV présenté</p>
                <p className="text-foreground">{formatDate(entry.cvPresentationDate)}</p>
              </div>
            )}
            {entry.managerReturnDate && (
              <div>
                <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wider">Retour manager</p>
                <p className="text-foreground">{formatDate(entry.managerReturnDate)}</p>
              </div>
            )}
            {entry.offerValidationDate && (
              <div>
                <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wider">Offre validée</p>
                <p className="text-foreground">{formatDate(entry.offerValidationDate)}</p>
              </div>
            )}
          </div>

          {entry.presentiComments && (
            <div className="mt-4">
              <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wider">Commentaires</p>
              <p className="text-sm text-foreground/80">{entry.presentiComments}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
