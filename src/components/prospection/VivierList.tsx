import React, { useEffect, useState } from 'react';
import { useVivierContacts, useVivierCompanies, VivierContact, VivierCompany } from '@/hooks/useVivierCandidates';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Mail, Building2, ChevronLeft, ChevronRight, Users, FileText, Calendar, Trophy, MapPin, Briefcase, ChevronDown, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';

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

      // Resolve job titles
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
            <Building2 className="w-5 h-5" /> {company.company_name || 'Société'}
          </SheetTitle>
          {company.city && <p className="text-sm text-muted-foreground text-left flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {company.city}</p>}
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {company.description && <p className="text-xs text-muted-foreground line-clamp-3">{company.description}</p>}
          {company.headcount && <Badge variant="outline" className="text-[10px]">{company.headcount} employés</Badge>}

          {/* Stats */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Contacts', value: company.contact_count },
              { label: 'Shortlists', value: company.shortlist_count },
              { label: 'Placements', value: company.placement_count },
              { label: 'Notes', value: company.note_count },
            ].map(s => (
              <div key={s.label} className="border border-border p-2 text-center">
                <div className="text-lg font-bold">{s.value}</div>
                <div className="text-[10px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>

          {loadingDetails ? (
            <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>
          ) : (
            <>
              {/* Contacts */}
              {contacts.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Contacts ({contacts.length})</h4>
                  <div className="space-y-1.5">
                    {contacts.map((ct: any) => (
                      <div key={ct.airtable_id} className="border border-border p-2 text-xs flex items-center gap-2">
                        <div className="h-7 w-7 bg-foreground text-background flex items-center justify-center text-[9px] font-bold shrink-0 uppercase">
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

              {/* Shortlists */}
              {shortlists.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Shortlists ({shortlists.length})</h4>
                  <div className="space-y-1.5">
                    {shortlists.map((s: any) => (
                      <div key={s.airtable_id} className="border border-border p-2 text-xs space-y-0.5">
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

/* ─── Contact Detail Sheet ─── */
function ContactDetailSheet({ contact, open, onOpenChange }: { contact: VivierContact | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [shortlists, setShortlists] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    if (!contact || !open) return;
    setLoadingDetails(true);
    const fetch = async () => {
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
    fetch();
  }, [contact, open]);

  if (!contact) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">{contact.full_name || 'Sans nom'}</SheetTitle>
          {contact.title && <p className="text-sm text-muted-foreground text-left">{contact.title}</p>}
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="space-y-1 text-sm">
            {contact.company_name && <div className="flex items-center gap-2 text-muted-foreground"><Building2 className="w-3.5 h-3.5" /> {contact.company_name}</div>}
            {contact.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="w-3.5 h-3.5" /> {contact.email}</div>}
            {contact.city && <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="w-3.5 h-3.5" /> {contact.city}</div>}
          </div>

          {loadingDetails ? (
            <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>
          ) : (
            <>
              {shortlists.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Shortlists</h4>
                  <div className="space-y-1.5">
                    {shortlists.map((s: any) => (
                      <div key={s.airtable_id} className="border border-border p-2 text-xs space-y-0.5">
                        <div className="font-medium">{s.job_title || 'Poste inconnu'}</div>
                        <div className="text-muted-foreground">{s.candidate_name} {s.date_added && `· ${s.date_added}`} {s.status && <Badge variant="outline" className="text-[9px] ml-1">{s.status}</Badge>}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {notes.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Notes</h4>
                  <div className="space-y-1.5">
                    {notes.map((n: any) => (
                      <div key={n.airtable_id} className="border border-border p-2 text-xs space-y-0.5">
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
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Rechercher…" value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSearch()} className="pl-8 h-9 text-xs" />
        </div>
      </div>
      <Select value={filters.source_base || 'all'} onValueChange={v => updateFilters({ source_base: v === 'all' ? null : v })}>
        <SelectTrigger className="w-[140px] h-9 text-xs"><SelectValue placeholder="Base" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes les bases</SelectItem>
          <SelectItem value="konekt">Konekt</SelectItem>
          <SelectItem value="konekt_prospect">Konekt Prospect</SelectItem>
        </SelectContent>
      </Select>
      <Select value={String(filters.min_shortlists)} onValueChange={v => updateFilters({ min_shortlists: Number(v) })}>
        <SelectTrigger className="w-[130px] h-9 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="1">≥ 1 shortlist</SelectItem>
          <SelectItem value="2">≥ 2 shortlists</SelectItem>
          <SelectItem value="3">≥ 3 shortlists</SelectItem>
          <SelectItem value="5">≥ 5 shortlists</SelectItem>
        </SelectContent>
      </Select>
      <Button size="sm" onClick={onSearch} className="h-9 text-xs">Rechercher</Button>
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
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : companies.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Aucune société trouvée</p>
        </div>
      ) : (
        <div className="border border-border divide-y divide-border">
          {companies.map(c => (
            <button key={c.company_airtable_id} onClick={() => { setSelectedCompany(c); setSheetOpen(true); }}
              className="w-full text-left px-3 py-2.5 hover:bg-accent/50 transition-colors flex items-center gap-3">
              <div className="h-9 w-9 bg-foreground text-background flex items-center justify-center text-xs font-bold shrink-0 uppercase">
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
                <Badge variant="secondary" className="text-[9px] gap-0.5 px-1.5"><FileText className="w-3 h-3" /> {c.shortlist_count}</Badge>
                {c.placement_count > 0 && <Badge variant="secondary" className="text-[9px] gap-0.5 px-1.5"><Trophy className="w-3 h-3" /> {c.placement_count}</Badge>}
                {c.note_count > 0 && <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5">{c.note_count} notes</Badge>}
              </div>
              <div className="text-[10px] text-muted-foreground shrink-0 w-20 text-right">
                {c.last_interaction_date ? format(new Date(c.last_interaction_date), 'dd MMM yyyy', { locale: fr }) : '—'}
              </div>
            </button>
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
  const [searchInput, setSearchInput] = useState('');
  const [selectedContact, setSelectedContact] = useState<VivierContact | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => { fetchContacts(); }, []);

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-4">
      <VivierFilterBar searchInput={searchInput} setSearchInput={setSearchInput} onSearch={() => updateFilters({ search: searchInput })} filters={filters} updateFilters={updateFilters} />

      {!loading && totalCount > 0 && (
        <div className="text-xs text-muted-foreground">{totalCount} contact{totalCount > 1 ? 's' : ''} avec des interactions</div>
      )}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Aucun contact trouvé</p>
        </div>
      ) : (
        <div className="border border-border divide-y divide-border">
          {contacts.map(c => (
            <button key={c.airtable_id} onClick={() => { setSelectedContact(c); setSheetOpen(true); }}
              className="w-full text-left px-3 py-2.5 hover:bg-accent/50 transition-colors flex items-center gap-3">
              <div className="h-9 w-9 bg-foreground text-background flex items-center justify-center text-xs font-bold shrink-0 uppercase">
                {(c.full_name || '??').split(' ').map(w => w[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="text-sm font-medium truncate">{c.full_name || 'Sans nom'}</div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {c.company_name && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> {c.company_name}</span>}
                  {c.title && <span className="flex items-center gap-1 truncate max-w-[180px]"><Briefcase className="w-3 h-3" /> {c.title}</span>}
                  {c.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {c.city}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant="secondary" className="text-[9px] gap-0.5 px-1.5"><FileText className="w-3 h-3" /> {c.shortlist_count}</Badge>
                {c.note_count > 0 && <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5">{c.note_count} notes</Badge>}
                {c.placement_count > 0 && <Badge variant="secondary" className="text-[9px] gap-0.5 px-1.5"><Trophy className="w-3 h-3" /> {c.placement_count}</Badge>}
              </div>
              <div className="text-[10px] text-muted-foreground shrink-0 w-20 text-right">
                {c.last_interaction_date ? format(new Date(c.last_interaction_date), 'dd MMM yyyy', { locale: fr }) : '—'}
              </div>
            </button>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} goToPage={goToPage} />
      <ContactDetailSheet contact={selectedContact} open={sheetOpen} onOpenChange={setSheetOpen} />
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
    <div className="space-y-3">
      {/* Sub-tabs */}
      <div className="flex gap-0">
        {subTabs.map((tab, i) => {
          const isActive = activeSubTab === tab.value;
          const Icon = tab.icon;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveSubTab(tab.value)}
              className={cn(
                "flex items-center gap-1.5 h-8 px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground transition-colors",
                i > 0 && "border-l-0",
                isActive ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-accent/50"
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
