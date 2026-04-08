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

/* ─── Pipeline stage mapping from Airtable shortlist statuses ─── */
const PIPELINE_STAGES = [
  { order: 1, label: 'Pressenti', short: 'PR', emoji: '○', statuses: ['pressenti', 'intéressé', 'candidature web', 'en reflexion', 'attente cv'] },
  { order: 2, label: 'CV envoyé', short: 'CV', emoji: '◔', statuses: ['cv sent', 'attente test'] },
  { order: 3, label: 'ITW 1', short: 'I1', emoji: '◑', statuses: ['itw 1 planifié', 'itw 1 à planifier', '1er entretien'] },
  { order: 4, label: 'ITW 2+', short: 'I2', emoji: '◕', statuses: ['itw 2+ planifié', 'itw 2+ à planifier', 'entretien 2+'] },
  { order: 5, label: 'ITW Final', short: 'IF', emoji: '◉', statuses: ['itw final à planifier', 'itw final planifié', 'entretien final'] },
  { order: 6, label: 'Offre', short: 'OF', emoji: '⭐', statuses: ['offer extended', 'offre déclinée', 'offre trop basse'] },
  { order: 7, label: 'Rejeté', short: 'RE', emoji: '✕', statuses: ['client rejeté', 'candidat rejeté', 'pas pertinent', 'pas intéressé', 'pas de fit technique', 'pas de fit projet', 'problème expérience', 'problème distance', 'problème motivation', 'problème diplôme', 'problème prétention salaire', 'problème salaire', 'problème technique', 'problème fit humain', 'fit humain', 'mauvaise référence', 'autre offre accepté-externe', 'autre offre accepté-interne', 'plus de nouvelles', 'pas présenté à l\'entretien', 'poste supprimé où annulé', 'rejet suite réflexion', 'trop de turnover', 'délais retour'] },
  { order: 8, label: 'Placé', short: 'PL', emoji: '🏆', statuses: ['placé', 'placed'] },
];

function statusToStageOrder(status: string | null): number {
  if (!status) return 0;
  const lower = status.toLowerCase().trim();
  for (const stage of PIPELINE_STAGES) {
    if (stage.statuses.includes(lower)) return stage.order;
  }
  return 0;
}

function SectionHeader({ emoji, label, count }: { emoji: string; label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-sm">{emoji}</span>
      <span className="text-xs font-bold uppercase tracking-wider text-foreground">{label}</span>
      {count !== undefined && (
        <span className="ml-auto text-xs text-muted-foreground tabular-nums bg-muted/50 px-1.5 py-0.5 rounded-md">{count}</span>
      )}
    </div>
  );
}

