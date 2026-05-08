import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Plus, X, Loader2, Target, Globe, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useClientCompetitors } from '@/hooks/useClientCompetitors';
import { RELATION_KIND_LABELS, type ClientCompetitor, type CompetitorSuggestion } from '@/types/clientCompetitor';
import { cn } from '@/lib/utils';

interface Props {
  clientName?: string | null;
  clientSector?: string | null;
  clientCountry?: string | null;
  clientDescription?: string | null;
  /** Mode chirurgical : si true, la search Unipile sera restreinte aux concurrents. */
  restrictToCompetitors: boolean;
  onChangeRestrict: (next: boolean) => void;
  readOnly?: boolean;
}

/**
 * Bloc de gestion des concurrents pour le client de la mission.
 *
 * - Affiche la liste des concurrents persistés (org_competitors per client_name)
 * - Bouton AI pour générer des suggestions (Claude Haiku)
 * - Ajout manuel
 * - Toggle "Cibler uniquement les concurrents" → injection IDs Unipile
 *
 * Auto-suggest : si client.name est non-vide et qu'aucun concurrent n'existe,
 * affiche un soft-prompt invitant à générer (sans déclencher l'IA d'office).
 */
export const ClientCompetitorsBlock: React.FC<Props> = ({
  clientName, clientSector, clientCountry, clientDescription,
  restrictToCompetitors, onChangeRestrict, readOnly,
}) => {
  const {
    competitors, generating, addCompetitor, removeCompetitor, toggleCompetitor,
    bulkInsertSuggestions, generateSuggestions,
  } = useClientCompetitors(clientName);

  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<CompetitorSuggestion[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [softPromptDismissed, setSoftPromptDismissed] = useState(false);

  // Reset soft-prompt dismissal quand le client change
  const lastClientRef = useRef<string | null | undefined>(clientName);
  useEffect(() => {
    if (lastClientRef.current !== clientName) {
      lastClientRef.current = clientName;
      setSoftPromptDismissed(false);
    }
  }, [clientName]);

  if (!clientName?.trim()) {
    // Pas de client → pas de bloc
    return null;
  }

  const showSoftPrompt = competitors.length === 0 && !softPromptDismissed && !readOnly;

  const handleGenerate = async () => {
    const result = await generateSuggestions(
      clientSector || undefined,
      clientCountry || undefined,
      clientDescription || undefined,
    );
    if (result.length > 0) {
      // Filtrer ceux qui existent déjà
      const existing = new Set(competitors.map((c) => c.competitor_name.toLowerCase()));
      const fresh = result.filter((s) => !existing.has(s.name.toLowerCase()));
      setSuggestions(fresh);
      setSelectedSuggestions(new Set(fresh.map((_, i) => i))); // tout coché par défaut
      setSuggestionsOpen(true);
    }
  };

  const handleAcceptSuggestions = async () => {
    const toInsert = suggestions.filter((_, i) => selectedSuggestions.has(i));
    const inserted = await bulkInsertSuggestions(toInsert);
    setSuggestionsOpen(false);
    setSuggestions([]);
    setSelectedSuggestions(new Set());
    if (inserted > 0) {
      // pas de toast : la liste se met à jour visuellement
    }
  };

  const handleManualAdd = async () => {
    if (!manualName.trim()) return;
    const result = await addCompetitor({ competitor_name: manualName.trim() });
    if (result) {
      setManualName('');
      setManualOpen(false);
    }
  };

  return (
    <>
      <div className="border-2 border-dashed border-border rounded-lg p-4 bg-muted/20 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Target className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider">
                Concurrents du client
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Boost le scoring des profils issus de ces boîtes. Mode chirurgical : restreindre la recherche Unipile.
              </p>
            </div>
          </div>
          {competitors.length > 0 && (
            <Badge variant="secondary" className="text-3xs shrink-0">
              {competitors.filter((c) => c.enabled).length} actif{competitors.filter((c) => c.enabled).length > 1 ? 's' : ''}
            </Badge>
          )}
        </div>

        {/* Soft-prompt auto-suggest */}
        {showSoftPrompt && (
          <div className="flex items-start gap-2 p-2.5 border border-primary/20 bg-primary/5 rounded-md">
            <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground">
                Pas de concurrents configurés pour <strong>{clientName}</strong>. L'IA peut suggérer une liste.
              </p>
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="default" className="h-7 text-3xs gap-1.5" disabled={generating} onClick={handleGenerate}>
                  {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Suggérer avec l'IA
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-3xs" onClick={() => setSoftPromptDismissed(true)}>
                  Plus tard
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Liste des concurrents */}
        {competitors.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {competitors.map((c) => (
              <CompetitorPill
                key={c.id}
                competitor={c}
                onRemove={() => removeCompetitor(c.id)}
                onToggle={() => toggleCompetitor(c.id)}
                readOnly={readOnly}
              />
            ))}
          </div>
        )}

        {/* Actions */}
        {!readOnly && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border/60">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={generating} onClick={handleGenerate}>
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {competitors.length > 0 ? 'Suggérer plus' : 'Suggérer avec l\'IA'}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setManualOpen(true)}>
              <Plus className="w-3.5 h-3.5" />
              Ajouter manuellement
            </Button>
          </div>
        )}

        {/* Mode chirurgical */}
        {competitors.length > 0 && (
          <div className="flex items-start justify-between gap-3 p-3 border border-border rounded-md bg-background">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Target className="w-3.5 h-3.5" />
                Mode chirurgical
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Restreint la recherche Unipile aux profils ayant bossé chez ces concurrents (poach mode).
                Sinon, la liste influe seulement sur le scoring (signal positif fort).
              </p>
            </div>
            <Switch
              checked={restrictToCompetitors}
              onCheckedChange={onChangeRestrict}
              disabled={readOnly}
            />
          </div>
        )}
      </div>

      {/* Dialog : valider les suggestions AI */}
      <Dialog open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Concurrents suggérés pour {clientName}</DialogTitle>
            <DialogDescription>
              Décochez ceux que tu ne veux pas ajouter. {suggestions.length} suggestion{suggestions.length > 1 ? 's' : ''}.
            </DialogDescription>
          </DialogHeader>

          {suggestions.length === 0 ? (
            <div className="flex items-center gap-2 p-3 border border-amber-500/20 bg-amber-500/5 rounded-md">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Aucune suggestion disponible. Essaie d'ajouter manuellement.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {suggestions.map((s, i) => {
                const checked = selectedSuggestions.has(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      const next = new Set(selectedSuggestions);
                      if (checked) next.delete(i); else next.add(i);
                      setSelectedSuggestions(next);
                    }}
                    className={cn(
                      'w-full flex items-start gap-3 p-3 border rounded-md text-left transition-colors',
                      checked
                        ? 'border-emerald-500/40 bg-emerald-500/5'
                        : 'border-border bg-background hover:border-foreground/30',
                    )}
                  >
                    <div className={cn(
                      'w-4 h-4 rounded border-2 flex items-center justify-center mt-0.5 shrink-0',
                      checked ? 'border-emerald-500 bg-emerald-500' : 'border-border',
                    )}>
                      {checked && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{s.name}</span>
                        <Badge variant="outline" className="text-3xs">
                          {RELATION_KIND_LABELS[s.relation_kind]}
                        </Badge>
                        {s.country && (
                          <Badge variant="secondary" className="text-3xs gap-1">
                            <Globe className="w-2.5 h-2.5" /> {s.country}
                          </Badge>
                        )}
                      </div>
                      {s.reason && <p className="text-xs text-muted-foreground mt-1">{s.reason}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSuggestionsOpen(false)}>Annuler</Button>
            <Button onClick={handleAcceptSuggestions} disabled={selectedSuggestions.size === 0}>
              Ajouter {selectedSuggestions.size} concurrent{selectedSuggestions.size > 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog : ajout manuel */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajouter un concurrent</DialogTitle>
            <DialogDescription>Nom officiel de l'entreprise.</DialogDescription>
          </DialogHeader>
          <Input
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            placeholder="ex: Stripe"
            onKeyDown={(e) => e.key === 'Enter' && handleManualAdd()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>Annuler</Button>
            <Button onClick={handleManualAdd} disabled={!manualName.trim()}>Ajouter</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const CompetitorPill: React.FC<{
  competitor: ClientCompetitor;
  onRemove: () => void;
  onToggle: () => void;
  readOnly?: boolean;
}> = ({ competitor, onRemove, onToggle, readOnly }) => {
  const isAi = competitor.source === 'ai_suggested';
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 pl-2 pr-1 py-1 border rounded-md text-xs transition-opacity',
        competitor.enabled
          ? 'border-foreground/30 bg-background'
          : 'border-border bg-muted/30 opacity-60',
      )}
    >
      <button
        type="button"
        onClick={readOnly ? undefined : onToggle}
        title={competitor.enabled ? 'Cliquer pour désactiver' : 'Cliquer pour activer'}
        disabled={readOnly}
        className={cn(
          'flex items-center gap-1.5',
          !readOnly && 'cursor-pointer hover:opacity-70',
        )}
      >
        <span className="font-medium">{competitor.competitor_name}</span>
        {isAi && <Sparkles className="w-2.5 h-2.5 text-muted-foreground" />}
        {competitor.country && (
          <span className="text-3xs text-muted-foreground uppercase">{competitor.country}</span>
        )}
      </button>
      {!readOnly && (
        <button
          type="button"
          onClick={onRemove}
          title="Retirer"
          className="ml-1 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};
