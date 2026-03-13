import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Briefcase, Building2, MapPin, FileText, Link2, ChevronUp, ChevronDown, X, ClipboardList, Users, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

interface JobInfo {
  jobTitle: string | null;
  clientName: string | null;
  description: string | null;
  notes: string | null;
  calendlyLink: string | null;
  filtersSnapshot: any;
  status: string | null;
  createdAt: string | null;
  // From notion/airtable
  city: string | null;
  contractType: string | null;
  salary: string | null;
  criteria: string | null;
  companyDescription: string | null;
}

interface JobDetailDrawerProps {
  jobId: string | null;
  open: boolean;
  onClose: () => void;
}

export function JobDetailDrawer({ jobId, open, onClose }: JobDetailDrawerProps) {
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState<'overview' | 'criteria' | 'notes'>('overview');

  useEffect(() => {
    if (!jobId || !open) return;
    const load = async () => {
      setLoading(true);
      const info: JobInfo = {
        jobTitle: null, clientName: null, description: null, notes: null,
        calendlyLink: null, filtersSnapshot: null, status: null, createdAt: null,
        city: null, contractType: null, salary: null, criteria: null, companyDescription: null,
      };

      // Fetch sourcing project data
      const { data: proj } = await supabase
        .from('sourcing_projects')
        .select('*')
        .eq('job_id', jobId)
        .limit(1)
        .maybeSingle();

      if (proj) {
        info.jobTitle = proj.job_title;
        info.clientName = proj.client_name;
        info.description = proj.description;
        info.notes = proj.notes;
        info.calendlyLink = proj.calendly_link;
        info.filtersSnapshot = proj.filters_snapshot;
        info.status = proj.status;
        info.createdAt = proj.created_at;
      }

      // Try to enrich from airtable_jobs
      const { data: atJob } = await supabase
        .from('airtable_jobs')
        .select('title, city, contract_type, salary, criteria, description')
        .eq('airtable_id', jobId)
        .limit(1)
        .maybeSingle();

      if (atJob) {
        if (!info.jobTitle) info.jobTitle = atJob.title;
        info.city = atJob.city;
        info.contractType = atJob.contract_type;
        info.salary = atJob.salary;
        info.criteria = atJob.criteria;
        if (!info.description) info.description = atJob.description;
      }

      setJobInfo(info);
      setLoading(false);
    };
    load();
  }, [jobId, open]);

  if (!open) return null;

  const filters = jobInfo?.filtersSnapshot as any;
  const filterKeywords = filters?.keywords || filters?.keyword || null;
  const filterLocation = filters?.location || filters?.geo || null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 bg-background border-t-2 border-foreground shadow-[0_-4px_20px_rgba(0,0,0,0.15)] max-h-[55vh] flex flex-col animate-in slide-in-from-bottom duration-200">
      {/* Header */}
      <div className="shrink-0 border-b border-foreground/10">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-3">
          {loading ? (
            <div className="flex items-center gap-2 py-3">
              <div className="w-4 h-4 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
              <span className="text-[11px] text-muted-foreground">Chargement du poste…</span>
            </div>
          ) : (
            <>
              {/* Job identity */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                    {jobInfo?.jobTitle || 'Poste non spécifié'}
                  </h3>
                  {jobInfo?.clientName && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Building2 className="w-3 h-3" /> {jobInfo.clientName}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {(jobInfo?.city || (typeof filterLocation === 'string' && filterLocation)) && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <MapPin className="w-3 h-3" /> {jobInfo?.city || filterLocation}
                      </span>
                    )}
                    {jobInfo?.contractType && (
                      <span className="text-[10px] text-muted-foreground">{jobInfo.contractType}</span>
                    )}
                    {jobInfo?.salary && (
                      <span className="text-[10px] text-muted-foreground">{jobInfo.salary}</span>
                    )}
                    {jobInfo?.status && (
                      <span className="text-[10px] px-1.5 py-0.5 border border-foreground/15 font-medium uppercase tracking-wider">
                        {jobInfo.status}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {jobInfo?.calendlyLink && (
                    <a href={jobInfo.calendlyLink} target="_blank" rel="noopener noreferrer"
                      className="h-7 px-2.5 flex items-center gap-1 border border-foreground text-foreground text-[9px] font-bold uppercase tracking-wider hover:bg-foreground hover:text-background transition-colors">
                      <CalendarDays className="w-3 h-3" /> Calendly
                    </a>
                  )}
                  <button onClick={onClose}
                    className="h-7 w-7 flex items-center justify-center border border-foreground/20 text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Section nav */}
              <div className="flex gap-0">
                {([
                  { key: 'overview' as const, label: 'Overview', icon: FileText },
                  { key: 'criteria' as const, label: 'Criteria', icon: ClipboardList },
                  { key: 'notes' as const, label: 'Notes', icon: Users },
                ] as const).map(tab => (
                  <button key={tab.key} onClick={() => setSection(tab.key)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-colors -mr-px",
                      section === tab.key
                        ? "bg-foreground text-background border-foreground"
                        : "border-foreground/20 text-muted-foreground hover:border-foreground/40"
                    )}>
                    <tab.icon className="w-3 h-3" />
                    {tab.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-4">
          {loading ? null : !jobInfo ? (
            <p className="text-[11px] text-muted-foreground py-4 text-center">Aucune information disponible pour ce poste</p>
          ) : (
            <>
              {/* Overview */}
              {section === 'overview' && (
                <div className="space-y-4">
                  {jobInfo.description ? (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Description</p>
                      <p className="text-[11px] text-foreground leading-relaxed whitespace-pre-line">{jobInfo.description}</p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground py-2 text-center">Aucune description disponible</p>
                  )}

                  {/* Search filters summary */}
                  {filters && typeof filters === 'object' && Object.keys(filters).length > 0 && (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Filtres de recherche</p>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(filters).map(([key, value]) => {
                          if (!value || (Array.isArray(value) && value.length === 0)) return null;
                          const display = Array.isArray(value) ? (value as string[]).join(', ') : String(value);
                          if (display.length > 100) return null;
                          return (
                            <span key={key} className="px-2 py-1 border border-foreground/15 text-[10px] text-muted-foreground">
                              <span className="font-semibold text-foreground">{key}:</span> {display}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {jobInfo.companyDescription && (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Société</p>
                      <p className="text-[11px] text-foreground leading-relaxed whitespace-pre-line">{jobInfo.companyDescription}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Criteria */}
              {section === 'criteria' && (
                <div className="space-y-4">
                  {jobInfo.criteria ? (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Critères du poste</p>
                      <p className="text-[11px] text-foreground leading-relaxed whitespace-pre-line">{jobInfo.criteria}</p>
                    </div>
                  ) : filters && typeof filters === 'object' ? (
                    <div className="space-y-3">
                      {filterKeywords && (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Mots-clés recherchés</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(Array.isArray(filterKeywords) ? filterKeywords : [filterKeywords]).map((kw: string, i: number) => (
                              <span key={i} className="px-2.5 py-1 border border-foreground/15 text-[10px] font-medium text-muted-foreground">
                                {kw}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {filters.years_of_experience && (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Expérience requise</p>
                          <p className="text-[11px] text-foreground">
                            {typeof filters.years_of_experience === 'object'
                              ? `${filters.years_of_experience.min || 0}–${filters.years_of_experience.max || '∞'} ans`
                              : `${filters.years_of_experience} ans`}
                          </p>
                        </div>
                      )}
                      {(filters.skills || filters.required_skills) && (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Compétences</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(filters.skills || filters.required_skills || []).map((s: string, i: number) => (
                              <span key={i} className="px-2.5 py-1 border border-foreground/15 text-[10px] font-medium text-foreground">
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {!filterKeywords && !filters.years_of_experience && !filters.skills && !filters.required_skills && (
                        <p className="text-[11px] text-muted-foreground py-2 text-center">Aucun critère spécifique défini</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground py-4 text-center">Aucun critère disponible</p>
                  )}
                </div>
              )}

              {/* Notes */}
              {section === 'notes' && (
                <div>
                  {jobInfo.notes ? (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Notes du projet</p>
                      <p className="text-[11px] text-foreground leading-relaxed whitespace-pre-line">{jobInfo.notes}</p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground py-4 text-center">Aucune note pour ce poste</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
