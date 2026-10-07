import React, { useState } from 'react';
import { Plus, Trash2, Pencil, Building2, Shield, AlertCircle, Bookmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorState } from '@/components/layout/ErrorState';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { usePedigreePresets } from '@/hooks/usePedigreePresets';
import {
  type ClientPedigreePreset,
  type PedigreeRequirements,
  COMPANY_PROVENANCE_LABELS,
  COMPANY_AVOID_LABELS,
  DIPLOMA_ORIGIN_LABELS,
  SENIORITY_LABELS,
} from '@/types/pedigreePreset';
import { PedigreeRequirementsEditor, cleanRequirements } from '@/components/pedigree/PedigreeRequirementsEditor';
import { plural } from '@/lib/plural';

const EMPTY_REQUIREMENTS: PedigreeRequirements = {
  schools_required: [],
  diploma_must_be_from: 'any',
  companies_required_provenance: [],
  companies_specific_required: [],
  companies_avoid: [],
  strict_mode: false,
  custom_instructions: '',
};

export const PedigreePresetsSettings: React.FC = () => {
  const { presets, loading, isError, refresh, createPreset, updatePreset, deletePreset } = usePedigreePresets();
  const [editing, setEditing] = useState<ClientPedigreePreset | null>(null);
  const [creating, setCreating] = useState(false);

  const isFormOpen = creating || editing !== null;
  const closeForm = () => { setCreating(false); setEditing(null); };

  return (
    <Card>
      {/* Revue design (F-01) : titre en casse de phrase, action dans l'emplacement de droite (plus dans le titre). */}
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Bookmark className="h-4 w-4" aria-hidden="true" />
          ICP par société
        </CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCreating(true)}
          className="shrink-0 max-md:h-11"
        >
          <Plus aria-hidden="true" />
          Nouvel ICP
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground max-w-2xl">
          L'ICP (profil de candidat idéal) d'une société dit ce qui fait un bon candidat pour elle :
          écoles, entreprises, séniorité, stade de financement. Il s'applique à toutes les missions de
          la société, et l'évaluation des candidats par l'assistant le fait passer avant les règles
          d'équité par défaut.
        </p>

        {/* RGPD note. Revue design (F-13) : jetons de statut, plus d'ambre brut ni de variante dark: morte. */}
        <div className="flex items-start gap-3 rounded-lg border border-warning/25 bg-warning-muted p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-xs text-foreground">
            <strong>Note RGPD</strong> : ces critères ciblent l'objectif (école, type d'entreprise) et
            non l'origine du candidat. Discriminer sur la nationalité ou l'origine ethnique est illégal
            en France. Préférez « diplôme délivré par un établissement français » à toute formulation
            excluant explicitement des candidats étrangers.
          </p>
        </div>

        {/* Liste des ICP */}
        {loading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <p role="status" className="sr-only">Chargement des ICP…</p>
            <Skeleton className="h-28 w-full rounded-lg" aria-hidden="true" />
            <Skeleton className="h-28 w-full rounded-lg" aria-hidden="true" />
          </div>
        ) : isError ? (
          <ErrorState
            variant="compact"
            title="Impossible de charger les ICP."
            description="Vérifiez votre connexion, puis réessayez."
            onRetry={() => { void refresh(); }}
          />
        ) : presets.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={Bookmark}
            title="Aucun ICP configuré"
            headingLevel={4}
            description="Créez-en un avec « Nouvel ICP » pour appliquer vos critères de sélection aux missions de chaque société."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {presets.map(preset => (
              <PresetCard
                key={preset.id}
                preset={preset}
                onEdit={() => setEditing(preset)}
                onDelete={() => deletePreset(preset.id)}
              />
            ))}
          </div>
        )}

        {/* Formulaire create/edit */}
        <PresetFormDialog
          open={isFormOpen}
          onClose={closeForm}
          editing={editing}
          onSubmit={async (input) => {
            if (editing) {
              const ok = await updatePreset(editing.id, input);
              if (ok) closeForm();
            } else {
              const created = await createPreset(input);
              if (created) closeForm();
            }
          }}
        />
      </CardContent>
    </Card>
  );
};

