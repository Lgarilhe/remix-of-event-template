import React, { useEffect, useState } from 'react';
import { useVivierContacts, useVivierCompanies, VivierContact, VivierCompany } from '@/hooks/useVivierCandidates';
import { useVivierEnrichment, VivierEnrichment } from '@/hooks/useVivierEnrichment';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Search, Mail, Building2, ChevronLeft, ChevronRight, Users, FileText, Trophy, MapPin, Briefcase, Sparkles, Copy, Check, ExternalLink, Phone, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

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
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left flex items-center gap-2">
             <div className="w-8 h-8 bg-foreground text-background flex items-center justify-center">
               <Building2 className="w-4 h-4" />
            </div>
            {company.company_name || 'Société'}
          </SheetTitle>
          {company.city && <p className="text-sm text-muted-foreground text-left flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {company.city}</p>}
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {company.description && <p className="text-xs text-muted-foreground line-clamp-3">{company.description}</p>}
          {company.headcount && <Badge variant="outline" className="text-[10px]">{company.headcount} employés</Badge>}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Contacts', value: company.contact_count },
              { label: 'Shortlists', value: company.shortlist_count },
              { label: 'Placements', value: company.placement_count },
              { label: 'Notes', value: company.note_count },
            ].map(s => (
              <div key={s.label} className="border border-border p-2.5 text-center bg-muted/30">
                <div className="text-lg font-bold">{s.value}</div>
                <div className="text-[10px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
          {loadingDetails ? (
             <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>
          ) : (
            <>
              {contacts.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">Contacts ({contacts.length})</h4>
                  <div className="space-y-1.5">
                    {contacts.map((ct: any) => (
                       <div key={ct.airtable_id} className="border border-border/40 p-2.5 text-xs flex items-center gap-2.5 hover:bg-muted/30 transition-colors">
                         <div className="h-7 w-7 bg-muted flex items-center justify-center text-[9px] font-bold shrink-0 uppercase text-foreground">
                           {(ct.full_name || '??').split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{ct.full_name || 'Sans nom'}</div>
                          <div className="text-muted-foreground truncate">
                            {ct.title && <span>{ct.title}</span>}
                            {ct.email && <span> · {ct.email}</span>}
                          </div>
                        </div>
                        {ct.contact_type && <Badge variant="outline" className="text-[9px] shrink-0">{ct.contact_type}</Badge>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {shortlists.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">Shortlists ({shortlists.length})</h4>
                  <div className="space-y-1.5">
                    {shortlists.map((s: any) => (
                       <div key={s.airtable_id} className="border border-border/40 p-2.5 text-xs space-y-0.5">
                        <div className="font-medium">{s.job_title || 'Poste inconnu'}</div>
                        <div className="text-muted-foreground flex items-center gap-2">
                          {s.candidate_name && <span>{s.candidate_name}</span>}
                          {s.date_added && <span>· {s.date_added}</span>}
                          {s.status && <Badge variant="outline" className="text-[9px]">{s.status}</Badge>}
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

/* ─── Enriched Contact Detail Sheet ─── */
function EnrichedContactSheet({ contact, enrichment, open, onOpenChange, onCopyMessage, onEnrichSingle }: {
  contact: VivierContact | null; enrichment: VivierEnrichment | null; open: boolean; onOpenChange: (v: boolean) => void;
  onCopyMessage?: (id: string) => void;
  onEnrichSingle?: (id: string) => void;
}) {
  const [shortlists, setShortlists] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!contact || !open) return;
    setLoadingDetails(true);
    const fetchDetails = async () => {
      const [slRes, notesRes] = await Promise.all([
        supabase.from('airtable_shortlists').select('airtable_id, status, date_added, job_airtable_id, candidate_airtable_id')
          .eq('contact_airtable_id', contact.airtable_id).order('date_added', { ascending: false }).limit(20),
        supabase.from('airtable_notes').select('airtable_id, title, detail, note_type, note_date, author')
          .eq('contact_airtable_id', contact.airtable_id).order('note_date', { ascending: false }).limit(15),
      ]);
      const jobIds = new Set<string>(); const candIds = new Set<string>();
      (slRes.data || []).forEach((s: any) => { if (s.job_airtable_id) jobIds.add(s.job_airtable_id); if (s.candidate_airtable_id) candIds.add(s.candidate_airtable_id); });
      const [jobsRes, candsRes] = await Promise.all([
        jobIds.size > 0 ? supabase.from('airtable_jobs').select('airtable_id, title').in('airtable_id', [...jobIds]) : Promise.resolve({ data: [] as any[] }),
        candIds.size > 0 ? supabase.from('airtable_candidates').select('airtable_id, full_name').in('airtable_id', [...candIds]) : Promise.resolve({ data: [] as any[] }),
      ]);
      const jobMap = new Map((jobsRes.data || []).map((j: any) => [j.airtable_id, j.title]));
      const candMap = new Map((candsRes.data || []).map((c: any) => [c.airtable_id, c.full_name]));
      setShortlists((slRes.data || []).map((s: any) => ({ ...s, job_title: s.job_airtable_id ? jobMap.get(s.job_airtable_id) || null : null, candidate_name: s.candidate_airtable_id ? candMap.get(s.candidate_airtable_id) || null : null })));
      setNotes(notesRes.data || []);
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

  if (!contact) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">{contact.full_name || 'Sans nom'}</SheetTitle>
          {contact.title && <p className="text-sm text-muted-foreground text-left">{contact.title}</p>}
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {/* Contact info */}
          <div className="space-y-1 text-sm">
            {contact.company_name && <div className="flex items-center gap-2 text-muted-foreground"><Building2 className="w-3.5 h-3.5" /> {contact.company_name}</div>}
            {contact.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="w-3.5 h-3.5" /> {contact.email}</div>}
            {contact.city && <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="w-3.5 h-3.5" /> {contact.city}</div>}
          </div>

          {/* Enrich button */}
          <Button
            size="sm"
            variant={enrichment ? 'outline' : 'default'}
            onClick={() => onEnrichSingle?.(contact.airtable_id)}
            className="w-full h-9 text-xs gap-1.5"
          >
            {enrichment ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            {enrichment ? 'Ré-enrichir & regénérer le message' : 'Enrichir & générer le message'}
          </Button>

          {/* Enriched profile */}
          {enrichment && enrichment.match_type !== 'not_found' && (
            <div className="border border-[hsl(var(--skalr-purple)/0.2)] bg-[hsl(var(--skalr-purple)/0.04)] p-3.5 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[hsl(var(--skalr-purple))]" />
                <span className="text-xs font-semibold">Profil enrichi</span>
                <Badge variant="outline" className="text-[9px]">{enrichment.match_type === 'linkedin' ? 'LinkedIn' : 'Fuzzy'}</Badge>
              </div>
              {enrichment.current_job_title && (
                <div className="text-sm">
                  <span className="font-medium">{enrichment.current_job_title}</span>
                  {enrichment.current_company && <span className="text-muted-foreground"> @ {enrichment.current_company}</span>}
                </div>
              )}
              {enrichment.headline && <p className="text-xs text-muted-foreground">{enrichment.headline}</p>}
              {enrichment.location && <div className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" /> {enrichment.location}</div>}
              {enrichment.linkedin_url && (
                <a href={enrichment.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[hsl(var(--skalr-purple))] flex items-center gap-1 hover:underline">
                  <ExternalLink className="w-3 h-3" /> LinkedIn
                </a>
              )}
              {enrichment.is_relevant !== null && (
                <div className="flex items-center gap-2">
                  <Badge variant={enrichment.is_relevant ? 'default' : 'secondary'} className="text-[10px]">
                    {enrichment.is_relevant ? '✓ Pertinent' : '✗ Non pertinent'}
                  </Badge>
                  {enrichment.relevance_reason && <span className="text-[10px] text-muted-foreground">{enrichment.relevance_reason}</span>}
                </div>
              )}
            </div>
          )}

          {enrichment?.match_type === 'not_found' && (
            <div className="border border-border/40 p-3 text-xs text-muted-foreground">
              Aucun profil trouvé sur Apollo pour ce contact.
            </div>
          )}

          {/* Generated message */}
          {enrichment?.generated_message && (
            <div className="border border-border/40 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {enrichment.message_type === 'sms' ? '📱 SMS' : '💬 LinkedIn'}
                  </span>
                  {enrichment.message_status && (
                    <Badge variant="outline" className="text-[9px] rounded-full">{enrichment.message_status}</Badge>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={handleCopy} className="h-7 text-[10px] gap-1 rounded-lg">
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copié' : 'Copier'}
                </Button>
              </div>
              <p className="text-sm whitespace-pre-wrap bg-muted/30 p-3 rounded-lg">{enrichment.generated_message}</p>
              <div className="text-[10px] text-muted-foreground">{enrichment.generated_message.length} caractères</div>
            </div>
          )}

          {loadingDetails ? (
            <div className="space-y-2"><Skeleton className="h-4 w-full rounded-lg" /><Skeleton className="h-4 w-3/4 rounded-lg" /></div>
          ) : (
            <>
              {shortlists.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">Shortlists</h4>
                  <div className="space-y-1.5">
                    {shortlists.map((s: any) => (
                      <div key={s.airtable_id} className="rounded-lg border border-border/40 p-2.5 text-xs space-y-0.5">
                        <div className="font-medium">{s.job_title || 'Poste inconnu'}</div>
                        <div className="text-muted-foreground">{s.candidate_name} {s.date_added && `· ${s.date_added}`} {s.status && <Badge variant="outline" className="text-[9px] ml-1 rounded-full">{s.status}</Badge>}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {notes.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">Notes</h4>
                  <div className="space-y-1.5">
                    {notes.map((n: any) => (
                      <div key={n.airtable_id} className="rounded-lg border border-border/40 p-2.5 text-xs space-y-0.5">
                        <div className="font-medium">{n.title || 'Note'}</div>
                        {n.detail && <div className="text-muted-foreground line-clamp-2">{n.detail}</div>}
                        <div className="text-muted-foreground">{n.note_date} {n.author && <span className="italic">— {n.author}</span>}</div>
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

/* ─── Shared filter bar ─── */
function VivierFilterBar({ searchInput, setSearchInput, onSearch, filters, updateFilters }: {
  searchInput: string; setSearchInput: (v: string) => void; onSearch: () => void;
  filters: { source_base: string | null; min_shortlists: number }; updateFilters: (p: any) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-end">
      <div className="flex-1 min-w-[200px]">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Rechercher…" value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSearch()} className="pl-9 h-9 text-xs rounded-lg border-border/60" />
        </div>
      </div>
      <Select value={filters.source_base || 'all'} onValueChange={v => updateFilters({ source_base: v === 'all' ? null : v })}>
        <SelectTrigger className="w-[140px] h-9 text-xs rounded-lg border-border/60"><SelectValue placeholder="Base" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes les bases</SelectItem>
          <SelectItem value="konekt">Konekt</SelectItem>
          <SelectItem value="konekt_prospect">Konekt Prospect</SelectItem>
        </SelectContent>
      </Select>
      <Select value={String(filters.min_shortlists)} onValueChange={v => updateFilters({ min_shortlists: Number(v) })}>
        <SelectTrigger className="w-[130px] h-9 text-xs rounded-lg border-border/60"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="1">≥ 1 shortlist</SelectItem>
          <SelectItem value="2">≥ 2 shortlists</SelectItem>
          <SelectItem value="3">≥ 3 shortlists</SelectItem>
          <SelectItem value="5">≥ 5 shortlists</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/* ─── Pagination ─── */
function Pagination({ page, totalPages, goToPage }: { page: number; totalPages: number; goToPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between">
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => goToPage(page - 1)} className="text-xs rounded-lg"><ChevronLeft className="w-3 h-3 mr-1" /> Précédent</Button>
      <span className="text-xs text-muted-foreground">Page {page + 1} / {totalPages}</span>
      <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => goToPage(page + 1)} className="text-xs rounded-lg">Suivant <ChevronRight className="w-3 h-3 ml-1" /></Button>
    </div>
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
    <div className="space-y-4">
      <VivierFilterBar searchInput={searchInput} setSearchInput={setSearchInput} onSearch={() => updateFilters({ search: searchInput })} filters={filters} updateFilters={updateFilters} />
      {!loading && totalCount > 0 && (
        <div className="text-xs text-muted-foreground">{totalCount} société{totalCount > 1 ? 's' : ''} avec des interactions</div>
      )}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      ) : companies.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
            <Building2 className="w-6 h-6 opacity-40" />
          </div>
          <p className="text-sm font-medium">Aucune société trouvée</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/50 overflow-hidden divide-y divide-border/30">
          {companies.map((c, i) => (
            <motion.button
              key={c.company_airtable_id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
              onClick={() => { setSelectedCompany(c); setSheetOpen(true); }}
              className="w-full text-left px-4 py-3 hover:bg-muted/40 transition-all flex items-center gap-3"
            >
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-[hsl(var(--skalr-purple)/0.12)] to-[hsl(var(--skalr-pink)/0.08)] flex items-center justify-center text-xs font-bold shrink-0 uppercase text-foreground">
                {(c.company_name || '??').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="text-sm font-medium truncate">{c.company_name || 'Sans nom'}</div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {c.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {c.city}</span>}
                  {c.headcount && <span>{c.headcount} emp.</span>}
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {c.contact_count} contact{c.contact_count > 1 ? 's' : ''}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant="secondary" className="text-[9px] gap-0.5 px-1.5 rounded-full"><FileText className="w-3 h-3" /> {c.shortlist_count}</Badge>
                {c.placement_count > 0 && <Badge variant="secondary" className="text-[9px] gap-0.5 px-1.5 rounded-full"><Trophy className="w-3 h-3" /> {c.placement_count}</Badge>}
                {c.note_count > 0 && <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 rounded-full">{c.note_count} notes</Badge>}
              </div>
              <div className="text-[10px] text-muted-foreground shrink-0 w-20 text-right">
                {c.last_interaction_date ? format(new Date(c.last_interaction_date), 'dd MMM yyyy', { locale: fr }) : '—'}
              </div>
            </motion.button>
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

  return (
    <div className="space-y-4">
      <VivierFilterBar searchInput={searchInput} setSearchInput={setSearchInput} onSearch={() => updateFilters({ search: searchInput })} filters={filters} updateFilters={updateFilters} />

      {/* Enrichment controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => handleEnrichAll(false)} disabled={isEnriching || contacts.length === 0} className="h-8 text-xs gap-1.5 rounded-lg bg-gradient-to-r from-[hsl(var(--skalr-purple))] to-[hsl(var(--skalr-pink))] text-white border-0 hover:opacity-90">
          <Sparkles className="w-3.5 h-3.5" />
          {isEnriching ? 'Enrichissement…' : 'Enrichir & qualifier'}
        </Button>
        {enrichments.size > 0 && (
          <Button size="sm" variant="outline" onClick={() => handleEnrichAll(true)} disabled={isEnriching || contacts.length === 0} className="h-8 text-xs gap-1.5 rounded-lg">
            <RefreshCw className="w-3.5 h-3.5" />
            Ré-enrichir
          </Button>
        )}
        {enrichments.size > 0 && (
          <Select value={enrichFilter} onValueChange={(v: any) => setEnrichFilter(v)}>
            <SelectTrigger className="w-[160px] h-8 text-xs rounded-lg border-border/60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les contacts</SelectItem>
              <SelectItem value="relevant">Pertinents uniquement</SelectItem>
              <SelectItem value="with_message">Avec message</SelectItem>
            </SelectContent>
          </Select>
        )}
        {enrichments.size > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {[...enrichments.values()].filter(e => e.is_relevant).length} pertinents · {[...enrichments.values()].filter(e => e.generated_message).length} messages
          </span>
        )}
      </div>

      {/* Progress bar */}
      {isEnriching && (
        <div className="space-y-1">
          <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} className="h-2 rounded-full" />
          <div className="text-[10px] text-muted-foreground">{progress.done} / {progress.total} contacts traités</div>
        </div>
      )}

      {!loading && totalCount > 0 && (
        <div className="text-xs text-muted-foreground">{filteredContacts.length} contact{filteredContacts.length > 1 ? 's' : ''} {enrichFilter !== 'all' ? `(filtrés sur ${totalCount})` : `avec des interactions`}</div>
      )}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      ) : filteredContacts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
            <Users className="w-6 h-6 opacity-40" />
          </div>
          <p className="text-sm font-medium">Aucun contact trouvé</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/50 overflow-hidden divide-y divide-border/30">
          {filteredContacts.map((c, i) => {
            const e = enrichments.get(c.airtable_id);
            return (
              <motion.button
                key={c.airtable_id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                onClick={() => { setSelectedContact(c); setSheetOpen(true); }}
                className="w-full text-left px-4 py-3 hover:bg-muted/40 transition-all flex items-center gap-3"
              >
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[hsl(var(--skalr-purple)/0.12)] to-[hsl(var(--skalr-pink)/0.08)] flex items-center justify-center text-xs font-bold shrink-0 uppercase text-foreground">
                  {(c.full_name || '??').split(' ').map(w => w[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="text-sm font-medium truncate">{c.full_name || 'Sans nom'}</div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    {e?.current_company ? (
                      <span className="flex items-center gap-1 text-[hsl(var(--skalr-purple))]"><Building2 className="w-3 h-3" /> {e.current_company}</span>
                    ) : c.company_name ? (
                      <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {c.company_name}</span>
                    ) : null}
                    {e?.current_job_title ? (
                      <span className="flex items-center gap-1 truncate max-w-[180px] text-[hsl(var(--skalr-purple))]"><Briefcase className="w-3 h-3" /> {e.current_job_title}</span>
                    ) : c.title ? (
                      <span className="flex items-center gap-1 truncate max-w-[180px]"><Briefcase className="w-3 h-3" /> {c.title}</span>
                    ) : null}
                    {c.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {c.city}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {e?.is_relevant === true && <Badge className="text-[9px] gap-0.5 px-1.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">Pertinent</Badge>}
                  {e?.is_relevant === false && <Badge variant="secondary" className="text-[9px] gap-0.5 px-1.5 rounded-full">Non pertinent</Badge>}
                  {e?.generated_message && <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 rounded-full">{e.message_type === 'sms' ? '📱' : '💬'} msg</Badge>}
                  <Badge variant="secondary" className="text-[9px] gap-0.5 px-1.5 rounded-full"><FileText className="w-3 h-3" /> {c.shortlist_count}</Badge>
                  {c.note_count > 0 && <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 rounded-full">{c.note_count} notes</Badge>}
                  {c.placement_count > 0 && <Badge variant="secondary" className="text-[9px] gap-0.5 px-1.5 rounded-full"><Trophy className="w-3 h-3" /> {c.placement_count}</Badge>}
                </div>
                <div className="text-[10px] text-muted-foreground shrink-0 w-20 text-right">
                  {c.last_interaction_date ? format(new Date(c.last_interaction_date), 'dd MMM yyyy', { locale: fr }) : '—'}
                </div>
              </motion.button>
            );
          })}
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
  { value: 'companies', label: 'Sociétés', icon: Building2 },
  { value: 'contacts', label: 'Contacts', icon: Users },
] as const;

export function VivierList() {
  const [activeSubTab, setActiveSubTab] = useState<'companies' | 'contacts'>('companies');

  return (
    <div className="space-y-4">
      <div className="inline-flex gap-1 p-1 rounded-lg bg-muted/50 border border-border/30">
        {subTabs.map((tab) => {
          const isActive = activeSubTab === tab.value;
          const Icon = tab.icon;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveSubTab(tab.value)}
              className={cn(
                "flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-md transition-all duration-200",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>
      {activeSubTab === 'companies' ? <CompaniesView /> : <ContactsView />}
    </div>
  );
}