/* ─── Stat Block ─── */
function StatBlock({ value, label, highlight }: { value: number; label: string; highlight?: boolean }) {
  return (
    <div className={cn(
      "border rounded-lg p-3 text-center transition-colors",
      highlight ? "border-border bg-foreground text-background" : "border-border bg-muted/30"
    )}>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wider text-current opacity-60 mt-0.5">{label}</div>
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
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0 border-l border-border rounded-l-xl">
        {/* Hero header */}
        <div className="bg-foreground text-background p-5 sm:p-6 rounded-tl-xl">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-lg border-2 border-background/30 flex items-center justify-center text-lg font-bold uppercase shrink-0">
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
                  <span className="text-xs uppercase tracking-wider px-2 py-0.5 border border-background/20 text-background/50">{company.source_base}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-5">
          {company.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">{company.description}</p>
          )}

          <div className="grid grid-cols-4 gap-1.5 rounded-lg overflow-hidden">
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
                        <div className="h-8 w-8 bg-muted flex items-center justify-center text-xs font-bold shrink-0 uppercase text-foreground">
                          {(ct.full_name || '??').split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate">{ct.full_name || 'Sans nom'}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {ct.title}{ct.title && ct.email && ' · '}{ct.email}
                          </div>
                        </div>
                        {ct.contact_type && (
                          <span className="text-xs uppercase tracking-wider text-muted-foreground border border-border px-1.5 py-0.5 shrink-0">{ct.contact_type}</span>
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
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {s.candidate_name && <span>👤 {s.candidate_name}</span>}
                          {s.date_added && <span>· {relativeTime(s.date_added) || s.date_added}</span>}
                          {s.status && (
                            <span className="border border-border px-1.5 py-0.5 text-xs uppercase tracking-wider">{s.status}</span>
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
        "relative overflow-hidden flex items-center gap-1 h-8 px-2.5 text-xs font-medium uppercase tracking-wider border border-border transition-colors group shrink-0",
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
        {subtitle && <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{subtitle}</div>}
      </div>
      {date && <span className="text-xs text-muted-foreground uppercase tracking-wider shrink-0 mt-0.5">{relativeTime(date) || date}</span>}
    </div>
  );
}

/* ─── Recruiter Stat Card ─── */
function RecruiterCard({ name, interactions, lastDate, types }: { name: string; interactions: number; lastDate?: string; types: { notes: number; shortlists: number } }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="border border-border p-3 flex items-center gap-3 hover:bg-muted/20 transition-colors">
      <div className="h-9 w-9 bg-foreground text-background flex items-center justify-center text-xs font-bold shrink-0 uppercase">{initials}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold">{name}</div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          <span className="font-medium tabular-nums">{interactions} interaction{interactions > 1 ? 's' : ''}</span>
          {types.notes > 0 && <span>· 📝 {types.notes}</span>}
          {types.shortlists > 0 && <span>· 📋 {types.shortlists}</span>}
        </div>
      </div>
      {lastDate && <span className="text-xs text-muted-foreground uppercase tracking-wider shrink-0">{relativeTime(lastDate)}</span>}
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
        supabase.from('airtable_shortlists').select('airtable_id, status, date_added, created_at, job_airtable_id, candidate_airtable_id')
          .eq('contact_airtable_id', contact.airtable_id).order('date_added', { ascending: false, nullsFirst: false }).limit(100),
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
    const events: { type: string; emoji: string; title: string; subtitle?: string; date: string; highlight?: boolean; status?: string; candidateName?: string }[] = [];
    shortlists.forEach((s: any) => {
      events.push({ type: 'shortlist', emoji: '📋', title: s.job_title || 'Shortlist', subtitle: s.candidate_name ? `👤 ${s.candidate_name}` : undefined, date: s.date_added || '', highlight: false, status: s.status || null, candidateName: s.candidate_name || null });
    });
    notes.forEach((n: any) => {
      events.push({ type: 'note', emoji: '📝', title: n.title || 'Note', subtitle: n.detail?.slice(0, 100), date: n.note_date || '', highlight: false });
    });
    placements.forEach((p: any) => {
      events.push({ type: 'placement', emoji: '🏆', title: p.name || 'Placement', subtitle: p.candidate_name ? `👤 ${p.candidate_name}` : undefined, date: p.start_date || '', highlight: true, status: p.status || null, candidateName: p.candidate_name || null });
    });
    return events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [shortlists, notes, placements]);

  // Grouped shortlists by job for organized view
  const shortlistsByJob = useMemo(() => {
    const map = new Map<string, { jobTitle: string; candidates: { name: string | null; status: string | null; date: string | null }[]; latestDate: string | null }>();
    shortlists.forEach((s: any) => {
      const key = s.job_title || s.job_airtable_id || 'unknown';
      const existing = map.get(key) || { jobTitle: s.job_title || 'Poste inconnu', candidates: [], latestDate: null };
      existing.candidates.push({ name: s.candidate_name || null, status: s.status || null, date: s.date_added || null });
      if (!existing.latestDate || (s.date_added && s.date_added > existing.latestDate)) existing.latestDate = s.date_added;
      map.set(key, existing);
    });
    return [...map.values()].sort((a, b) => (b.latestDate || '').localeCompare(a.latestDate || ''));
  }, [shortlists]);

  // Parse Apollo employment history and find role at last interaction date
  const careerAnalysis = useMemo(() => {
    const apolloData = enrichment?.apollo_data;
    const employmentHistory: { title: string; organization_name: string; start_date?: string; end_date?: string; current?: boolean }[] = apolloData?.employment_history || [];
    
    // Find last interaction date from business dates only (never sync timestamps)
    const shortlistDates = shortlists
      .map((s: any) => s.date_added)
      .filter(Boolean)
      .sort()
      .reverse();
    const noteDates = notes
      .map((n: any) => n.note_date)
      .filter(Boolean)
      .sort()
      .reverse();
    // Use last shortlist date as primary, fallback to notes
    const lastInteractionDate = shortlistDates[0] || noteDates[0] || null;
    const lastInteractionTs = lastInteractionDate ? new Date(lastInteractionDate).getTime() : null;

    // Find all current roles (no end_date or marked current)
    const allCurrentRoles = employmentHistory.filter(e => !e.end_date || e.current);
    
    // Heuristic to find the PRIMARY current role among concurrent ones
    // Priority: longest tenure (earliest start_date), excluding short/side-project-like titles
    const sideProjectKeywords = ['facilitator', 'associate', 'volunteer', 'mentor', 'advisor', 'board member', 'fondateur', 'founder', 'bénévole', 'freelance'];
    let currentRole: typeof employmentHistory[0] | null = null;
    
    if (allCurrentRoles.length === 1) {
      currentRole = allCurrentRoles[0];
    } else if (allCurrentRoles.length > 1) {
      // Sort: longest tenure first (earliest start_date), deprioritize side-project titles
      const scored = allCurrentRoles.map(role => {
        const titleLower = (role.title || '').toLowerCase();
        const isSideProject = sideProjectKeywords.some(kw => titleLower.includes(kw));
        const startTs = role.start_date ? new Date(role.start_date).getTime() : Date.now();
        return { role, isSideProject, startTs };
      });
      // Primary = not side project + longest tenure
      scored.sort((a, b) => {
        if (a.isSideProject !== b.isSideProject) return a.isSideProject ? 1 : -1;
        return a.startTs - b.startTs; // earliest start = longest tenure
      });
      currentRole = scored[0].role;
    }
    
    // Fallback: use Apollo root-level title/org (LinkedIn headline) if no current in history
    if (!currentRole && apolloData?.title) {
      currentRole = { title: apolloData.title, organization_name: apolloData.organization_name || apolloData.organization?.name || '', start_date: undefined, end_date: undefined, current: true };
    }
    // If still no current role, use the most recent role as "last known"
    const lastKnownRole = currentRole || employmentHistory[0] || null;
    // Keep track of secondary concurrent roles for display
    const secondaryCurrentRoles = allCurrentRoles.filter(r => r !== currentRole);
    
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

    return { employmentHistory, currentRole, lastKnownRole, secondaryCurrentRoles, roleAtLastInteraction, lastInteractionDate, careerMoves };
  }, [enrichment, shortlists, notes, contact]);

  // Evolution data
  const evolutions = useMemo(() => {
    const items: { emoji: string; title: string; detail: string; type: 'positive' | 'neutral' | 'negative' }[] = [];
    
    const { roleAtLastInteraction, currentRole, lastKnownRole, secondaryCurrentRoles, careerMoves, lastInteractionDate } = careerAnalysis;
    
    // Case: no current role detected (person left last known company)
    if (!currentRole && lastKnownRole && lastInteractionDate) {
      items.push({
        emoji: '❓',
        title: 'Poste actuel inconnu',
        detail: `Dernier poste connu : ${lastKnownRole.title} chez ${lastKnownRole.organization_name} (terminé${lastKnownRole.end_date ? ' en ' + new Date(lastKnownRole.end_date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : ''})`,
        type: 'negative'
      });
    }
    
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

      // Secondary concurrent roles (side projects, associations, etc.)
      if (secondaryCurrentRoles.length > 0) {
        const rolesList = secondaryCurrentRoles.map(r => `${r.title} @ ${r.organization_name}`).join(', ');
        items.push({
          emoji: '🔀',
          title: `${secondaryCurrentRoles.length} rôle${secondaryCurrentRoles.length > 1 ? 's' : ''} en parallèle`,
          detail: rolesList,
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
  // Use careerAnalysis primary role (handles concurrent side projects) over raw enrichment title
  const primaryRole = careerAnalysis.currentRole;
  const displayTitle = primaryRole?.title || enrichment?.current_job_title || contact.contact_type || null;
  const displayCompany = primaryRole?.organization_name || enrichment?.current_company || contact.company_name;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0 border-l border-border rounded-l-xl">
        {/* Hero header */}
        <div className="bg-foreground text-background p-5 sm:p-6 rounded-tl-xl">
          <div className="flex items-start gap-4">
            <div className={cn(
              "h-14 w-14 rounded-lg border-2 flex items-center justify-center text-lg font-bold uppercase shrink-0",
              isEnriched ? "border-[hsl(var(--primary))]" : "border-background/30"
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
                  <span className="text-xs text-background/50 flex items-center gap-1"><Mail className="w-3 h-3" /> {contact.email}</span>
                )}
                {contact.city && (
                  <span className="text-xs text-background/50 flex items-center gap-1"><MapPin className="w-3 h-3" /> {contact.city}</span>
                )}
              </div>
              {enrichment?.is_relevant !== null && enrichment?.is_relevant !== undefined && (
                <div className="mt-2.5">
                  <span className={cn(
                    "text-xs uppercase tracking-wider px-2 py-1 font-bold",
                    enrichment.is_relevant
                      ? "bg-[hsl(var(--primary))] text-foreground"
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
        <div className="grid grid-cols-4 gap-0 border-b border-border rounded-lg overflow-hidden mx-4 mt-4 border">
          <div className="p-2.5 text-center border-r border-border">
            <div className="text-lg font-bold tabular-nums">{contact.shortlist_count}</div>
            <div className="text-[8px] uppercase tracking-wider text-muted-foreground">Shortlists</div>
          </div>
          <div className="p-2.5 text-center border-r border-border">
            <div className="text-lg font-bold tabular-nums">{contact.placement_count}</div>
            <div className="text-[8px] uppercase tracking-wider text-muted-foreground">Placements</div>
          </div>
          <div className="p-2.5 text-center border-r border-border">
            <div className="text-lg font-bold tabular-nums">{contact.note_count}</div>
            <div className="text-[8px] uppercase tracking-wider text-muted-foreground">Notes</div>
          </div>
          <div className="p-2.5 text-center">
            <div className="text-lg font-bold tabular-nums">{recruiterStats.length}</div>
            <div className="text-[8px] uppercase tracking-wider text-muted-foreground">Recruteurs</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 overflow-x-auto no-scrollbar border-b border-border bg-muted/20 mx-4 mt-3 rounded-lg overflow-hidden border">
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
                        ? "border-border text-foreground hover:border-border hover:bg-muted/30"
                        : "border-border bg-foreground text-background hover:bg-foreground/90"
                    )}
                  >
                    {enrichment ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {enrichment ? 'Ré-enrichir & regénérer' : 'Enrichir & générer le message'}
                  </button>

                  {/* Enriched profile card */}
                  {isEnriched && (
                    <div className="border-2 border-[hsl(var(--primary))] bg-[hsl(var(--accent))]">
                      <div className="px-4 py-2.5 border-b border-[hsl(var(--border))] flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--skalr-purple))]" />
                        <span className="text-xs font-bold uppercase tracking-wider">Profil enrichi</span>
                        <span className="ml-auto text-xs uppercase tracking-wider border border-border px-1.5 py-0.5 text-muted-foreground">
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
                          <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/40 pt-2.5 mt-2.5">{enrichment!.relevance_reason}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {enrichment?.match_type === 'not_found' && (
                    <div className="border border-border p-4 text-center">
                      <span className="text-xs text-muted-foreground">Aucun profil enrichi trouvé pour ce contact.</span>
                    </div>
                  )}

                  {/* Generated message */}
                  {enrichment?.generated_message && (
                    <div className="border border-border">
                      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between bg-muted/20">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{enrichment.message_type === 'sms' ? '📱' : '💬'}</span>
                          <span className="text-xs font-bold uppercase tracking-wider">
                            {enrichment.message_type === 'sms' ? 'SMS' : 'LinkedIn'}
                          </span>
                          {enrichment.message_status && (
                            <span className="text-xs uppercase tracking-wider border border-border px-1.5 py-0.5 text-muted-foreground">{enrichment.message_status}</span>
                          )}
                        </div>
                        <button
                          onClick={handleCopy}
                          className={cn(
                            "h-7 px-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider border transition-all",
                            copied ? "border-border bg-foreground text-background" : "border-border hover:border-border"
                          )}
                        >
                          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copied ? 'Copié !' : 'Copier'}
                        </button>
                      </div>
                      <div className="p-4">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{enrichment.generated_message}</p>
                        <div className="mt-3 pt-2.5 border-t border-border/40 text-xs text-muted-foreground uppercase tracking-wider">
                          {enrichment.generated_message.length} caractères
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Quick summary: last interaction + top recruiter */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="border border-border p-3">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Dernier échange</div>
                      <div className="text-xs font-semibold">{contact.last_interaction_date ? relativeTime(contact.last_interaction_date) || contact.last_interaction_date : '—'}</div>
                    </div>
                    <div className="border border-border p-3">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Top recruteur</div>
                      <div className="text-xs font-semibold">{recruiterStats[0]?.name || '—'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* ═══ TAB: HISTORIQUE ═══ */}
              {activeDetailTab === 'historique' && (
                <div className="space-y-4">
                  {timeline.length === 0 ? (
                    <div className="text-center py-10">
                      <Clock className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                      <p className="text-xs text-muted-foreground">Aucune interaction enregistrée</p>
                    </div>
                  ) : (
                    <>
                      {/* Summary counters */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="border border-border p-2.5 text-center">
                          <div className="text-lg font-bold tabular-nums">{shortlists.length}</div>
                          <div className="text-[8px] uppercase tracking-wider text-muted-foreground">Shortlists</div>
                        </div>
                        <div className="border border-border p-2.5 text-center">
                          <div className="text-lg font-bold tabular-nums">{notes.length}</div>
                          <div className="text-[8px] uppercase tracking-wider text-muted-foreground">Notes</div>
                        </div>
                        <div className={cn("border p-2.5 text-center", placements.length > 0 ? "border-border bg-foreground text-background" : "border-border")}>
                          <div className="text-lg font-bold tabular-nums">{placements.length}</div>
                          <div className="text-[8px] uppercase tracking-wider opacity-60">Placements</div>
                        </div>
                      </div>

                      {/* ── PLACEMENTS SECTION ── */}
                      {placements.length > 0 && (
                        <div>
                          <SectionHeader emoji="🏆" label="Placements réussis" count={placements.length} />
                          <div className="space-y-2">
                            {placements.map((p: any, i: number) => (
                              <div key={i} className="border border-border bg-accent/50 p-3">
                                <div className="flex items-center justify-between">
                                  <div className="text-xs font-bold">{p.name || 'Placement'}</div>
                                  {p.status && <Badge variant="outline" className="text-[8px] uppercase tracking-wider border-border">{p.status}</Badge>}
                                </div>
                                <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                                  {p.candidate_name && <span className="flex items-center gap-1"><UserCheck className="w-3 h-3" />{p.candidate_name}</span>}
                                  {p.start_date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{p.start_date.slice(0, 7)}</span>}
                                  {p.salary && <span className="font-medium text-foreground">{p.salary}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── SHORTLISTS GROUPED BY JOB ── */}
                      {shortlistsByJob.length > 0 && (
                        <div>
                          <SectionHeader emoji="📋" label="Shortlists par poste" count={shortlists.length} />
                          <div className="space-y-2">
                            {shortlistsByJob.map((group, gi) => {
                              // Compute max pipeline stage reached across all candidates
                              const maxStage = Math.max(...group.candidates.map(c => statusToStageOrder(c.status)));
                              const maxStageLabel = PIPELINE_STAGES.find(s => s.order === maxStage)?.label || '—';
                              const maxStageEmoji = PIPELINE_STAGES.find(s => s.order === maxStage)?.emoji || '○';
                              
                              // Pipeline progress bar
                              const stageReachedIndex = PIPELINE_STAGES.findIndex(s => s.order === maxStage);
                              const progressPct = PIPELINE_STAGES.length > 0 ? Math.round(((stageReachedIndex + 1) / PIPELINE_STAGES.length) * 100) : 0;

                              return (
                                <div key={gi} className="border border-border">
                                  <div className="p-3 bg-muted/20 border-b border-border">
                                    <div className="flex items-center gap-2">
                                      <Briefcase className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs font-bold leading-snug truncate">{group.jobTitle}</div>
                                        <div className="text-xs text-muted-foreground">
                                          {group.candidates.length} candidat{group.candidates.length > 1 ? 's' : ''}
                                          {group.latestDate && <> · {relativeTime(group.latestDate)}</>}
                                        </div>
                                      </div>
                                    </div>
                                    {/* Pipeline progress */}
                                    <div className="mt-2">
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs text-muted-foreground uppercase tracking-wider">Stade max atteint</span>
                                        <span className="text-xs font-bold flex items-center gap-1">{maxStageEmoji} {maxStageLabel}</span>
                                      </div>
                                      <div className="h-1.5 bg-border w-full">
                                        <div className={cn(
                                          "h-full transition-all",
                                          maxStage >= 8 ? "bg-foreground" : maxStage >= 5 ? "bg-[hsl(var(--primary))]" : "bg-muted-foreground/40"
                                        )} style={{ width: `${progressPct}%` }} />
                                      </div>
                                      <div className="flex justify-between mt-0.5">
                                        {PIPELINE_STAGES.map((stage, si) => (
                                          <span key={si} className={cn(
                                            "text-[7px]",
                                            si <= stageReachedIndex ? "text-foreground font-medium" : "text-muted-foreground/40"
                                          )}>{stage.short}</span>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                  {/* Candidates list sorted by stage */}
                                  <div className="divide-y divide-border">
                                    {[...group.candidates]
                                      .sort((a, b) => statusToStageOrder(b.status) - statusToStageOrder(a.status))
                                      .map((c, ci) => {
                                        const stage = PIPELINE_STAGES.find(s => s.order === statusToStageOrder(c.status));
                                        const isAdvanced = (stage?.order || 0) >= 5;
                                        const isPlaced = (stage?.order || 0) >= 8;
                                        return (
                                          <div key={ci} className={cn(
                                            "px-3 py-2 flex items-center gap-2 text-xs",
                                            isPlaced && "bg-accent/50"
                                          )}>
                                            <span className="text-xs shrink-0">{stage?.emoji || '○'}</span>
                                            <span className="flex-1 truncate font-medium">{c.name || 'Candidat inconnu'}</span>
                                            <span className={cn(
                                              "text-[8px] px-1.5 py-0.5 border uppercase tracking-wider shrink-0",
                                              isPlaced ? "border-border bg-foreground text-background" :
                                              isAdvanced ? "border-[hsl(var(--primary))] text-foreground bg-[hsl(var(--accent))]" :
                                              "border-border text-muted-foreground"
                                            )}>{stage?.label || c.status || '?'}</span>
                                          </div>
                                        );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* ── NOTES SECTION ── */}
                      {notes.length > 0 && (
                        <div>
                          <SectionHeader emoji="📝" label="Notes internes" count={notes.length} />
                          <div className="space-y-1">
                            {notes.map((n: any, i: number) => (
                              <div key={i} className="border-l-2 border-border ml-2 p-3 hover:bg-muted/10 transition-colors">
                                <div className="flex items-center justify-between">
                                  <div className="text-xs font-semibold leading-snug">{n.title || 'Note'}</div>
                                  <span className="text-xs text-muted-foreground shrink-0">{relativeTime(n.note_date) || n.note_date || ''}</span>
                                </div>
                                {n.detail && <div className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-3">{n.detail}</div>}
                                {n.author && <div className="text-xs text-muted-foreground/60 mt-1 flex items-center gap-1"><UserCheck className="w-3 h-3" />{n.author}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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
                      <p className="text-xs text-muted-foreground mt-1">Enrichissez ce contact pour détecter les changements</p>
                    </div>
                  ) : (
                    <>
                      {/* Context: when was last interaction */}
                      {careerAnalysis.lastInteractionDate && (
                        <div className="border border-border bg-foreground text-background p-3 flex items-center gap-3">
                          <Clock className="w-5 h-5 shrink-0 text-[hsl(var(--primary))]" />
                          <div>
                            <div className="text-xs uppercase tracking-wider text-background/50">Dernier échange avec Skalr</div>
                            <div className="text-sm font-bold">{relativeTime(careerAnalysis.lastInteractionDate)}</div>
                          </div>
                          {careerAnalysis.roleAtLastInteraction && (
                            <div className="ml-auto text-right">
                              <div className="text-xs uppercase tracking-wider text-background/50">Poste à l'époque</div>
                              <div className="text-xs font-medium">{careerAnalysis.roleAtLastInteraction.title}</div>
                              <div className="text-xs text-background/60">{careerAnalysis.roleAtLastInteraction.organization_name}</div>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1 font-medium">
                        Changements depuis nos derniers échanges
                      </div>
                      {evolutions.map((evo, i) => (
                        <div key={i} className={cn(
                          "border-2 p-4 space-y-1.5",
                          evo.type === 'positive' ? "border-border bg-[hsl(var(--accent))]" :
                          evo.type === 'negative' ? "border-destructive/40 bg-destructive/5" :
                          "border-border"
                        )}>
                          <div className="flex items-center gap-2">
                            <span className="text-base">{evo.emoji}</span>
                            <span className="text-xs font-bold uppercase tracking-wider">{evo.title}</span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed pl-7">{evo.detail}</p>
                        </div>
                      ))}

                      {/* Comparison table: role at last interaction vs now */}
                      {isEnriched && (
                        <div className="mt-4">
                          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">
                            Comparaison : {careerAnalysis.lastInteractionDate ? `à l'époque vs aujourd'hui` : 'CRM vs aujourd\'hui'}
                          </div>
                          <div className="border border-border divide-y divide-border">
                            <div className="grid grid-cols-3 text-xs uppercase tracking-wider text-muted-foreground bg-muted/30">
                              <div className="p-2">Champ</div>
                              <div className="p-2">{careerAnalysis.lastInteractionDate ? `À l'époque` : 'CRM'}</div>
                              <div className="p-2">Aujourd'hui</div>
                            </div>
                            {[
                              { 
                                label: 'Poste', 
                                before: careerAnalysis.roleAtLastInteraction?.title || contact.contact_type || null, 
                                after: careerAnalysis.currentRole?.title || enrichment?.current_job_title || (careerAnalysis.lastKnownRole && !careerAnalysis.currentRole ? `${careerAnalysis.lastKnownRole.title} (terminé)` : null)
                              },
                              { 
                                label: 'Entreprise', 
                                before: careerAnalysis.roleAtLastInteraction?.organization_name || contact.company_name, 
                                after: careerAnalysis.currentRole?.organization_name || enrichment?.current_company || (careerAnalysis.lastKnownRole && !careerAnalysis.currentRole ? `${careerAnalysis.lastKnownRole.organization_name} (quitté)` : null)
                              },
                              { label: 'Localisation', before: contact.city, after: enrichment?.location },
                            ].filter(r => r.before || r.after).map((row, i) => {
                              const changed = row.before !== row.after && row.before && row.after;
                              return (
                                <div key={i} className={cn("grid grid-cols-3", changed && "bg-[hsl(var(--accent))]")}>
                                  <div className="p-2 text-xs font-medium">{row.label}</div>
                                  <div className="p-2 text-xs text-muted-foreground">{row.before || '—'}</div>
                                  <div className={cn("p-2 text-xs", changed ? "font-semibold text-foreground" : "text-muted-foreground")}>{row.after || '—'}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Full career timeline */}
                      {careerAnalysis.employmentHistory.length > 0 && (
                        <div className="mt-4">
                          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">
                            Parcours professionnel complet
                          </div>
                          <div className="space-y-0">
                            {careerAnalysis.employmentHistory.map((job, i) => {
                              const isCurrent = !job.end_date || job.current;
                              const wasActiveAtLastInteraction = careerAnalysis.roleAtLastInteraction?.title === job.title && careerAnalysis.roleAtLastInteraction?.organization_name === job.organization_name;
                              return (
                                <div key={i} className={cn(
                                  "flex items-start gap-3 p-2.5 border-l-2 ml-2",
                                  isCurrent ? "border-l-foreground bg-muted/20" : 
                                  wasActiveAtLastInteraction ? "border-l-[hsl(var(--primary))] bg-[hsl(var(--accent))]" :
                                  "border-l-border"
                                )}>
                                  <div className={cn(
                                    "-ml-[11px] w-5 h-5 flex items-center justify-center text-[8px] shrink-0 border",
                                    isCurrent ? "bg-foreground text-background border-border" :
                                    wasActiveAtLastInteraction ? "bg-[hsl(var(--primary))] text-foreground border-[hsl(var(--primary))]" :
                                    "bg-background text-muted-foreground border-border"
                                  )}>
                                    {isCurrent ? '●' : wasActiveAtLastInteraction ? '◆' : '○'}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs font-semibold leading-snug">{job.title}</div>
                                    <div className="text-xs text-muted-foreground">{job.organization_name}</div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <div className="text-xs text-muted-foreground">
                                      {job.start_date ? relativeTime(job.start_date) || job.start_date.slice(0, 7) : '?'}
                                    </div>
                                    {isCurrent && <span className="text-[8px] font-bold uppercase tracking-wider text-foreground">Actuel</span>}
                                    {wasActiveAtLastInteraction && !isCurrent && <span className="text-[8px] font-bold uppercase tracking-wider text-[hsl(var(--skalr-purple))]">À l'époque</span>}
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
                      <p className="text-xs text-muted-foreground mt-1">Les auteurs des notes et shortlists apparaîtront ici</p>
                    </div>
                  ) : (
                    <>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1 font-medium">
                        Recruteurs ayant interagi avec ce contact
                      </div>
                      {/* Top recruiter highlight */}
                      {recruiterStats.length > 0 && (
                        <div className="border border-border bg-foreground text-background p-4 flex items-center gap-3">
                          <div className="h-12 w-12 border-2 border-background/30 flex items-center justify-center text-sm font-bold uppercase shrink-0">
                            {recruiterStats[0].name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Star className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
                              <span className="text-xs uppercase tracking-wider text-background/50">Contact principal</span>
                            </div>
                            <div className="text-sm font-bold mt-0.5">{recruiterStats[0].name}</div>
                            <div className="text-xs text-background/60 mt-0.5">
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
                        <div className="border border-[hsl(var(--primary))] bg-[hsl(var(--accent))] p-3 mt-2">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--skalr-purple))]" />
                            <span className="text-xs font-bold uppercase tracking-wider">Recommandation</span>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">
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
      <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium shrink-0">{labels[level]}</span>
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
      "flex items-center gap-1.5 px-2 py-1 border rounded-md text-xs font-medium shrink-0",
      highlight ? "border-border bg-foreground text-background" : "border-border bg-background text-foreground"
    )}>
      {icon}
      <span className="font-bold tabular-nums">{value}</span>
      <span className="hidden sm:inline text-muted-foreground">{label}</span>
    </div>
  );
}

/* ─── Shared filter bar ─── */
function VivierFilterBar({ searchInput, setSearchInput, onSearch, filters, updateFilters, showContactType }: {
  searchInput: string; setSearchInput: (v: string) => void; onSearch: () => void;
  filters: VivierFilters; updateFilters: (p: Partial<VivierFilters>) => void; showContactType?: boolean;
}) {
  const [cityInput, setCityInput] = useState('');
  const [showMore, setShowMore] = useState(false);

  const activeFilterCount = [
    filters.source_base,
    filters.min_shortlists > 1 ? true : null,
    filters.city,
    filters.has_placements !== null ? true : null,
    filters.contact_type,
    filters.sort_by !== 'recent' ? true : null,
  ].filter(Boolean).length;

  return (
    <div className="space-y-2">
      {/* Row 1: Search + toggle */}
      <div className="flex gap-2">
        <div className="flex-1 min-w-0 relative">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Rechercher…" value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSearch()} className="pl-9 h-9 text-xs border-border/60 rounded-lg" />
        </div>
        <button
          onClick={() => setShowMore(!showMore)}
          className={cn(
            "relative overflow-hidden h-9 px-3 flex items-center gap-1.5 border rounded-lg text-xs font-medium uppercase tracking-wider shrink-0 transition-colors group",
            showMore || activeFilterCount > 0
              ? "border-border bg-foreground text-background"
              : "border-border text-foreground hover:border-border"
          )}
        >
          <span className="relative z-10">Filtres</span>
          {activeFilterCount > 0 && (
            <span className="relative z-10 bg-background text-foreground text-xs font-bold w-4 h-4 flex items-center justify-center rounded-full">{activeFilterCount}</span>
          )}
        </button>
      </div>

      {/* Row 2: Quick filters (always visible) */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        <Select value={filters.source_base || 'all'} onValueChange={v => updateFilters({ source_base: v === 'all' ? null : v })}>
          <SelectTrigger className="w-[140px] h-8 text-xs border-border/60 shrink-0"><SelectValue placeholder="Base" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les bases</SelectItem>
            <SelectItem value="konekt">Skalr</SelectItem>
            <SelectItem value="konekt_prospect">Skalr Prospect</SelectItem>
          </SelectContent>
        </Select>
        <Select value={String(filters.min_shortlists)} onValueChange={v => updateFilters({ min_shortlists: Number(v) })}>
          <SelectTrigger className="w-[120px] h-8 text-xs border-border/60 shrink-0"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Toutes</SelectItem>
            <SelectItem value="1">≥ 1 shortlist</SelectItem>
            <SelectItem value="2">≥ 2 shortlists</SelectItem>
            <SelectItem value="3">≥ 3 shortlists</SelectItem>
            <SelectItem value="5">≥ 5 shortlists</SelectItem>
            <SelectItem value="10">≥ 10 shortlists</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.sort_by} onValueChange={v => updateFilters({ sort_by: v })}>
          <SelectTrigger className="w-[130px] h-8 text-xs border-border/60 shrink-0"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Plus récent</SelectItem>
            <SelectItem value="shortlists">Plus de shortlists</SelectItem>
            <SelectItem value="placements">Plus de placements</SelectItem>
            <SelectItem value="name">Alphabétique</SelectItem>
            {!showContactType && <SelectItem value="contacts">Plus de contacts</SelectItem>}
          </SelectContent>
        </Select>
      </div>

      {/* Row 3: Advanced filters (collapsible) */}
      {showMore && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-2 border border-border rounded-lg p-3 bg-muted/20"
        >
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">Filtres avancés</div>

          {/* City */}
          <div className="flex gap-2">
            <div className="flex-1 min-w-0 relative">
              <MapPin className="absolute left-2.5 top-2 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="Ville…"
                value={cityInput}
                onChange={e => setCityInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') updateFilters({ city: cityInput || null }); }}
                onBlur={() => { if (cityInput !== (filters.city || '')) updateFilters({ city: cityInput || null }); }}
                className="pl-8 h-8 text-xs border-border/60 rounded-lg"
              />
            </div>
            {filters.city && (
              <button onClick={() => { setCityInput(''); updateFilters({ city: null }); }} className="h-8 px-2 text-xs border border-border rounded-lg hover:bg-muted transition-colors">✕</button>
            )}
          </div>

          {/* Placements filter */}
          <div className="flex gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground self-center mr-1">Placements :</span>
            {([
              { label: 'Tous', value: null },
              { label: 'Avec placement', value: true },
              { label: 'Sans placement', value: false },
            ] as const).map(opt => (
              <button
                key={String(opt.value)}
                onClick={() => updateFilters({ has_placements: opt.value })}
                className={cn(
                  "h-7 px-2.5 text-xs font-medium border rounded-md transition-colors",
                  filters.has_placements === opt.value
                    ? "border-border bg-foreground text-background"
                    : "border-border text-foreground hover:border-border"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Contact type (contacts tab only) */}
          {showContactType && (
            <div className="flex gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground self-center mr-1">Type :</span>
              {([
                { label: 'Tous', value: null },
                { label: 'Candidat', value: 'Candidat' },
                { label: 'Contact', value: 'Contact' },
                { label: 'Client', value: 'Client' },
                { label: 'Prospect', value: 'Prospect' },
              ] as const).map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => updateFilters({ contact_type: opt.value })}
                  className={cn(
                    "h-7 px-2.5 text-xs font-medium border rounded-md transition-colors",
                    filters.contact_type === opt.value
                      ? "border-border bg-foreground text-background"
                      : "border-border text-foreground hover:border-border"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Reset button */}
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setCityInput('');
                updateFilters({ source_base: null, min_shortlists: 1, city: null, has_placements: null, contact_type: null, sort_by: 'recent' });
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
            >
              Réinitialiser tous les filtres
            </button>
          )}
        </motion.div>
      )}
    </div>
  );
}

import type { VivierFilters } from '@/hooks/useVivierCandidates';

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
      className="w-full text-left border border-border rounded-lg bg-card hover:bg-muted/30 hover:shadow-sm transition-all duration-150 group"
    >
      {/* Top section */}
      <div className="p-3 sm:p-4 space-y-2.5">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-lg bg-foreground text-background flex items-center justify-center text-xs sm:text-sm font-bold shrink-0 uppercase">
            {initials}
          </div>

          {/* Name & meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm sm:text-sm font-semibold text-foreground leading-tight break-words">
                {company.company_name || 'Sans nom'}
              </h3>
              {timeAgo && (
                <span className="text-xs text-muted-foreground shrink-0 uppercase tracking-wider mt-0.5">{timeAgo}</span>
              )}
            </div>
            <div className="flex items-center gap-2.5 mt-1 text-xs text-muted-foreground">
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
            <div className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground shrink-0">
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
      className="w-full text-left border border-border rounded-lg bg-card hover:bg-muted/30 hover:shadow-sm transition-all duration-150 group"
    >
      <div className="p-3 sm:p-4 space-y-2.5">
        <div className="flex items-start gap-3">
          {/* Avatar with enrichment indicator */}
          <div className="relative shrink-0">
            <div className={cn(
              "h-10 w-10 sm:h-11 sm:w-11 rounded-lg flex items-center justify-center text-xs sm:text-sm font-bold uppercase",
              isEnriched ? "bg-foreground text-background" : "bg-muted text-foreground"
            )}>
              {initials}
            </div>
            {enrichment?.is_relevant === true && (
              <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-foreground text-background flex items-center justify-center text-[8px]">✓</div>
            )}
            {enrichment?.is_relevant === false && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-muted text-muted-foreground flex items-center justify-center text-[8px]">✗</div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm sm:text-sm font-semibold text-foreground leading-tight break-words">
                {contact.full_name || 'Sans nom'}
              </h3>
              {timeAgo && (
                <span className="text-xs text-muted-foreground shrink-0 uppercase tracking-wider mt-0.5">{timeAgo}</span>
              )}
            </div>

            {/* Role & company */}
            {(displayTitle || displayCompany) && (
              <div className="mt-0.5 text-xs sm:text-xs text-muted-foreground leading-snug">
                {displayTitle && <span className={cn("font-medium", isEnriched && "text-foreground")}>{displayTitle}</span>}
                {displayTitle && displayCompany && <span className="mx-1">·</span>}
                {displayCompany && <span className={cn(isEnriched && "text-foreground")}>{displayCompany}</span>}
              </div>
            )}

            {/* Location + contact info */}
            <div className="flex items-center gap-2.5 mt-1 text-xs text-muted-foreground">
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
            <div className="flex items-center gap-1 px-2 py-1 border border-border bg-foreground text-background text-xs font-medium shrink-0">
              {enrichment.message_type === 'sms' ? '📱' : '💬'} Message prêt
            </div>
          )}
          <StatPill icon={<FileText className="w-3 h-3" />} value={contact.shortlist_count} label="shortlists" highlight={contact.shortlist_count >= 5} />
          <StatPill icon={<Trophy className="w-3 h-3" />} value={contact.placement_count} label="placements" highlight={contact.placement_count > 0} />
          {contact.note_count > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground shrink-0">
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
      <VivierFilterBar searchInput={searchInput} setSearchInput={setSearchInput} onSearch={() => updateFilters({ search: searchInput })} filters={filters} updateFilters={updateFilters} showContactType />

      {!loading && totalCount > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
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
        <div className="border border-border p-12 text-center">
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
          className="relative overflow-hidden h-8 px-3 flex items-center gap-1.5 border border-border bg-foreground text-background text-xs font-medium uppercase tracking-wider group disabled:opacity-30 shrink-0"
        >
          <Sparkles className="w-3 h-3 relative z-10" />
          <span className="relative z-10">{isEnriching ? 'Enrichissement…' : 'Enrichir'}</span>
        </button>
        {enrichments.size > 0 && (
          <button
            onClick={() => handleEnrichAll(true)}
            disabled={isEnriching || contacts.length === 0}
            className="relative overflow-hidden h-8 px-3 flex items-center gap-1.5 border border-border border-l-0 text-foreground text-xs font-medium uppercase tracking-wider group disabled:opacity-30 shrink-0"
          >
            <RefreshCw className="w-3 h-3 relative z-10" />
            <span className="relative z-10 hidden sm:inline">Ré-enrichir</span>
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
                    "h-8 px-3 text-xs font-medium uppercase tracking-wider border border-border shrink-0 transition-colors",
                    idx === 0 ? "border-l-0 sm:ml-2 sm:border-l" : "border-l-0",
                    enrichFilter === f ? "bg-accent text-foreground" : "bg-background text-foreground hover:bg-muted"
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
          <div className="text-xs text-muted-foreground uppercase tracking-wider">{progress.done} / {progress.total} traités</div>
        </div>
      )}

      {!loading && totalCount > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
            {enrichFilter !== 'all' ? `${filteredContacts.length} / ` : ''}{totalCount} contact{totalCount > 1 ? 's' : ''}
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
        <div className="border border-border p-12 text-center">
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
                "relative overflow-hidden flex items-center gap-1.5 h-9 px-4 text-xs font-medium uppercase tracking-wider border border-border transition-colors duration-200 group shrink-0",
                index > 0 && "border-l-0",
                isActive
                  ? "bg-accent text-foreground"
                  : "bg-background text-foreground"
              )}
            >
              <span className="text-sm relative z-10">{tab.emoji}</span>
              <span className="relative z-10">{tab.label}</span>
            </button>
          );
        })}
      </div>
      {activeSubTab === 'companies' ? <CompaniesView /> : <ContactsView />}
    </div>
  );
}