// ── Card preset ──
const PresetCard: React.FC<{
  preset: ClientPedigreePreset;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ preset, onEdit, onDelete }) => {
  const req = preset.pedigree_requirements;
  const summary: string[] = [];
  if (req.schools_required?.length) summary.push(plural(req.schools_required.length, 'école'));
  if (req.diploma_must_be_from && req.diploma_must_be_from !== 'any') summary.push(DIPLOMA_ORIGIN_LABELS[req.diploma_must_be_from]);
  if (req.companies_required_provenance?.length) summary.push(plural(req.companies_required_provenance.length, 'provenance'));
  if (req.companies_specific_required?.length) summary.push(plural(req.companies_specific_required.length, 'entreprise cible', 'entreprises cibles'));
  if (req.min_seniority) summary.push(`Min. ${SENIORITY_LABELS[req.min_seniority]}`);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold">{preset.name}</h4>
          {preset.client_company_name && (
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Building2 className="h-3 w-3 text-foreground" aria-hidden="true" />
              {preset.client_company_name}
              {preset.is_default_for_client && (
                <Badge variant="outline" className="ml-1 py-0">
                  Par défaut
                </Badge>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="max-md:h-11 max-md:w-11"
                onClick={onEdit}
                aria-label={`Modifier l'ICP ${preset.name}`}
              >
                <Pencil aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Modifier</TooltipContent>
          </Tooltip>
          <AlertDialog>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-danger max-md:h-11 max-md:w-11"
                    aria-label={`Supprimer l'ICP ${preset.name}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </AlertDialogTrigger>
              </TooltipTrigger>
              <TooltipContent>Supprimer</TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer cet ICP ?</AlertDialogTitle>
                <AlertDialogDescription>
                  L'ICP « {preset.name} » sera retiré. Les missions qui l'utilisent garderont une copie
                  de ses critères dans leur brief, mais ne seront plus liées à l'ICP.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} className="bg-destructive">Supprimer</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {preset.description && (
        <p className="text-xs text-muted-foreground leading-relaxed">{preset.description}</p>
      )}

      {summary.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {summary.map((s, i) => (
            <Badge key={i} variant="secondary">{s}</Badge>
          ))}
          {req.strict_mode && (
            <Badge variant="outline">
              <Shield className="h-3 w-3" aria-hidden="true" />
              Mode strict
            </Badge>
          )}
        </div>
      )}
    </div>
  );
};

// ── Dialog formulaire create/edit ──
const PresetFormDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  editing: ClientPedigreePreset | null;
  onSubmit: (input: {
    name: string;
    description?: string;
    client_company_name?: string;
    pedigree_requirements: PedigreeRequirements;
    is_default_for_client?: boolean;
  }) => Promise<void>;
}> = ({ open, onClose, editing, onSubmit }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [clientName, setClientName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [requirements, setRequirements] = useState<PedigreeRequirements>(EMPTY_REQUIREMENTS);
  const [submitting, setSubmitting] = useState(false);

  // Hydrate quand on ouvre en mode édition
  React.useEffect(() => {
    if (editing) {
      setName(editing.name);
      setDescription(editing.description || '');
      setClientName(editing.client_company_name || '');
      setIsDefault(editing.is_default_for_client || false);
      setRequirements({ ...EMPTY_REQUIREMENTS, ...editing.pedigree_requirements });
    } else if (open) {
      setName('');
      setDescription('');
      setClientName('');
      setIsDefault(false);
      setRequirements(EMPTY_REQUIREMENTS);
    }
  }, [editing, open]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        client_company_name: clientName.trim() || undefined,
        pedigree_requirements: cleanRequirements(requirements),
        is_default_for_client: isDefault,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Modifier l'ICP" : 'Nouvel ICP'}</DialogTitle>
          <DialogDescription>
            Configurez les critères qui définissent un bon candidat pour cette société.
            Ils s’appliquent à l’évaluation des candidats de toutes ses missions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Identité */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="preset-name">Nom de l'ICP *</Label>
              <Input
                id="preset-name"
                placeholder="ex : Profils tech, écoles d’ingénieurs"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="preset-description">Description (note interne)</Label>
              <Textarea
                id="preset-description"
                placeholder="À quoi sert cet ICP, contexte de la société…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div>
              <Label htmlFor="preset-client">Nom de la société (application automatique)</Label>
              <Input
                id="preset-client"
                placeholder="ex : Atelier Martin"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                aria-describedby="preset-client-help"
              />
              <p id="preset-client-help" className="text-xs text-muted-foreground mt-1">
                Si ce nom est renseigné et « par défaut » activé ci-dessous, cet ICP s'applique
                aux nouvelles missions créées pour cette société.
              </p>
            </div>
            {clientName.trim() && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <Label htmlFor="preset-default" className="cursor-pointer">Appliquer par défaut pour cette société</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Un seul ICP peut être par défaut par société.
                  </p>
                </div>
                <Switch id="preset-default" checked={isDefault} onCheckedChange={setIsDefault} />
              </div>
            )}
          </div>

          <PedigreeRequirementsEditor value={requirements} onChange={setRequirements} />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
          <Button type="button" variant="primary" onClick={handleSubmit} disabled={!name.trim()} loading={submitting}>
            {submitting ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Créer l’ICP'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

