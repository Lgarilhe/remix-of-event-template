import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Bookmark,
  BookmarkPlus,
  Clock,
  Trash2,
  ChevronDown,
  Briefcase,
  Loader2,
  Hash,
} from 'lucide-react';
import { LinkedInFiltersState } from './types';
import { useSavedFilterPresets, SavedFilterPreset } from '@/hooks/useSavedFilterPresets';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Job } from '@/pages/JobSpace';

interface FilterPresetsManagerProps {
  currentFilters: LinkedInFiltersState;
  onApplyFilters: (filters: LinkedInFiltersState) => void;
  selectedJob?: Job | null;
  onApplyPresetJob?: (jobId: string | null, jobTitle: string | null) => void;
}

export const FilterPresetsManager: React.FC<FilterPresetsManagerProps> = ({
  currentFilters,
  onApplyFilters,
  selectedJob,
  onApplyPresetJob,
}) => {
  const { presets, loading, saving, savePreset, applyPreset, deletePreset } = useSavedFilterPresets();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetDescription, setPresetDescription] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const handleSavePreset = async () => {
    if (!presetName.trim()) return;

    const success = await savePreset(
      presetName.trim(),
      currentFilters,
      selectedJob?.id,
      selectedJob?.title,
      presetDescription.trim() || undefined
    );

    if (success) {
      setSaveDialogOpen(false);
      setPresetName('');
      setPresetDescription('');
    }
  };

  const handleApplyPreset = async (preset: SavedFilterPreset) => {
    const filters = await applyPreset(preset);
    if (filters) {
      onApplyFilters(filters);
      // Also restore the associated job if available
      if (onApplyPresetJob) {
        onApplyPresetJob(preset.job_id, preset.job_title);
      }
      setPopoverOpen(false);
    }
  };

  const handleDeletePreset = async () => {
    if (!deleteConfirmId) return;
    await deletePreset(deleteConfirmId);
    setDeleteConfirmId(null);
  };

  // Count active filters for display
  const countActiveFilters = (filters: LinkedInFiltersState): number => {
    let count = 0;
    if (filters.keywords) count++;
    count += filters.location.length;
    count += filters.company.length;
    count += filters.industry.length;
    count += filters.school.length;
    count += filters.job_title.length;
    count += filters.skills.length;
    count += filters.role.length;
    count += filters.seniority.length;
    if (filters.calculated_experience_min !== null) count++;
    if (filters.calculated_experience_max !== null) count++;
    return count;
  };

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-xs h-8"
          >
            <Bookmark className="w-3.5 h-3.5" />
            Favoris
            {presets.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {presets.length}
              </Badge>
            )}
            <ChevronDown className="w-3 h-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <div className="p-3 border-b">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">Filtres sauvegardés</h4>
              <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs">
                    <BookmarkPlus className="w-3.5 h-3.5" />
                    Sauvegarder
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Sauvegarder les filtres</DialogTitle>
                    <DialogDescription>
                      Donnez un nom à cette combinaison de filtres pour la réutiliser plus tard.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="preset-name">Nom du preset</Label>
                      <Input
                        id="preset-name"
                        placeholder="Ex: Dev Senior Paris Remote"
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="preset-description">Description (optionnel)</Label>
                      <Input
                        id="preset-description"
                        placeholder="Ex: Pour les postes tech confirmés..."
                        value={presetDescription}
                        onChange={(e) => setPresetDescription(e.target.value)}
                      />
                    </div>
                    {selectedJob && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-2 rounded-md">
                        <Briefcase className="w-4 h-4" />
                        <span>Lié au poste : {selectedJob.title}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Hash className="w-4 h-4" />
                      <span>{countActiveFilters(currentFilters)} filtre(s) actif(s)</span>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setSaveDialogOpen(false)}
                    >
                      Annuler
                    </Button>
                    <Button
                      onClick={handleSavePreset}
                      disabled={!presetName.trim() || saving}
                    >
                      {saving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Sauvegarde...
                        </>
                      ) : (
                        'Sauvegarder'
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <ScrollArea className="max-h-[300px]">
            {loading ? (
              <div className="p-3 space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : presets.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Bookmark className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>Aucun preset sauvegardé</p>
                <p className="text-xs mt-1">Configurez vos filtres et cliquez sur "Sauvegarder"</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="group flex items-start gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => handleApplyPreset(preset)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{preset.name}</span>
                        {preset.job_title && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">
                            {preset.job_title.substring(0, 15)}...
                          </Badge>
                        )}
                      </div>
                      {preset.description && (
                        <p className="text-xs text-muted-foreground truncate">{preset.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Hash className="w-3 h-3" />
                          {countActiveFilters(preset.filters)} filtres
                        </span>
                        {preset.usage_count > 0 && (
                          <span>Utilisé {preset.usage_count}x</span>
                        )}
                        {preset.last_used_at && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDistanceToNow(new Date(preset.last_used_at), { addSuffix: true, locale: fr })}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(preset.id);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>

      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce preset ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Le preset sera définitivement supprimé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePreset} className="bg-destructive hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
