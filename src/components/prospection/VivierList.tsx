import React, { useEffect, useState, useMemo } from 'react';
import { useVivierContacts, useVivierCompanies, VivierContact, VivierCompany } from '@/hooks/useVivierCandidates';
import { useVivierEnrichment, VivierEnrichment } from '@/hooks/useVivierEnrichment';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Search, Mail, Building2, ChevronLeft, ChevronRight, Users, FileText, Trophy, MapPin, Briefcase, Sparkles, Copy, Check, ExternalLink, Phone, RefreshCw, ArrowRightLeft, Clock, MessageSquare, UserCheck, TrendingUp, Calendar, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

/* ─── Section Header ─── */
function SectionHeader({ emoji, label, count }: { emoji: string; label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-sm">{emoji}</span>
      <span className="text-[10px] font-bold uppercase tracking-widest text-foreground">{label}</span>
      {count !== undefined && (
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{count}</span>
      )}
    </div>
  );
}

/* ─── Stat Block ─── */
function StatBlock({ value, label, highlight }: { value: number; label: string; highlight?: boolean }) {
  return (
    <div className={cn(
      "border p-3 text-center transition-colors",
      highlight ? "border-foreground bg-foreground text-background" : "border-border bg-muted/30"
    )}>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-current opacity-60 mt-0.5">{label}</div>
    </div>
  );
}

