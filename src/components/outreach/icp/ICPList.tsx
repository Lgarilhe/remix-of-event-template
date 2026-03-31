import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Target, Pencil, Trash2, Building2, Users, Zap, MapPin, Briefcase, Code, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { useICPs, ICP, ICPCriteria } from '@/hooks/useICPs';
import { ICPFormModal } from './ICPFormModal';
import { cn } from '@/lib/utils';

const TARGET_TYPE_LABELS: Record<string, { label: string; emoji: string }> = {
  client: { label: 'Client', emoji: '🏢' },
  candidate: { label: 'Candidat', emoji: '👤' },
  both: { label: 'Client & Candidat', emoji: '🎯' },
};

function CriteriaPreview({ criteria }: { criteria: ICPCriteria }) {
  const items: { icon: React.ElementType; label: string; values: string[] }[] = [];

  if (criteria.industries?.length) items.push({ icon: Building2, label: 'Secteurs', values: criteria.industries });
  if (criteria.target_titles?.length) items.push({ icon: Briefcase, label: 'Postes', values: criteria.target_titles });
  if (criteria.geographies?.length) items.push({ icon: MapPin, label: 'Localisation', values: criteria.geographies });
  if (criteria.technologies?.length) items.push({ icon: Code, label: 'Technologies', values: criteria.technologies });
  if (criteria.company_sizes?.length) items.push({ icon: Building2, label: 'Taille', values: criteria.company_sizes });
  if (criteria.seniority_levels?.length) items.push({ icon: Users, label: 'Séniorité', values: criteria.seniority_levels });

  if (items.length === 0) return <span className="text-xs text-muted-foreground italic">Aucun critère défini</span>;

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {items.slice(0, 4).map((item, i) => (
        <div key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
          <item.icon className="w-3 h-3 shrink-0" />
          <span className="truncate max-w-[200px]">{item.values.slice(0, 3).join(', ')}{item.values.length > 3 ? ` +${item.values.length - 3}` : ''}</span>
        </div>
      ))}
      {items.length > 4 && (
        <span className="text-xs text-muted-foreground">+{items.length - 4} critères</span>
      )}
    </div>
  );
}

