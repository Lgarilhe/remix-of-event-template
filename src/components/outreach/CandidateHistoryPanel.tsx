import React from 'react';
import { CandidateHistoryData } from '@/hooks/useCandidateHistory';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Loader2,
  Star,
  Trophy,
  FileText,
  Calendar,
  Building2,
  Briefcase,
  ChevronDown,
  Mail,
  Phone,
  Clock,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import airtableLogo from '@/assets/airtable-logo.svg';

interface CandidateHistoryPanelProps {
  data: CandidateHistoryData | null;
  loading: boolean;
  compact?: boolean; // For inline display in search results
}

export const CandidateHistoryPanel: React.FC<CandidateHistoryPanelProps> = ({
  data,
  loading,
  compact = false,
}) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 justify-center text-muted-foreground text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Chargement historique…</span>
      </div>
    );
  }

  if (!data) return null;

  const hasHistory = data.shortlists.length > 0 || data.placements.length > 0 || data.notes.length > 0 || data.appointments.length > 0;

  if (!hasHistory && !data.candidate) return null;

  // Compact mode: just show summary badges
  if (compact) {
    return <CompactHistory data={data} />;
  }

  return (
    <div className="border-t border-border/50">
      <div className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-center gap-2">
          <img src={airtableLogo} alt="" className="w-4 h-4" />
          <span className="text-xs font-semibold text-foreground">Historique candidat</span>
          {data.candidate?.status && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
              {data.candidate.status}
            </Badge>
          )}
        </div>

        {/* Contact info */}
        {(data.candidate?.email || data.candidate?.phone) && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {data.candidate.email && (
              <span className="flex items-center gap-1">
                <Mail className="w-3 h-3" />
                {data.candidate.email}
              </span>
            )}
            {data.candidate.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" />
                {data.candidate.phone}
              </span>
            )}
          </div>
        )}

        {/* Placements */}
        {data.placements.length > 0 && (
          <HistorySection
            icon={<Trophy className="w-3.5 h-3.5 text-amber-500" />}
            title="Placements"
            count={data.placements.length}
            color="amber"
          >
            {data.placements.map((p, i) => (
              <div key={i} className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
                <Building2 className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">{p.name || 'Placement'}</p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                    {p.company_name && <span>{p.company_name}</span>}
                    {p.status && <Badge variant="outline" className="text-[9px] h-3.5 px-1">{p.status}</Badge>}
                    {p.start_date && <span>{p.start_date}</span>}
                    {p.salary && <span className="text-emerald-600 font-medium">{p.salary}</span>}
                  </div>
                </div>
              </div>
            ))}
          </HistorySection>
        )}

        {/* Shortlists */}
        {data.shortlists.length > 0 && (
          <HistorySection
            icon={<Star className="w-3.5 h-3.5 text-blue-500" />}
            title="Shortlists"
            count={data.shortlists.length}
            color="blue"
          >
            {data.shortlists.map((s, i) => (
              <div key={i} className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
                <Briefcase className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">
                    {s.job_title || 'Poste non spécifié'}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                    {s.company_name && <span>{s.company_name}</span>}
                    {s.status && <Badge variant="outline" className="text-[9px] h-3.5 px-1">{s.status}</Badge>}
                    {s.date_added && <span>{s.date_added}</span>}
                    {s.salary_proposed && <span className="text-emerald-600 font-medium">{s.salary_proposed}</span>}
                  </div>
                </div>
              </div>
            ))}
          </HistorySection>
        )}

        {/* Appointments */}
        {data.appointments.length > 0 && (
          <HistorySection
            icon={<Calendar className="w-3.5 h-3.5 text-purple-500" />}
            title="Rendez-vous"
            count={data.appointments.length}
            color="purple"
          >
            {data.appointments.map((a, i) => (
              <div key={i} className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
                <Clock className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">{a.title || a.appointment_type || 'RDV'}</p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                    {a.appointment_date && <span>{a.appointment_date}</span>}
                    {a.status && <Badge variant="outline" className="text-[9px] h-3.5 px-1">{a.status}</Badge>}
                  </div>
                </div>
              </div>
            ))}
          </HistorySection>
        )}

        {/* Notes */}
        {data.notes.length > 0 && (
          <HistorySection
            icon={<FileText className="w-3.5 h-3.5 text-teal-500" />}
            title="Notes"
            count={data.notes.length}
            color="teal"
          >
            {data.notes.slice(0, 5).map((n, i) => (
              <div key={i} className="py-1.5 border-b border-border/30 last:border-0">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-0.5">
                  {n.author && (
                    <span className="flex items-center gap-0.5">
                      <User className="w-2.5 h-2.5" />
                      {n.author}
                    </span>
                  )}
                  {n.note_date && <span>{n.note_date}</span>}
                  {n.note_type && <Badge variant="outline" className="text-[9px] h-3.5 px-1">{n.note_type}</Badge>}
                </div>
                {n.title && <p className="text-xs font-medium text-foreground">{n.title}</p>}
                {n.detail && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{n.detail}</p>
                )}
              </div>
            ))}
          </HistorySection>
        )}

        {!hasHistory && data.candidate && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Candidat trouvé dans Airtable mais aucun historique de shortlist, placement ou note.
          </p>
        )}
      </div>
    </div>
  );
};

// Compact summary for search result cards
const CompactHistory: React.FC<{ data: CandidateHistoryData }> = ({ data }) => {
  const items: React.ReactNode[] = [];

  if (data.placements.length > 0) {
    items.push(
      <Badge key="placements" className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0 h-4 gap-0.5">
        <Trophy className="w-2.5 h-2.5" />
        {data.placements.length} placement{data.placements.length > 1 ? 's' : ''}
      </Badge>
    );
  }

  if (data.shortlists.length > 0) {
    items.push(
      <Badge key="shortlists" variant="outline" className="border-blue-200 bg-blue-50 text-blue-600 text-[10px] px-1.5 py-0 h-4 gap-0.5">
        <Star className="w-2.5 h-2.5" />
        {data.shortlists.length} shortlist{data.shortlists.length > 1 ? 's' : ''}
      </Badge>
    );
  }

  if (data.appointments.length > 0) {
    items.push(
      <Badge key="rdv" variant="outline" className="border-purple-200 bg-purple-50 text-purple-600 text-[10px] px-1.5 py-0 h-4 gap-0.5">
        <Calendar className="w-2.5 h-2.5" />
        {data.appointments.length} RDV
      </Badge>
    );
  }

  if (data.notes.length > 0) {
    items.push(
      <Badge key="notes" variant="outline" className="border-teal-200 bg-teal-50 text-teal-600 text-[10px] px-1.5 py-0 h-4 gap-0.5">
        <FileText className="w-2.5 h-2.5" />
        {data.notes.length} note{data.notes.length > 1 ? 's' : ''}
      </Badge>
    );
  }

  if (items.length === 0) return null;

  return <div className="flex items-center gap-1 flex-wrap">{items}</div>;
};

// Collapsible section
const HistorySection: React.FC<{
  icon: React.ReactNode;
  title: string;
  count: number;
  color: string;
  children: React.ReactNode;
}> = ({ icon, title, count, color, children }) => {
  const [open, setOpen] = React.useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-left py-1 hover:bg-accent/30 rounded px-1 -mx-1 transition-colors">
        {icon}
        <span className="text-xs font-medium text-foreground flex-1">{title}</span>
        <span className="text-[10px] text-muted-foreground">{count}</span>
        <ChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-5">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
};