/* ─── Company Detail Sheet ─── */
function CompanyDetailSheet({ company, open, onOpenChange }: { company: VivierCompany | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [contacts, setContacts] = useState<any[]>([]);
  const [shortlists, setShortlists] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    if (!company || !open) return;
    setLoadingDetails(true);
    const fetch = async () => {
      const [ctRes, slRes] = await Promise.all([
        supabase.from('airtable_contacts').select('airtable_id, full_name, email, title, contact_type, city')
          .eq('company_airtable_id', company.company_airtable_id).limit(30),
        supabase.from('airtable_shortlists').select('airtable_id, status, date_added, job_airtable_id, candidate_airtable_id')
          .eq('company_airtable_id', company.company_airtable_id).order('date_added', { ascending: false }).limit(20),
      ]);
      setContacts(ctRes.data || []);
      const jobIds = new Set<string>();
      const candIds = new Set<string>();
      (slRes.data || []).forEach((s: any) => { if (s.job_airtable_id) jobIds.add(s.job_airtable_id); if (s.candidate_airtable_id) candIds.add(s.candidate_airtable_id); });
      const [jobsRes, candsRes] = await Promise.all([
        jobIds.size > 0 ? supabase.from('airtable_jobs').select('airtable_id, title').in('airtable_id', [...jobIds]) : Promise.resolve({ data: [] as any[] }),
        candIds.size > 0 ? supabase.from('airtable_candidates').select('airtable_id, full_name').in('airtable_id', [...candIds]) : Promise.resolve({ data: [] as any[] }),
      ]);
      const jobMap = new Map((jobsRes.data || []).map((j: any) => [j.airtable_id, j.title]));
      const candMap = new Map((candsRes.data || []).map((c: any) => [c.airtable_id, c.full_name]));
      setShortlists((slRes.data || []).map((s: any) => ({
        ...s,
        job_title: s.job_airtable_id ? jobMap.get(s.job_airtable_id) || null : null,
        candidate_name: s.candidate_airtable_id ? candMap.get(s.candidate_airtable_id) || null : null,
      })));
      setLoadingDetails(false);
    };
    fetch();
  }, [company, open]);

  if (!company) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0 border-l-2 border-foreground">
        {/* Hero header */}
        <div className="bg-foreground text-background p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 border-2 border-background/30 flex items-center justify-center text-lg font-bold uppercase shrink-0">
              {(company.company_name || '??').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <SheetHeader className="p-0">
                <SheetTitle className="text-left text-background text-lg font-bold leading-tight">
                  {company.company_name || 'Société'}
                </SheetTitle>
              </SheetHeader>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-background/60">
                {company.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {company.city}</span>}
                {company.headcount && <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {company.headcount}</span>}
              </div>
              {company.source_base && (
                <div className="mt-2">
                  <span className="text-[9px] uppercase tracking-widest px-2 py-0.5 border border-background/20 text-background/50">{company.source_base}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-5">
          {company.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">{company.description}</p>
          )}

          <div className="grid grid-cols-4 gap-1.5">
            <StatBlock value={company.contact_count} label="Contacts" />
            <StatBlock value={company.shortlist_count} label="Shortlists" highlight={company.shortlist_count >= 10} />
            <StatBlock value={company.placement_count} label="Placements" highlight={company.placement_count > 0} />
            <StatBlock value={company.note_count} label="Notes" />
          </div>

          <EngagementBar shortlists={company.shortlist_count} placements={company.placement_count} notes={company.note_count} contacts={company.contact_count} />

          {loadingDetails ? (
            <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
          ) : (
            <>
              {contacts.length > 0 && (
                <div>
                  <SectionHeader emoji="👤" label="Contacts" count={contacts.length} />
                  <div className="space-y-1">
                    {contacts.map((ct: any) => (
                      <div key={ct.airtable_id} className="border border-border p-3 flex items-center gap-3 hover:bg-muted/30 transition-colors group">
                        <div className="h-8 w-8 bg-muted flex items-center justify-center text-[10px] font-bold shrink-0 uppercase text-foreground">
                          {(ct.full_name || '??').split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate">{ct.full_name || 'Sans nom'}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {ct.title}{ct.title && ct.email && ' · '}{ct.email}
                          </div>
                        </div>
                        {ct.contact_type && (
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1.5 py-0.5 shrink-0">{ct.contact_type}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {shortlists.length > 0 && (
                <div>
                  <SectionHeader emoji="📋" label="Shortlists" count={shortlists.length} />
                  <div className="space-y-1">
                    {shortlists.map((s: any) => (
                      <div key={s.airtable_id} className="border border-border p-3 space-y-1">
                        <div className="text-xs font-semibold">{s.job_title || 'Poste inconnu'}</div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          {s.candidate_name && <span>👤 {s.candidate_name}</span>}
                          {s.date_added && <span>· {relativeTime(s.date_added) || s.date_added}</span>}
                          {s.status && (
                            <span className="border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider">{s.status}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─── Detail Tab Button ─── */
function DetailTab({ active, emoji, label, count, onClick }: { active: boolean; emoji: string; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative overflow-hidden flex items-center gap-1 h-[30px] px-2.5 text-[9px] font-medium uppercase tracking-wider border border-foreground transition-colors group shrink-0",
        active ? "bg-foreground text-background" : "bg-background text-foreground"
      )}
    >
      <span className="text-xs relative z-10">{emoji}</span>
      <span className="relative z-10 whitespace-nowrap">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={cn(
          "relative z-10 text-[8px] tabular-nums font-bold ml-0.5",
          active ? "text-background/60" : "text-muted-foreground"
        )}>{count}</span>
      )}
      {!active && (
        <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
      )}
    </button>
  );
}

/* ─── Timeline Event ─── */
function TimelineEvent({ emoji, title, subtitle, date, highlight }: { emoji: string; title: string; subtitle?: string; date?: string; highlight?: boolean }) {
  return (
    <div className={cn(
      "flex items-start gap-3 p-3 border-l-2 ml-2 transition-colors",
      highlight ? "border-l-foreground bg-muted/20" : "border-l-border"
    )}>
      <span className="text-sm shrink-0 -ml-[22px] bg-background border border-border w-7 h-7 flex items-center justify-center">{emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-foreground leading-snug">{title}</div>
        {subtitle && <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{subtitle}</div>}
      </div>
      {date && <span className="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0 mt-0.5">{relativeTime(date) || date}</span>}
    </div>
  );
}

/* ─── Recruiter Stat Card ─── */
function RecruiterCard({ name, interactions, lastDate, types }: { name: string; interactions: number; lastDate?: string; types: { notes: number; shortlists: number } }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="border border-border p-3 flex items-center gap-3 hover:bg-muted/20 transition-colors">
      <div className="h-9 w-9 bg-foreground text-background flex items-center justify-center text-[10px] font-bold shrink-0 uppercase">{initials}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold">{name}</div>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
          <span className="font-medium tabular-nums">{interactions} interaction{interactions > 1 ? 's' : ''}</span>
          {types.notes > 0 && <span>· 📝 {types.notes}</span>}
          {types.shortlists > 0 && <span>· 📋 {types.shortlists}</span>}
        </div>
      </div>
      {lastDate && <span className="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0">{relativeTime(lastDate)}</span>}
    </div>
  );
}

/* ─── Enriched Contact Detail Sheet (Tabbed) ─── */
function EnrichedContactSheet({ contact, enrichment, open, onOpenChange, onCopyMessage, onEnrichSingle }: {
  contact: VivierContact | null; enrichment: VivierEnrichment | null; open: boolean; onOpenChange: (v: boolean) => void;
  onCopyMessage?: (id: string) => void;
  onEnrichSingle?: (id: string) => void;
}) {
  const [shortlists, setShortlists] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [placements, setPlacements] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<'resume' | 'historique' | 'evolutions' | 'equipe'>('resume');

  useEffect(() => {
    if (!contact || !open) return;
    setLoadingDetails(true);
    setActiveDetailTab('resume');
    const fetchDetails = async () => {
      const [slRes, notesRes, placRes] = await Promise.all([
        supabase.from('airtable_shortlists').select('airtable_id, status, date_added, job_airtable_id, candidate_airtable_id')
          .eq('contact_airtable_id', contact.airtable_id).order('date_added', { ascending: false }).limit(30),
        supabase.from('airtable_notes').select('airtable_id, title, detail, note_type, note_date, author')
          .eq('contact_airtable_id', contact.airtable_id).order('note_date', { ascending: false }).limit(30),
        supabase.from('airtable_placements').select('airtable_id, name, status, start_date, salary, contract_type, candidate_airtable_id, company_airtable_id')
          .eq('company_airtable_id', contact.company_airtable_id || '__none__').order('start_date', { ascending: false }).limit(15),
      ]);
      const jobIds = new Set<string>(); const candIds = new Set<string>();
      (slRes.data || []).forEach((s: any) => { if (s.job_airtable_id) jobIds.add(s.job_airtable_id); if (s.candidate_airtable_id) candIds.add(s.candidate_airtable_id); });
      (placRes.data || []).forEach((p: any) => { if (p.candidate_airtable_id) candIds.add(p.candidate_airtable_id); });
      const [jobsRes, candsRes] = await Promise.all([
        jobIds.size > 0 ? supabase.from('airtable_jobs').select('airtable_id, title').in('airtable_id', [...jobIds]) : Promise.resolve({ data: [] as any[] }),
        candIds.size > 0 ? supabase.from('airtable_candidates').select('airtable_id, full_name').in('airtable_id', [...candIds]) : Promise.resolve({ data: [] as any[] }),
      ]);
      const jobMap = new Map((jobsRes.data || []).map((j: any) => [j.airtable_id, j.title]));
      const candMap = new Map((candsRes.data || []).map((c: any) => [c.airtable_id, c.full_name]));
      setShortlists((slRes.data || []).map((s: any) => ({ ...s, job_title: s.job_airtable_id ? jobMap.get(s.job_airtable_id) || null : null, candidate_name: s.candidate_airtable_id ? candMap.get(s.candidate_airtable_id) || null : null })));
      setNotes(notesRes.data || []);
      setPlacements((placRes.data || []).map((p: any) => ({ ...p, candidate_name: p.candidate_airtable_id ? candMap.get(p.candidate_airtable_id) || null : null })));
      setLoadingDetails(false);
    };
    fetchDetails();
  }, [contact, open]);

  const handleCopy = () => {
    if (enrichment?.generated_message) {
      navigator.clipboard.writeText(enrichment.generated_message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Message copié !');
      onCopyMessage?.(contact!.airtable_id);
    }
  };

  // Compute recruiter stats from notes + shortlists authors
  const recruiterStats = useMemo(() => {
    const map = new Map<string, { notes: number; shortlists: number; lastDate: string | null }>();
    notes.forEach((n: any) => {
      if (!n.author) return;
      const name = n.author.trim();
      const prev = map.get(name) || { notes: 0, shortlists: 0, lastDate: null };
      prev.notes++;
      if (!prev.lastDate || (n.note_date && n.note_date > prev.lastDate)) prev.lastDate = n.note_date;
      map.set(name, prev);
    });
    // Extract authors from shortlists raw_data if available
    return [...map.entries()]
      .map(([name, data]) => ({ name, interactions: data.notes + data.shortlists, lastDate: data.lastDate, types: { notes: data.notes, shortlists: data.shortlists } }))
      .sort((a, b) => b.interactions - a.interactions);
  }, [notes]);

  // Build unified timeline
  const timeline = useMemo(() => {
    const events: { type: string; emoji: string; title: string; subtitle?: string; date: string; highlight?: boolean }[] = [];
    shortlists.forEach((s: any) => {
      events.push({ type: 'shortlist', emoji: '📋', title: s.job_title || 'Shortlist', subtitle: s.candidate_name ? `👤 ${s.candidate_name}` : undefined, date: s.date_added || '', highlight: false });
    });
    notes.forEach((n: any) => {
      events.push({ type: 'note', emoji: '📝', title: n.title || 'Note', subtitle: n.detail?.slice(0, 100), date: n.note_date || '', highlight: false });
    });
    placements.forEach((p: any) => {
      events.push({ type: 'placement', emoji: '🏆', title: p.name || 'Placement', subtitle: p.candidate_name ? `👤 ${p.candidate_name}` : undefined, date: p.start_date || '', highlight: true });
    });
    return events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [shortlists, notes, placements]);

  // Parse Apollo employment history and find role at last interaction date
  const careerAnalysis = useMemo(() => {
    const apolloData = enrichment?.apollo_data;
    const employmentHistory: { title: string; organization_name: string; start_date?: string; end_date?: string; current?: boolean }[] = apolloData?.employment_history || [];
    
    // Find last interaction date — prioritize shortlist dates (most reliable)
    const shortlistDates = shortlists.map((s: any) => s.date_added).filter(Boolean).sort().reverse();
    const noteDates = notes.map((n: any) => n.note_date).filter(Boolean).sort().reverse();
    // Use last shortlist date as primary, fallback to notes
    const lastInteractionDate = shortlistDates[0] || noteDates[0] || null;
    const lastInteractionTs = lastInteractionDate ? new Date(lastInteractionDate).getTime() : null;

    // Find current role (first entry without end_date or marked current)
    const currentRole = employmentHistory.find(e => !e.end_date || e.current) || employmentHistory[0] || null;
    
    // Find role at the time of last interaction
    let roleAtLastInteraction: typeof currentRole = null;
    if (lastInteractionTs && employmentHistory.length > 0) {
      // Exact match: interaction date falls within start–end range
      roleAtLastInteraction = employmentHistory.find(e => {
        const start = e.start_date ? new Date(e.start_date).getTime() : 0;
        const end = e.end_date ? new Date(e.end_date).getTime() : Date.now();
        return start <= lastInteractionTs && lastInteractionTs <= end;
      }) || null;

      // Fallback: find the closest role by start_date if exact match fails
      if (!roleAtLastInteraction) {
        let closestDist = Infinity;
        employmentHistory.forEach(e => {
          if (!e.start_date) return;
          const start = new Date(e.start_date).getTime();
          const dist = Math.abs(start - lastInteractionTs);
          if (dist < closestDist) {
            closestDist = dist;
            roleAtLastInteraction = e;
          }
        });
      }
    }

    // Build career moves between last interaction and now
    const careerMoves: { title: string; company: string; startDate?: string; endDate?: string; isCurrent: boolean }[] = [];
    if (lastInteractionTs) {
      employmentHistory.forEach(e => {
        const start = e.start_date ? new Date(e.start_date).getTime() : 0;
        if (start > lastInteractionTs) {
          careerMoves.push({ title: e.title, company: e.organization_name, startDate: e.start_date, endDate: e.end_date, isCurrent: !e.end_date || !!e.current });
        }
      });
      careerMoves.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    }

    return { employmentHistory, currentRole, roleAtLastInteraction, lastInteractionDate, careerMoves };
  }, [enrichment, shortlists, notes, contact]);

  // Evolution data
  const evolutions = useMemo(() => {
    const items: { emoji: string; title: string; detail: string; type: 'positive' | 'neutral' | 'negative' }[] = [];
    
    const { roleAtLastInteraction, currentRole, careerMoves, lastInteractionDate } = careerAnalysis;
    
    // Career move analysis based on Apollo history
    if (roleAtLastInteraction && currentRole && lastInteractionDate) {
      const sameCompany = roleAtLastInteraction.organization_name === currentRole.organization_name;
      const sameRole = roleAtLastInteraction.title === currentRole.title;
      
      if (!sameCompany) {
        items.push({ 
          emoji: '🔄', 
          title: 'Changement d\'entreprise', 
          detail: `Lors de nos derniers échanges (${relativeTime(lastInteractionDate)}), était ${roleAtLastInteraction.title} chez ${roleAtLastInteraction.organization_name}. Aujourd'hui : ${currentRole.title} chez ${currentRole.organization_name}`, 
          type: 'positive' 
        });
      } else if (!sameRole) {
        items.push({ 
          emoji: '📈', 
          title: 'Évolution interne', 
          detail: `Promotion chez ${currentRole.organization_name} : ${roleAtLastInteraction.title} → ${currentRole.title}`, 
          type: 'positive' 
        });
      } else {
        items.push({ 
          emoji: '🏢', 
          title: 'Même poste', 
          detail: `Toujours ${currentRole.title} chez ${currentRole.organization_name} depuis nos derniers échanges (${relativeTime(lastInteractionDate)})`, 
          type: 'neutral' 
        });
      }

      // Intermediate moves
      if (careerMoves.length > 1) {
        items.push({
          emoji: '🛤️',
          title: `${careerMoves.length} postes entre-temps`,
          detail: careerMoves.map(m => `${m.title} @ ${m.company}`).join(' → '),
          type: 'neutral'
        });
      }
    } else if (enrichment) {
      // Fallback to basic enrichment comparison
      if (enrichment.still_same_company === false && enrichment.company_change_detail) {
        items.push({ emoji: '🔄', title: 'Changement de poste', detail: enrichment.company_change_detail, type: 'positive' });
      }
      if (enrichment.still_same_company === true) {
        items.push({ emoji: '🏢', title: 'Même entreprise', detail: `Toujours chez ${enrichment.current_company || contact?.company_name || '—'}`, type: 'neutral' });
      }
      if (enrichment.current_job_title) {
        items.push({ emoji: '💼', title: 'Poste actuel', detail: `${enrichment.current_job_title}${enrichment.current_company ? ` chez ${enrichment.current_company}` : ''}`, type: 'neutral' });
      }
    }

    // Notable events from AI
    if (enrichment?.notable_events && Array.isArray(enrichment.notable_events) && (enrichment.notable_events as any[]).length > 0) {
      (enrichment.notable_events as any[]).forEach((evt: any) => {
        const evtStr = typeof evt === 'string' ? evt : (evt.title || evt.detail || evt.description || '');
        if (evtStr) items.push({ emoji: '⚡', title: 'Événement notable', detail: evtStr, type: 'neutral' });
      });
    }

    // Location change
    if (enrichment?.location && contact?.city && enrichment.location !== contact.city) {
      items.push({ emoji: '📍', title: 'Changement de localisation', detail: `${contact.city} → ${enrichment.location}`, type: 'neutral' });
    }

    // Time since last interaction
    if (contact?.last_interaction_date) {
      const daysSince = Math.floor((Date.now() - new Date(contact.last_interaction_date).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince > 365) {
        items.push({ emoji: '⏰', title: 'Contact inactif', detail: `Dernier échange il y a ${Math.floor(daysSince / 365)} an${Math.floor(daysSince / 365) > 1 ? 's' : ''} — opportunité de réactivation`, type: 'negative' });
      } else if (daysSince > 180) {
        items.push({ emoji: '⏰', title: 'Contact dormant', detail: `Dernier échange il y a ${Math.floor(daysSince / 30)} mois`, type: 'neutral' });
      }
    }
    return items;
  }, [enrichment, contact, careerAnalysis]);

  if (!contact) return null;

  const isEnriched = !!enrichment && enrichment.match_type !== 'not_found';
  const displayTitle = enrichment?.current_job_title || contact.contact_type || null;
  const displayCompany = enrichment?.current_company || contact.company_name;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0 border-l-2 border-foreground">
        {/* Hero header */}
        <div className="bg-foreground text-background p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className={cn(
              "h-14 w-14 border-2 flex items-center justify-center text-lg font-bold uppercase shrink-0",
              isEnriched ? "border-[hsl(var(--brutal-accent))]" : "border-background/30"
            )}>
              {(contact.full_name || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <SheetHeader className="p-0">
                <SheetTitle className="text-left text-background text-lg font-bold leading-tight">
                  {contact.full_name || 'Sans nom'}
                </SheetTitle>
              </SheetHeader>
              {(displayTitle || displayCompany) && (
                <p className="text-xs text-background/60 mt-1 leading-snug">
                  {displayTitle}{displayTitle && displayCompany && ' · '}{displayCompany}
                </p>
              )}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {contact.email && (
                  <span className="text-[10px] text-background/50 flex items-center gap-1"><Mail className="w-3 h-3" /> {contact.email}</span>
                )}
                {contact.city && (
                  <span className="text-[10px] text-background/50 flex items-center gap-1"><MapPin className="w-3 h-3" /> {contact.city}</span>
                )}
              </div>
              {enrichment?.is_relevant !== null && enrichment?.is_relevant !== undefined && (
                <div className="mt-2.5">
                  <span className={cn(
                    "text-[9px] uppercase tracking-widest px-2 py-1 font-bold",
                    enrichment.is_relevant
                      ? "bg-[hsl(var(--brutal-accent))] text-foreground"
                      : "border border-background/20 text-background/40"
                  )}>
                    {enrichment.is_relevant ? '✓ Pertinent' : '✗ Non pertinent'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-0 border-b border-foreground">
          <div className="p-2.5 text-center border-r border-border">
            <div className="text-lg font-bold tabular-nums">{contact.shortlist_count}</div>
            <div className="text-[8px] uppercase tracking-widest text-muted-foreground">Shortlists</div>
          </div>
          <div className="p-2.5 text-center border-r border-border">
            <div className="text-lg font-bold tabular-nums">{contact.placement_count}</div>
            <div className="text-[8px] uppercase tracking-widest text-muted-foreground">Placements</div>
          </div>
          <div className="p-2.5 text-center border-r border-border">
            <div className="text-lg font-bold tabular-nums">{contact.note_count}</div>
            <div className="text-[8px] uppercase tracking-widest text-muted-foreground">Notes</div>
          </div>
          <div className="p-2.5 text-center">
            <div className="text-lg font-bold tabular-nums">{recruiterStats.length}</div>
            <div className="text-[8px] uppercase tracking-widest text-muted-foreground">Recruteurs</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 overflow-x-auto no-scrollbar border-b border-border bg-muted/20">
          <DetailTab active={activeDetailTab === 'resume'} emoji="📋" label="Résumé" onClick={() => setActiveDetailTab('resume')} />
          <DetailTab active={activeDetailTab === 'historique'} emoji="🕐" label="Historique" count={timeline.length} onClick={() => setActiveDetailTab('historique')} />
          <DetailTab active={activeDetailTab === 'evolutions'} emoji="📈" label="Évolutions" count={evolutions.length} onClick={() => setActiveDetailTab('evolutions')} />
          <DetailTab active={activeDetailTab === 'equipe'} emoji="👥" label="Équipe" count={recruiterStats.length} onClick={() => setActiveDetailTab('equipe')} />
        </div>

        <div className="p-4 sm:p-5">
          {loadingDetails ? (
            <div className="space-y-3"><Skeleton className="h-6 w-full" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-20 w-full" /></div>
          ) : (
            <>
              {/* ═══ TAB: RÉSUMÉ ═══ */}
              {activeDetailTab === 'resume' && (
                <div className="space-y-4">
                  {/* Enrich CTA */}
                  <button
                    onClick={() => onEnrichSingle?.(contact.airtable_id)}
                    className={cn(
                      "w-full h-10 flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-wider border-2 transition-all duration-200",
                      enrichment
                        ? "border-border text-foreground hover:border-foreground hover:bg-muted/30"
                        : "border-foreground bg-foreground text-background hover:bg-foreground/90"
                    )}
                  >
                    {enrichment ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {enrichment ? 'Ré-enrichir & regénérer' : 'Enrichir & générer le message'}
                  </button>

                  {/* Enriched profile card */}
                  {isEnriched && (
                    <div className="border-2 border-[hsl(var(--brutal-accent))] bg-[hsl(var(--brutal-accent)/0.04)]">
                      <div className="px-4 py-2.5 border-b border-[hsl(var(--brutal-accent)/0.2)] flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--skalr-purple))]" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Profil enrichi</span>
                        <span className="ml-auto text-[9px] uppercase tracking-wider border border-border px-1.5 py-0.5 text-muted-foreground">
                          {enrichment!.match_type === 'linkedin' ? 'LinkedIn' : 'Fuzzy'}
                        </span>
                      </div>
                      <div className="p-4 space-y-2.5">
                        {enrichment!.headline && <p className="text-xs text-muted-foreground italic">{enrichment!.headline}</p>}
                        {enrichment!.location && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><MapPin className="w-3 h-3 shrink-0" /> {enrichment!.location}</div>
                        )}
                        {enrichment!.linkedin_url && (
                          <a href={enrichment!.linkedin_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--skalr-purple))] hover:underline">
                            <ExternalLink className="w-3 h-3" /> Voir sur LinkedIn
                          </a>
                        )}
                        {enrichment!.relevance_reason && (
                          <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border/40 pt-2.5 mt-2.5">{enrichment!.relevance_reason}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {enrichment?.match_type === 'not_found' && (
                    <div className="border border-border p-4 text-center">
                      <span className="text-xs text-muted-foreground">Aucun profil trouvé sur Apollo pour ce contact.</span>
                    </div>
                  )}

                  {/* Generated message */}
                  {enrichment?.generated_message && (
                    <div className="border-2 border-foreground">
                      <div className="px-4 py-2.5 border-b border-foreground flex items-center justify-between bg-muted/20">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{enrichment.message_type === 'sms' ? '📱' : '💬'}</span>
                          <span className="text-[10px] font-bold uppercase tracking-widest">
                            {enrichment.message_type === 'sms' ? 'SMS' : 'LinkedIn'}
                          </span>
                          {enrichment.message_status && (
                            <span className="text-[9px] uppercase tracking-wider border border-border px-1.5 py-0.5 text-muted-foreground">{enrichment.message_status}</span>
                          )}
                        </div>
                        <button
                          onClick={handleCopy}
                          className={cn(
                            "h-7 px-3 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider border transition-all",
                            copied ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground"
                          )}
                        >
                          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copied ? 'Copié !' : 'Copier'}
                        </button>
                      </div>
                      <div className="p-4">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{enrichment.generated_message}</p>
                        <div className="mt-3 pt-2.5 border-t border-border/40 text-[9px] text-muted-foreground uppercase tracking-widest">
                          {enrichment.generated_message.length} caractères
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Quick summary: last interaction + top recruiter */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="border border-border p-3">
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Dernier échange</div>
                      <div className="text-xs font-semibold">{contact.last_interaction_date ? relativeTime(contact.last_interaction_date) || contact.last_interaction_date : '—'}</div>
                    </div>
                    <div className="border border-border p-3">
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Top recruteur</div>
                      <div className="text-xs font-semibold">{recruiterStats[0]?.name || '—'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* ═══ TAB: HISTORIQUE ═══ */}
              {activeDetailTab === 'historique' && (
                <div className="space-y-1">
                  {timeline.length === 0 ? (
                    <div className="text-center py-10">
                      <Clock className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                      <p className="text-xs text-muted-foreground">Aucune interaction enregistrée</p>
                    </div>
                  ) : (
                    <>
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-3 font-medium">
                        {timeline.length} interaction{timeline.length > 1 ? 's' : ''} — chronologie complète
                      </div>
                      {timeline.map((evt, i) => (
                        <TimelineEvent key={`${evt.type}-${i}`} emoji={evt.emoji} title={evt.title} subtitle={evt.subtitle} date={evt.date} highlight={evt.highlight} />
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* ═══ TAB: ÉVOLUTIONS ═══ */}
              {activeDetailTab === 'evolutions' && (
                <div className="space-y-3">
                  {evolutions.length === 0 && careerAnalysis.employmentHistory.length === 0 ? (
                    <div className="text-center py-10">
                      <TrendingUp className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                      <p className="text-xs text-muted-foreground">Aucune évolution détectée</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Enrichissez ce contact pour détecter les changements</p>
                    </div>
                  ) : (
                    <>
                      {/* Context: when was last interaction */}
                      {careerAnalysis.lastInteractionDate && (
                        <div className="border-2 border-foreground bg-foreground text-background p-3 flex items-center gap-3">
                          <Clock className="w-5 h-5 shrink-0 text-[hsl(var(--brutal-accent))]" />
                          <div>
                            <div className="text-[9px] uppercase tracking-widest text-background/50">Dernier échange avec Konekt</div>
                            <div className="text-sm font-bold">{relativeTime(careerAnalysis.lastInteractionDate)}</div>
                          </div>
                          {careerAnalysis.roleAtLastInteraction && (
                            <div className="ml-auto text-right">
                              <div className="text-[9px] uppercase tracking-widest text-background/50">Poste à l'époque</div>
                              <div className="text-[11px] font-medium">{careerAnalysis.roleAtLastInteraction.title}</div>
                              <div className="text-[10px] text-background/60">{careerAnalysis.roleAtLastInteraction.organization_name}</div>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1 font-medium">
                        Changements depuis nos derniers échanges
                      </div>
                      {evolutions.map((evo, i) => (
                        <div key={i} className={cn(
                          "border-2 p-4 space-y-1.5",
                          evo.type === 'positive' ? "border-foreground bg-[hsl(var(--brutal-accent)/0.06)]" :
                          evo.type === 'negative' ? "border-destructive/40 bg-destructive/5" :
                          "border-border"
                        )}>
                          <div className="flex items-center gap-2">
                            <span className="text-base">{evo.emoji}</span>
                            <span className="text-xs font-bold uppercase tracking-wider">{evo.title}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed pl-7">{evo.detail}</p>
                        </div>
                      ))}

                      {/* Comparison table: role at last interaction vs now */}
                      {isEnriched && (
                        <div className="mt-4">
                          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-2 font-medium">
                            Comparaison : {careerAnalysis.lastInteractionDate ? `à l'époque vs aujourd'hui` : 'CRM vs aujourd\'hui'}
                          </div>
                          <div className="border border-border divide-y divide-border">
                            <div className="grid grid-cols-3 text-[9px] uppercase tracking-widest text-muted-foreground bg-muted/30">
                              <div className="p-2">Champ</div>
                              <div className="p-2">{careerAnalysis.lastInteractionDate ? `À l'époque` : 'CRM'}</div>
                              <div className="p-2">Aujourd'hui</div>
                            </div>
                            {[
                              { 
                                label: 'Poste', 
                                before: careerAnalysis.roleAtLastInteraction?.title || contact.contact_type || null, 
                                after: careerAnalysis.currentRole?.title || enrichment?.current_job_title 
                              },
                              { 
                                label: 'Entreprise', 
                                before: careerAnalysis.roleAtLastInteraction?.organization_name || contact.company_name, 
                                after: careerAnalysis.currentRole?.organization_name || enrichment?.current_company 
                              },
                              { label: 'Localisation', before: contact.city, after: enrichment?.location },
                            ].filter(r => r.before || r.after).map((row, i) => {
                              const changed = row.before !== row.after && row.before && row.after;
                              return (
                                <div key={i} className={cn("grid grid-cols-3", changed && "bg-[hsl(var(--brutal-accent)/0.04)]")}>
                                  <div className="p-2 text-[10px] font-medium">{row.label}</div>
                                  <div className="p-2 text-[10px] text-muted-foreground">{row.before || '—'}</div>
                                  <div className={cn("p-2 text-[10px]", changed ? "font-semibold text-foreground" : "text-muted-foreground")}>{row.after || '—'}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Full career timeline from Apollo */}
                      {careerAnalysis.employmentHistory.length > 0 && (
                        <div className="mt-4">
                          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-2 font-medium">
                            Parcours professionnel complet (Apollo)
                          </div>
                          <div className="space-y-0">
                            {careerAnalysis.employmentHistory.map((job, i) => {
                              const isCurrent = !job.end_date || job.current;
                              const wasActiveAtLastInteraction = careerAnalysis.roleAtLastInteraction?.title === job.title && careerAnalysis.roleAtLastInteraction?.organization_name === job.organization_name;
                              return (
                                <div key={i} className={cn(
                                  "flex items-start gap-3 p-2.5 border-l-2 ml-2",
                                  isCurrent ? "border-l-foreground bg-muted/20" : 
                                  wasActiveAtLastInteraction ? "border-l-[hsl(var(--brutal-accent))] bg-[hsl(var(--brutal-accent)/0.04)]" :
                                  "border-l-border"
                                )}>
                                  <div className={cn(
                                    "-ml-[11px] w-5 h-5 flex items-center justify-center text-[8px] shrink-0 border",
                                    isCurrent ? "bg-foreground text-background border-foreground" :
                                    wasActiveAtLastInteraction ? "bg-[hsl(var(--brutal-accent))] text-foreground border-[hsl(var(--brutal-accent))]" :
                                    "bg-background text-muted-foreground border-border"
                                  )}>
                                    {isCurrent ? '●' : wasActiveAtLastInteraction ? '◆' : '○'}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[11px] font-semibold leading-snug">{job.title}</div>
                                    <div className="text-[10px] text-muted-foreground">{job.organization_name}</div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <div className="text-[9px] text-muted-foreground">
                                      {job.start_date ? relativeTime(job.start_date) || job.start_date.slice(0, 7) : '?'}
                                    </div>
                                    {isCurrent && <span className="text-[8px] font-bold uppercase tracking-widest text-foreground">Actuel</span>}
                                    {wasActiveAtLastInteraction && !isCurrent && <span className="text-[8px] font-bold uppercase tracking-widest text-[hsl(var(--skalr-purple))]">À l'époque</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ═══ TAB: ÉQUIPE ═══ */}
              {activeDetailTab === 'equipe' && (
                <div className="space-y-3">
                  {recruiterStats.length === 0 ? (
                    <div className="text-center py-10">
                      <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                      <p className="text-xs text-muted-foreground">Aucun recruteur identifié</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Les auteurs des notes et shortlists apparaîtront ici</p>
                    </div>
                  ) : (
                    <>
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1 font-medium">
                        Recruteurs ayant interagi avec ce contact
                      </div>
                      {/* Top recruiter highlight */}
                      {recruiterStats.length > 0 && (
                        <div className="border-2 border-foreground bg-foreground text-background p-4 flex items-center gap-3">
                          <div className="h-12 w-12 border-2 border-background/30 flex items-center justify-center text-sm font-bold uppercase shrink-0">
                            {recruiterStats[0].name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Star className="w-3.5 h-3.5 text-[hsl(var(--brutal-accent))]" />
                              <span className="text-[9px] uppercase tracking-widest text-background/50">Contact principal</span>
                            </div>
                            <div className="text-sm font-bold mt-0.5">{recruiterStats[0].name}</div>
                            <div className="text-[10px] text-background/60 mt-0.5">
                              {recruiterStats[0].interactions} interaction{recruiterStats[0].interactions > 1 ? 's' : ''}
                              {recruiterStats[0].lastDate && ` · Dernier: ${relativeTime(recruiterStats[0].lastDate)}`}
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Other recruiters */}
                      {recruiterStats.slice(1).map((r, i) => (
                        <RecruiterCard key={i} name={r.name} interactions={r.interactions} lastDate={r.lastDate || undefined} types={r.types} />
                      ))}

                      {/* Recommendation */}
                      {recruiterStats.length > 0 && (
                        <div className="border border-[hsl(var(--brutal-accent))] bg-[hsl(var(--brutal-accent)/0.06)] p-3 mt-2">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--skalr-purple))]" />
                            <span className="text-[9px] font-bold uppercase tracking-widest">Recommandation</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            {recruiterStats[0].name} est le recruteur le mieux positionné pour reprendre contact.
                            {recruiterStats[0].lastDate && ` Dernier échange : ${relativeTime(recruiterStats[0].lastDate)}.`}
                            {recruiterStats.length > 1 && ` ${recruiterStats[1].name} peut aussi intervenir en support (${recruiterStats[1].interactions} interactions).`}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─── Engagement Heat ─── */
function EngagementBar({ shortlists, placements, notes, contacts }: { shortlists: number; placements: number; notes: number; contacts?: number }) {
  const total = shortlists + placements * 3 + notes;
  const level = total >= 20 ? 4 : total >= 10 ? 3 : total >= 5 ? 2 : total >= 1 ? 1 : 0;
  const labels = ['—', 'Faible', 'Modéré', 'Actif', 'Très actif'];
  const fills = [0, 25, 50, 75, 100];
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1 bg-border overflow-hidden">
        <div
          className={cn(
            "h-full transition-all duration-500",
            level >= 3 ? "bg-foreground" : level >= 2 ? "bg-muted-foreground" : "bg-border"
          )}
          style={{ width: `${fills[level]}%` }}
        />
      </div>
      <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium shrink-0">{labels[level]}</span>
    </div>
  );
}

/* ─── Relative time ─── */
function relativeTime(dateStr: string | null) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Aujourd'hui";
    if (diffDays === 1) return 'Hier';
    if (diffDays < 7) return `il y a ${diffDays}j`;
    if (diffDays < 30) return `il y a ${Math.floor(diffDays / 7)}sem`;
    if (diffDays < 365) return `il y a ${Math.floor(diffDays / 30)}mois`;
    return `il y a ${Math.floor(diffDays / 365)}an${Math.floor(diffDays / 365) > 1 ? 's' : ''}`;
  } catch { return null; }
}

/* ─── Stat Pill ─── */
function StatPill({ icon, value, label, highlight }: { icon: React.ReactNode; value: number; label: string; highlight?: boolean }) {
  if (value === 0) return null;
  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 border text-[10px] font-medium shrink-0",
      highlight ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground"
    )}>
      {icon}
      <span className="font-bold tabular-nums">{value}</span>
      <span className="hidden sm:inline text-muted-foreground">{label}</span>
    </div>
  );
}

/* ─── Shared filter bar ─── */
function VivierFilterBar({ searchInput, setSearchInput, onSearch, filters, updateFilters }: {
  searchInput: string; setSearchInput: (v: string) => void; onSearch: () => void;
  filters: { source_base: string | null; min_shortlists: number }; updateFilters: (p: any) => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <div className="flex-1 min-w-0">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Rechercher…" value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSearch()} className="pl-9 h-9 text-xs border-border/60" />
        </div>
      </div>
      <div className="flex gap-2">
        <Select value={filters.source_base || 'all'} onValueChange={v => updateFilters({ source_base: v === 'all' ? null : v })}>
          <SelectTrigger className="w-[140px] h-9 text-xs border-border/60"><SelectValue placeholder="Base" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les bases</SelectItem>
            <SelectItem value="konekt">Konekt</SelectItem>
            <SelectItem value="konekt_prospect">Konekt Prospect</SelectItem>
          </SelectContent>
        </Select>
        <Select value={String(filters.min_shortlists)} onValueChange={v => updateFilters({ min_shortlists: Number(v) })}>
          <SelectTrigger className="w-[130px] h-9 text-xs border-border/60"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">≥ 1 shortlist</SelectItem>
            <SelectItem value="2">≥ 2 shortlists</SelectItem>
            <SelectItem value="3">≥ 3 shortlists</SelectItem>
            <SelectItem value="5">≥ 5 shortlists</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/* ─── Pagination ─── */
function Pagination({ page, totalPages, goToPage }: { page: number; totalPages: number; goToPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between">
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => goToPage(page - 1)} className="text-xs"><ChevronLeft className="w-3 h-3 mr-1" /> Précédent</Button>
      <span className="text-xs text-muted-foreground">Page {page + 1} / {totalPages}</span>
      <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => goToPage(page + 1)} className="text-xs">Suivant <ChevronRight className="w-3 h-3 ml-1" /></Button>
    </div>
  );
}

/* ─── Company Card ─── */
function CompanyCard({ company, index, onClick }: { company: VivierCompany; index: number; onClick: () => void }) {
  const initials = (company.company_name || '??').slice(0, 2).toUpperCase();
  const timeAgo = relativeTime(company.last_interaction_date);

  return (
    <motion.button
      key={company.company_airtable_id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.025, 0.3), duration: 0.25 }}
      onClick={onClick}
      className="w-full text-left border border-foreground bg-card hover:bg-muted/30 transition-all duration-150 group"
    >
      {/* Top section */}
      <div className="p-3 sm:p-4 space-y-2.5">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="h-10 w-10 sm:h-11 sm:w-11 bg-foreground text-background flex items-center justify-center text-xs sm:text-sm font-bold shrink-0 uppercase">
            {initials}
          </div>

          {/* Name & meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm sm:text-[15px] font-semibold text-foreground leading-tight break-words">
                {company.company_name || 'Sans nom'}
              </h3>
              {timeAgo && (
                <span className="text-[9px] text-muted-foreground shrink-0 uppercase tracking-wider mt-0.5">{timeAgo}</span>
              )}
            </div>
            <div className="flex items-center gap-2.5 mt-1 text-[11px] text-muted-foreground">
              {company.city && (
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {company.city}</span>
              )}
              {company.headcount && (
                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {company.headcount}</span>
              )}
            </div>
          </div>
        </div>

        {/* Stats row — scrollable on mobile */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
          <StatPill icon={<Users className="w-3 h-3" />} value={company.contact_count} label="contacts" />
          <StatPill icon={<FileText className="w-3 h-3" />} value={company.shortlist_count} label="shortlists" highlight={company.shortlist_count >= 10} />
          <StatPill icon={<Trophy className="w-3 h-3" />} value={company.placement_count} label="placements" highlight={company.placement_count > 0} />
          {company.note_count > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground shrink-0">
              📝 {company.note_count}
            </div>
          )}
        </div>

        {/* Engagement bar */}
        <EngagementBar shortlists={company.shortlist_count} placements={company.placement_count} notes={company.note_count} contacts={company.contact_count} />
      </div>
    </motion.button>
  );
}

/* ─── Contact Card ─── */
function ContactCard({ contact, enrichment, index, onClick }: { contact: VivierContact; enrichment?: any; index: number; onClick: () => void }) {
  const initials = (contact.full_name || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const timeAgo = relativeTime(contact.last_interaction_date);
  const displayCompany = enrichment?.current_company || contact.company_name;
  const displayTitle = enrichment?.current_job_title || contact.contact_type || null;
  const isEnriched = !!enrichment && enrichment.match_type !== 'not_found';

  return (
    <motion.button
      key={contact.airtable_id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.025, 0.3), duration: 0.25 }}
      onClick={onClick}
      className="w-full text-left border border-foreground bg-card hover:bg-muted/30 transition-all duration-150 group"
    >
      <div className="p-3 sm:p-4 space-y-2.5">
        <div className="flex items-start gap-3">
          {/* Avatar with enrichment indicator */}
          <div className="relative shrink-0">
            <div className={cn(
              "h-10 w-10 sm:h-11 sm:w-11 flex items-center justify-center text-xs sm:text-sm font-bold uppercase",
              isEnriched ? "bg-foreground text-background" : "bg-muted text-foreground"
            )}>
              {initials}
            </div>
            {enrichment?.is_relevant === true && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-foreground text-background flex items-center justify-center text-[8px]">✓</div>
            )}
            {enrichment?.is_relevant === false && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-muted text-muted-foreground flex items-center justify-center text-[8px]">✗</div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm sm:text-[15px] font-semibold text-foreground leading-tight break-words">
                {contact.full_name || 'Sans nom'}
              </h3>
              {timeAgo && (
                <span className="text-[9px] text-muted-foreground shrink-0 uppercase tracking-wider mt-0.5">{timeAgo}</span>
              )}
            </div>

            {/* Role & company */}
            {(displayTitle || displayCompany) && (
              <div className="mt-0.5 text-[11px] sm:text-xs text-muted-foreground leading-snug">
                {displayTitle && <span className={cn("font-medium", isEnriched && "text-foreground")}>{displayTitle}</span>}
                {displayTitle && displayCompany && <span className="mx-1">·</span>}
                {displayCompany && <span className={cn(isEnriched && "text-foreground")}>{displayCompany}</span>}
              </div>
            )}

            {/* Location + contact info */}
            <div className="flex items-center gap-2.5 mt-1 text-[10px] text-muted-foreground">
              {contact.city && (
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {contact.city}</span>
              )}
              {contact.email && (
                <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> <span className="truncate max-w-[120px]">{contact.email}</span></span>
              )}
            </div>
          </div>
        </div>

        {/* Status badges + stats */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
          {enrichment?.generated_message && (
            <div className="flex items-center gap-1 px-2 py-1 border border-foreground bg-foreground text-background text-[10px] font-medium shrink-0">
              {enrichment.message_type === 'sms' ? '📱' : '💬'} Message prêt
            </div>
          )}
          <StatPill icon={<FileText className="w-3 h-3" />} value={contact.shortlist_count} label="shortlists" highlight={contact.shortlist_count >= 5} />
          <StatPill icon={<Trophy className="w-3 h-3" />} value={contact.placement_count} label="placements" highlight={contact.placement_count > 0} />
          {contact.note_count > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground shrink-0">
              📝 {contact.note_count}
            </div>
          )}
        </div>

        {/* Engagement */}
        <EngagementBar shortlists={contact.shortlist_count} placements={contact.placement_count} notes={contact.note_count} />
      </div>
    </motion.button>
  );
}

/* ─── Companies Tab ─── */
function CompaniesView() {
  const { companies, totalCount, loading, filters, updateFilters, fetchCompanies, page, goToPage, pageSize } = useVivierCompanies();
  const [searchInput, setSearchInput] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<VivierCompany | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => { fetchCompanies(); }, []);

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-3">
      <VivierFilterBar searchInput={searchInput} setSearchInput={setSearchInput} onSearch={() => updateFilters({ search: searchInput })} filters={filters} updateFilters={updateFilters} />

      {!loading && totalCount > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            {totalCount} société{totalCount > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border border-border p-4 space-y-2">
              <div className="flex items-center gap-3">
                <Skeleton className="h-11 w-11" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              </div>
              <Skeleton className="h-1 w-full" />
            </div>
          ))}
        </div>
      ) : companies.length === 0 ? (
        <div className="border border-foreground p-12 text-center">
          <div className="w-14 h-14 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-7 h-7" />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-wider mb-1">Aucune société</h3>
          <p className="text-xs text-muted-foreground">Ajustez vos filtres pour voir des résultats</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {companies.map((c, i) => (
            <CompanyCard
              key={c.company_airtable_id}
              company={c}
              index={i}
              onClick={() => { setSelectedCompany(c); setSheetOpen(true); }}
            />
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} goToPage={goToPage} />
      <CompanyDetailSheet company={selectedCompany} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}

/* ─── Contacts Tab ─── */
function ContactsView() {
  const { contacts, totalCount, loading, filters, updateFilters, fetchContacts, page, goToPage, pageSize } = useVivierContacts();
  const { enrichments, isEnriching, progress, fetchEnrichments, enrichContacts, updateMessageStatus } = useVivierEnrichment();
  const [searchInput, setSearchInput] = useState('');
  const [selectedContact, setSelectedContact] = useState<VivierContact | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [enrichFilter, setEnrichFilter] = useState<'all' | 'relevant' | 'with_message'>('all');

  useEffect(() => { fetchContacts(); }, []);

  useEffect(() => {
    if (contacts.length > 0) {
      fetchEnrichments(contacts.map(c => c.airtable_id));
    }
  }, [contacts]);

  const totalPages = Math.ceil(totalCount / pageSize);

  const handleEnrichAll = (force = false) => {
    const ids = contacts.map(c => c.airtable_id);
    enrichContacts(ids, force);
  };

  const filteredContacts = contacts.filter(c => {
    if (enrichFilter === 'all') return true;
    const e = enrichments.get(c.airtable_id);
    if (enrichFilter === 'relevant') return e?.is_relevant === true;
    if (enrichFilter === 'with_message') return !!e?.generated_message;
    return true;
  });

  const selectedEnrichment = selectedContact ? enrichments.get(selectedContact.airtable_id) || null : null;

  const relevantCount = [...enrichments.values()].filter(e => e.is_relevant).length;
  const messageCount = [...enrichments.values()].filter(e => e.generated_message).length;

  return (
    <div className="space-y-3">
      <VivierFilterBar searchInput={searchInput} setSearchInput={setSearchInput} onSearch={() => updateFilters({ search: searchInput })} filters={filters} updateFilters={updateFilters} />

      {/* Enrichment toolbar */}
      <div className="flex items-center gap-0 overflow-x-auto no-scrollbar">
        <button
          onClick={() => handleEnrichAll(false)}
          disabled={isEnriching || contacts.length === 0}
          className="relative overflow-hidden h-8 px-3 flex items-center gap-1.5 border border-foreground bg-foreground text-background text-[10px] font-medium uppercase tracking-wider group disabled:opacity-30 shrink-0"
        >
          <Sparkles className="w-3 h-3 relative z-10" />
          <span className="relative z-10">{isEnriching ? 'Enrichissement…' : 'Enrichir'}</span>
        </button>
        {enrichments.size > 0 && (
          <button
            onClick={() => handleEnrichAll(true)}
            disabled={isEnriching || contacts.length === 0}
            className="relative overflow-hidden h-8 px-3 flex items-center gap-1.5 border border-foreground border-l-0 text-foreground text-[10px] font-medium uppercase tracking-wider group disabled:opacity-30 shrink-0"
          >
            <RefreshCw className="w-3 h-3 relative z-10" />
            <span className="relative z-10 hidden sm:inline">Ré-enrichir</span>
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          </button>
        )}
        {enrichments.size > 0 && (
          <>
            {(['all', 'relevant', 'with_message'] as const).map((f, idx) => {
              const labels: Record<string, string> = { all: 'Tous', relevant: `✓ ${relevantCount}`, with_message: `💬 ${messageCount}` };
              return (
                <button
                  key={f}
                  onClick={() => setEnrichFilter(f)}
                  className={cn(
                    "h-8 px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground shrink-0 transition-colors",
                    idx === 0 ? "border-l-0 sm:ml-2 sm:border-l" : "border-l-0",
                    enrichFilter === f ? "bg-brutal-accent text-foreground" : "bg-background text-foreground hover:bg-muted"
                  )}
                >
                  {labels[f]}
                </button>
              );
            })}
          </>
        )}
      </div>

      {/* Progress bar */}
      {isEnriching && (
        <div className="space-y-1">
          <div className="h-1 bg-border overflow-hidden">
            <div className="h-full bg-foreground transition-all duration-300" style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
          </div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{progress.done} / {progress.total} traités</div>
        </div>
      )}

      {!loading && totalCount > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            {filteredContacts.length} contact{filteredContacts.length > 1 ? 's' : ''}
            {enrichFilter !== 'all' && ` sur ${totalCount}`}
          </span>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border border-border p-4 space-y-2">
              <div className="flex items-center gap-3">
                <Skeleton className="h-11 w-11" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
              <Skeleton className="h-1 w-full" />
            </div>
          ))}
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="border border-foreground p-12 text-center">
          <div className="w-14 h-14 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
            <Users className="w-7 h-7" />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-wider mb-1">Aucun contact</h3>
          <p className="text-xs text-muted-foreground">Ajustez vos filtres pour voir des résultats</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {filteredContacts.map((c, i) => (
            <ContactCard
              key={c.airtable_id}
              contact={c}
              enrichment={enrichments.get(c.airtable_id)}
              index={i}
              onClick={() => { setSelectedContact(c); setSheetOpen(true); }}
            />
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} goToPage={goToPage} />
      <EnrichedContactSheet
        contact={selectedContact}
        enrichment={selectedEnrichment}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onCopyMessage={(id) => updateMessageStatus(id, 'sent')}
        onEnrichSingle={(id) => enrichContacts([id], true)}
      />
    </div>
  );
}

/* ─── Main VivierList with sub-tabs ─── */
const subTabs = [
  { value: 'companies', label: 'Sociétés', emoji: '🏢' },
  { value: 'contacts', label: 'Contacts', emoji: '👤' },
] as const;

export function VivierList() {
  const [activeSubTab, setActiveSubTab] = useState<'companies' | 'contacts'>('companies');

  return (
    <div className="space-y-3">
      <div className="flex gap-0 w-fit">
        {subTabs.map((tab, index) => {
          const isActive = activeSubTab === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveSubTab(tab.value)}
              className={cn(
                "relative overflow-hidden flex items-center gap-1.5 h-[34px] px-4 text-[10px] font-medium uppercase tracking-wider border border-foreground transition-colors duration-200 group shrink-0",
                index > 0 && "border-l-0",
                isActive
                  ? "bg-brutal-accent text-foreground"
                  : "bg-background text-foreground"
              )}
            >
              <span className="text-sm relative z-10">{tab.emoji}</span>
              <span className="relative z-10">{tab.label}</span>
              {!isActive && (
                <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              )}
            </button>
          );
        })}
      </div>
      {activeSubTab === 'companies' ? <CompaniesView /> : <ContactsView />}
    </div>
  );
}