function ICPCard({ icp, onEdit, onDelete, onSearch }: { icp: ICP; onEdit: () => void; onDelete: () => void; onSearch?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = TARGET_TYPE_LABELS[icp.target_type] || TARGET_TYPE_LABELS.both;

  const allCriteria: { label: string; values: string[] }[] = [];
  const c = icp.criteria;
  if (c.industries?.length) allCriteria.push({ label: 'Secteurs', values: c.industries });
  if (c.company_sizes?.length) allCriteria.push({ label: 'Taille entreprise', values: c.company_sizes });
  if (c.target_titles?.length) allCriteria.push({ label: 'Postes ciblés', values: c.target_titles });
  if (c.seniority_levels?.length) allCriteria.push({ label: 'Séniorité', values: c.seniority_levels });
  if (c.geographies?.length) allCriteria.push({ label: 'Localisation', values: c.geographies });
  if (c.technologies?.length) allCriteria.push({ label: 'Technologies', values: c.technologies });
  if (c.funding_stages?.length) allCriteria.push({ label: 'Financement', values: c.funding_stages });
  if (c.languages?.length) allCriteria.push({ label: 'Langues', values: c.languages });
  if (c.keywords?.length) allCriteria.push({ label: 'Mots-clés', values: c.keywords });
  if (c.exclusion_keywords?.length) allCriteria.push({ label: 'Exclusions', values: c.exclusion_keywords });
  if (c.experience_range?.min !== undefined || c.experience_range?.max !== undefined) {
    allCriteria.push({ label: 'Expérience', values: [`${c.experience_range.min ?? 0} - ${c.experience_range.max ?? '∞'} ans`] });
  }

  return (
    <div className="border border-foreground/15 bg-background hover:border-foreground/30 transition-colors group">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm">{typeInfo.emoji}</span>
              <h3 className="text-sm font-semibold text-foreground truncate">{icp.name}</h3>
              <Badge variant="outline" className="text-xs shrink-0 border-foreground/20">
                {typeInfo.label}
              </Badge>
            </div>
            {icp.description && (
              <p className="text-xs text-muted-foreground mb-2 line-clamp-1">{icp.description}</p>
            )}
            <CriteriaPreview criteria={icp.criteria} />
          </div>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            {onSearch && (
              <Button variant="ghost" size="sm" onClick={onSearch} className="h-7 w-7 p-0" title="Rechercher avec cet ICP">
                <Search className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 w-7 p-0">
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete} className="h-7 w-7 p-0 hover:text-destructive">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {allCriteria.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground mt-2 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'Masquer' : 'Voir tous les critères'} ({allCriteria.length})
          </button>
        )}
      </div>

      {expanded && allCriteria.length > 0 && (
        <div className="border-t border-foreground/10 px-4 py-3 bg-muted/30 space-y-2">
          {allCriteria.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground w-28 shrink-0 pt-0.5">{item.label}</span>
              <div className="flex flex-wrap gap-1">
                {item.values.map((v, j) => (
                  <Badge key={j} variant="outline" className="text-xs border-foreground/15 font-normal">
                    {v}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ICPList({ onSearchFromICP }: { onSearchFromICP?: (icp: ICP) => void } = {}) {
  const { icps, isLoading, createICP, updateICP, deleteICP } = useICPs();
  const [formOpen, setFormOpen] = useState(false);
  const [editingICP, setEditingICP] = useState<ICP | null>(null);

  const handleSave = (data: { name: string; description: string; target_type: 'client' | 'candidate' | 'both'; criteria: any }) => {
    if (editingICP) {
      updateICP.mutate({ id: editingICP.id, ...data }, {
        onSuccess: () => { setFormOpen(false); setEditingICP(null); },
      });
    } else {
      createICP.mutate(data, {
        onSuccess: () => { setFormOpen(false); },
      });
    }
  };

  const handleEdit = (icp: ICP) => {
    setEditingICP(icp);
    setFormOpen(true);
  };

  const handleDelete = (icp: ICP) => {
    if (window.confirm(`Supprimer l'ICP "${icp.name}" ?`)) {
      deleteICP.mutate(icp.id);
    }
  };

  return (
    <div className="bg-background border border-foreground p-3 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4" />
          <h2 className="text-sm font-bold uppercase tracking-wider">Profils Cibles (ICP)</h2>
          <Badge variant="outline" className="text-xs border-foreground/20">{icps.length}</Badge>
        </div>
        <Button
          onClick={() => { setEditingICP(null); setFormOpen(true); }}
          className="h-[30px] px-3 bg-foreground text-background hover:bg-foreground/90 text-xs font-medium uppercase tracking-wider gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Nouvel ICP
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 border border-foreground/10 animate-pulse bg-muted/20" />
          ))}
        </div>
      ) : icps.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-foreground/20">
          <Target className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
          <h3 className="text-sm font-semibold text-foreground mb-1">Aucun ICP défini</h3>
          <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
            Créez votre premier Profil Client/Candidat Idéal pour structurer votre prospection.
          </p>
          <Button
            onClick={() => setFormOpen(true)}
            variant="outline"
            className="text-xs border-foreground/30 gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Créer un ICP
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {icps.map(icp => (
            <ICPCard key={icp.id} icp={icp} onEdit={() => handleEdit(icp)} onDelete={() => handleDelete(icp)} onSearch={onSearchFromICP ? () => onSearchFromICP(icp) : undefined} />
          ))}
        </div>
      )}

      <ICPFormModal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingICP(null); }}
        onSave={handleSave}
        initialData={editingICP}
        saving={createICP.isPending || updateICP.isPending}
      />
    </div>
  );
}
