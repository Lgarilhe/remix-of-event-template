import React, { useEffect, useState } from 'react';
import { useVivierCandidates, VivierCandidate } from '@/hooks/useVivierCandidates';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Phone, Mail, Linkedin, ChevronLeft, ChevronRight, Users, FileText, Calendar, Trophy, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useCandidateHistory } from '@/hooks/useCandidateHistory';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

function CandidateHistorySheet({ candidate, open, onOpenChange }: { candidate: VivierCandidate | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: history, loading } = useCandidateHistory({ airtableId: candidate?.airtable_id });

  if (!candidate) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">{candidate.full_name || 'Sans nom'}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {/* Contact info */}
          <div className="space-y-1 text-sm">
            {candidate.email && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="w-3.5 h-3.5" /> {candidate.email}
              </div>
            )}
            {candidate.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="w-3.5 h-3.5" /> {candidate.phone}
              </div>
            )}
            {candidate.linkedin_url && (
              <a href={candidate.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                <Linkedin className="w-3.5 h-3.5" /> Profil LinkedIn <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {candidate.skills?.length ? (
            <div className="flex flex-wrap gap-1">
              {candidate.skills.slice(0, 15).map(s => (
                <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
              ))}
            </div>
          ) : null}

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : history ? (
            <>
              {/* Shortlists */}
              {history.shortlists.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Shortlists ({history.shortlists.length})</h4>
                  <div className="space-y-2">
                    {history.shortlists.map(s => (
                      <div key={s.airtable_id} className="border border-border p-2 text-xs space-y-0.5">
                        <div className="font-medium">{s.job_title || 'Poste inconnu'} — {s.company_name || '?'}</div>
                        <div className="text-muted-foreground flex items-center gap-2">
                          {s.date_added && <span>{s.date_added}</span>}
                          {s.status && <Badge variant="outline" className="text-[9px]">{s.status}</Badge>}
                          {s.consultant && <span className="italic">par {s.consultant}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Placements */}
              {history.placements.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Placements ({history.placements.length})</h4>
                  <div className="space-y-2">
                    {history.placements.map(p => (
                      <div key={p.airtable_id} className="border border-border p-2 text-xs space-y-0.5">
                        <div className="font-medium">{p.name || 'Placement'} — {p.company_name || '?'}</div>
                        <div className="text-muted-foreground">
                          {p.start_date && <span>{p.start_date}</span>}
                          {p.status && <> · {p.status}</>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {history.notes.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Notes ({history.notes.length})</h4>
                  <div className="space-y-2">
                    {history.notes.slice(0, 5).map(n => (
                      <div key={n.airtable_id} className="border border-border p-2 text-xs space-y-0.5">
                        <div className="font-medium">{n.title || 'Note'}</div>
                        {n.detail && <div className="text-muted-foreground line-clamp-2">{n.detail}</div>}
                        <div className="text-muted-foreground">
                          {n.note_date} {n.consultant && <span className="italic">— {n.consultant}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Appointments */}
              {history.appointments.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Rendez-vous ({history.appointments.length})</h4>
                  <div className="space-y-2">
                    {history.appointments.slice(0, 5).map(a => (
                      <div key={a.airtable_id} className="border border-border p-2 text-xs space-y-0.5">
                        <div className="font-medium">{a.title || 'RDV'}</div>
                        <div className="text-muted-foreground">
                          {a.appointment_date} {a.appointment_type && <> · {a.appointment_type}</>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun historique trouvé.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function VivierList() {
  const {
    candidates,
    totalCount,
    loading,
    filters,
    updateFilters,
    fetchCandidates,
    page,
    goToPage,
    pageSize,
  } = useVivierCandidates();

  const [searchInput, setSearchInput] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<VivierCandidate | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    fetchCandidates();
  }, []);

  const handleSearch = () => {
    updateFilters({ search: searchInput });
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Rechercher par nom, email, téléphone…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="pl-8 h-9 text-xs"
            />
          </div>
        </div>
        <Select
          value={filters.source_base || 'all'}
          onValueChange={v => updateFilters({ source_base: v === 'all' ? null : v })}
        >
          <SelectTrigger className="w-[140px] h-9 text-xs">
            <SelectValue placeholder="Base" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les bases</SelectItem>
            <SelectItem value="konekt">Konekt</SelectItem>
            <SelectItem value="konekt_prospect">Konekt Prospect</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={String(filters.min_shortlists)}
          onValueChange={v => updateFilters({ min_shortlists: Number(v) })}
        >
          <SelectTrigger className="w-[130px] h-9 text-xs">
            <SelectValue placeholder="Min shortlists" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">≥ 1 shortlist</SelectItem>
            <SelectItem value="2">≥ 2 shortlists</SelectItem>
            <SelectItem value="3">≥ 3 shortlists</SelectItem>
            <SelectItem value="5">≥ 5 shortlists</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={handleSearch} className="h-9 text-xs">
          Rechercher
        </Button>
      </div>

      {/* Stats bar */}
      {!loading && totalCount > 0 && (
        <div className="text-xs text-muted-foreground">
          {totalCount} candidat{totalCount > 1 ? 's' : ''} avec des interactions significatives
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : candidates.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Aucun candidat trouvé</p>
          <p className="text-xs mt-1">Ajustez vos filtres ou lancez une recherche</p>
        </div>
      ) : (
        <div className="border border-border divide-y divide-border">
          {candidates.map(c => (
            <button
              key={c.airtable_id}
              onClick={() => { setSelectedCandidate(c); setSheetOpen(true); }}
              className="w-full text-left px-3 py-2.5 hover:bg-accent/50 transition-colors flex items-center gap-3"
            >
              {/* Avatar */}
              <div className="h-9 w-9 bg-foreground text-background flex items-center justify-center text-xs font-bold shrink-0 uppercase">
                {(c.full_name || '??').split(' ').map(w => w[0]).join('').slice(0, 2)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="text-sm font-medium truncate">{c.full_name || 'Sans nom'}</div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  {c.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {c.phone}
                    </span>
                  )}
                  {c.email && (
                    <span className="flex items-center gap-1 truncate max-w-[180px]">
                      <Mail className="w-3 h-3" /> {c.email}
                    </span>
                  )}
                  {c.linkedin_url && (
                    <span className="flex items-center gap-1">
                      <Linkedin className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </div>

              {/* Interaction badges */}
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant="secondary" className="text-[9px] gap-0.5 px-1.5">
                  <FileText className="w-3 h-3" /> {c.shortlist_count}
                </Badge>
                {c.note_count > 0 && (
                  <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5">
                    <FileText className="w-3 h-3" /> {c.note_count}
                  </Badge>
                )}
                {c.appointment_count > 0 && (
                  <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5">
                    <Calendar className="w-3 h-3" /> {c.appointment_count}
                  </Badge>
                )}
                {c.placement_count > 0 && (
                  <Badge className="text-[9px] gap-0.5 px-1.5 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                    <Trophy className="w-3 h-3" /> {c.placement_count}
                  </Badge>
                )}
              </div>

              {/* Last interaction */}
              <div className="text-[10px] text-muted-foreground shrink-0 w-20 text-right">
                {c.last_interaction_date ? format(new Date(c.last_interaction_date), 'dd MMM yyyy', { locale: fr }) : '—'}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => goToPage(page - 1)}
            className="text-xs"
          >
            <ChevronLeft className="w-3 h-3 mr-1" /> Précédent
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => goToPage(page + 1)}
            className="text-xs"
          >
            Suivant <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
      )}

      {/* History sheet */}
      <CandidateHistorySheet
        candidate={selectedCandidate}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  );
}
