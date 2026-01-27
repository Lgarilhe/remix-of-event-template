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
        className="bg-white rounded-lg border border-[#1A1A1A]/10 p-3 hover:shadow-md transition-shadow cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-[#1A1A1A] truncate">
              {candidate?.name || entry.name}
            </h4>
            {candidate?.expertise && candidate.expertise.length > 0 && (
              <p className="text-xs text-[#1A1A1A]/60 truncate">
                {candidate.expertise.slice(0, 2).join(', ')}
              </p>
            )}
          </div>
          {entry.entity && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              entry.entity === 'Konekt' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
            }`}>
              {entry.entity}
            </span>
          )}
        </div>

        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-[#1A1A1A]/10 space-y-2">
            {candidate?.email && (
              <a
                href={`mailto:${candidate.email}`}
                className="flex items-center gap-2 text-xs text-[#1A1A1A]/70 hover:text-[#1A1A1A]"
                onClick={e => e.stopPropagation()}
              >
                <Mail className="w-3 h-3" />
                {candidate.email}
              </a>
            )}
            {candidate?.phone && (
              <a
                href={`tel:${candidate.phone}`}
                className="flex items-center gap-2 text-xs text-[#1A1A1A]/70 hover:text-[#1A1A1A]"
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
                className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-700"
                onClick={e => e.stopPropagation()}
              >
                <Linkedin className="w-3 h-3" />
                LinkedIn
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {entry.presentiComments && (
              <p className="text-xs text-[#1A1A1A]/60 italic mt-2">
                "{entry.presentiComments}"
              </p>
            )}
            {entry.cvPresentationDate && (
              <p className="text-xs text-[#1A1A1A]/50 flex items-center gap-1">
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
    <div className="bg-white rounded-lg border border-[#1A1A1A]/10 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-semibold text-[#1A1A1A]">
              {candidate?.name || entry.name}
            </h3>
            {entry.stage && (
              <span className="text-xs px-2 py-1 rounded bg-[#1A1A1A]/5 text-[#1A1A1A]/70">
                {entry.stage}
              </span>
            )}
            {entry.entity && (
              <span className={`text-xs px-2 py-1 rounded-full ${
                entry.entity === 'Konekt' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
              }`}>
                {entry.entity}
              </span>
            )}
          </div>

          {candidate?.expertise && candidate.expertise.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {candidate.expertise.map(exp => (
                <span key={exp} className="text-xs px-2 py-0.5 bg-[#1A1A1A]/5 rounded">
                  {exp}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 text-sm text-[#1A1A1A]/60">
            {candidate?.email && (
              <a
                href={`mailto:${candidate.email}`}
                className="flex items-center gap-1 hover:text-[#1A1A1A]"
              >
                <Mail className="w-4 h-4" />
                {candidate.email}
              </a>
            )}
            {candidate?.phone && (
              <a
                href={`tel:${candidate.phone}`}
                className="flex items-center gap-1 hover:text-[#1A1A1A]"
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
                className="flex items-center gap-1 text-blue-600 hover:text-blue-700"
              >
                <Linkedin className="w-4 h-4" />
                LinkedIn
              </a>
            )}
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-2 text-[#1A1A1A]/40 hover:text-[#1A1A1A]"
        >
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-[#1A1A1A]/10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {entry.preQualifDate && (
              <div>
                <p className="text-[#1A1A1A]/50 text-xs mb-1">Pré-qualif</p>
                <p className="text-[#1A1A1A]">{formatDate(entry.preQualifDate)}</p>
              </div>
            )}
            {entry.cvPresentationDate && (
              <div>
                <p className="text-[#1A1A1A]/50 text-xs mb-1">CV présenté</p>
                <p className="text-[#1A1A1A]">{formatDate(entry.cvPresentationDate)}</p>
              </div>
            )}
            {entry.managerReturnDate && (
              <div>
                <p className="text-[#1A1A1A]/50 text-xs mb-1">Retour manager</p>
                <p className="text-[#1A1A1A]">{formatDate(entry.managerReturnDate)}</p>
              </div>
            )}
            {entry.offerValidationDate && (
              <div>
                <p className="text-[#1A1A1A]/50 text-xs mb-1">Offre validée</p>
                <p className="text-[#1A1A1A]">{formatDate(entry.offerValidationDate)}</p>
              </div>
            )}
          </div>

          {entry.presentiComments && (
            <div className="mt-4">
              <p className="text-[#1A1A1A]/50 text-xs mb-1">Commentaires</p>
              <p className="text-sm text-[#1A1A1A]/80">{entry.presentiComments}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
