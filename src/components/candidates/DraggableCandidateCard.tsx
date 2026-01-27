import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ShortlistEntry } from '@/pages/Candidates';
import { Mail, Phone, Linkedin, Calendar, GripVertical, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface DraggableCandidateCardProps {
  entry: ShortlistEntry;
  columnId: string;
}

export const DraggableCandidateCard: React.FC<DraggableCandidateCardProps> = ({ entry, columnId }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const candidate = entry.candidate;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ 
    id: entry.id,
    data: {
      type: 'card',
      columnId,
      entry,
    }
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      return format(new Date(dateStr), 'dd MMM yyyy', { locale: fr });
    } catch {
      return dateStr;
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white rounded-lg border border-[#1A1A1A]/10 p-3 hover:shadow-md transition-shadow ${
        isDragging ? 'shadow-lg z-50' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-1 p-1 text-[#1A1A1A]/30 hover:text-[#1A1A1A]/60 cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Content */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
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
              <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
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
      </div>
    </div>
  );
};
