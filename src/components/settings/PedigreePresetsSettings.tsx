import React, { useState } from 'react';
import { Plus, Trash2, Pencil, Settings as SettingsIcon, Building2, Shield, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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
import { cn } from '@/lib/utils';

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
  const { presets, loading, createPreset, updatePreset, deletePreset } = usePedigreePresets();
  const [editing, setEditing] = useState<ClientPedigreePreset | null>(null);
  const [creating, setCreating] = useState(false);

  const isFormOpen = creating || editing !== null;
  const closeForm = () => { setCreating(false); setEditing(null); };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">Presets pedigree client</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Configurez une fois les critères de sélection d'un client (top école française, scale-up
            Series B+, etc.) et appliquez-les automatiquement à toutes ses missions. Le scoring IA
            honorera ces critères avec priorité sur les règles d'équité par défaut.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" />
          Nouveau preset
        </Button>
      </div>

      {/* RGPD note */}
      <div className="flex items-start gap-3 p-3 border border-amber-500/20 bg-amber-500/5 rounded-md">
        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-700 dark:text-amber-400">
          <strong>Note RGPD</strong> : ces critères ciblent l'objectif (école, type d'entreprise) et
          non l'origine du candidat. Discriminer sur la nationalité ou l'origine ethnique est illégal
          en France. Préférez "diplôme délivré par établissement français" à toute formulation
          excluant explicitement des candidats étrangers.
        </div>
      </div>

      {/* Liste des presets */}
      {loading ? (
        <div className="text-sm text-muted-foreground text-center py-8">Chargement…</div>
      ) : presets.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-8 text-center space-y-2">
          <SettingsIcon className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">
            Aucun preset configuré. Créez-en un pour automatiser les critères de sélection sur vos
            missions client.
          </p>
        </div>
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
    </div>
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
  if (req.schools_required?.length) summary.push(`${req.schools_required.length} école${req.schools_required.length > 1 ? 's' : ''}`);
  if (req.diploma_must_be_from && req.diploma_must_be_from !== 'any') summary.push(DIPLOMA_ORIGIN_LABELS[req.diploma_must_be_from]);
  if (req.companies_required_provenance?.length) summary.push(`${req.companies_required_provenance.length} provenance${req.companies_required_provenance.length > 1 ? 's' : ''}`);
  if (req.companies_specific_required?.length) summary.push(`${req.companies_specific_required.length} entreprise${req.companies_specific_required.length > 1 ? 's' : ''} cible${req.companies_specific_required.length > 1 ? 's' : ''}`);
  if (req.min_seniority) summary.push(`Min. ${SENIORITY_LABELS[req.min_seniority]}`);

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-card hover:border-foreground/20 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm truncate">{preset.name}</h3>
          {preset.client_company_name && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Building2 className="w-3 h-3" />
              {preset.client_company_name}
              {preset.is_default_for_client && (
                <Badge variant="outline" className="ml-1 text-[10px] h-4 px-1.5 border-emerald-500/30 text-emerald-600">
                  Par défaut
                </Badge>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer ce preset ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Le preset "{preset.name}" sera retiré. Les missions qui l'utilisent garderont
                  les critères en snapshot dans leur brief, mais ne seront plus liées au preset.
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
            <Badge key={i} variant="secondary" className="text-[10px]">{s}</Badge>
          ))}
          {req.strict_mode && (
            <Badge className="text-[10px] bg-amber-500/10 text-amber-700 border border-amber-500/30">
              <Shield className="w-2.5 h-2.5 mr-0.5" />
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
          <DialogTitle>{editing ? 'Modifier le preset' : 'Nouveau preset'}</DialogTitle>
          <DialogDescription>
            Configurez les critères de sélection client appliqués automatiquement au scoring.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Identité */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="preset-name">Nom du preset *</Label>
              <Input
                id="preset-name"
                placeholder="ex: BlaBlaCar — Top tech FR"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="preset-description">Description (note interne)</Label>
              <Textarea
                id="preset-description"
                placeholder="Pour quoi sert ce preset, contexte client..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div>
              <Label htmlFor="preset-client">Nom du client (auto-application)</Label>
              <Input
                id="preset-client"
                placeholder="ex: BlaBlaCar"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Si renseigné + "par défaut" coché ci-dessous, ce preset sera automatiquement appliqué
                aux nouvelles missions créées pour ce client.
              </p>
            </div>
            {clientName.trim() && (
              <div className="flex items-center justify-between p-3 border border-border rounded-md">
                <div>
                  <Label htmlFor="preset-default" className="cursor-pointer">Appliquer par défaut pour ce client</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Une seule preset peut être par défaut par client.
                  </p>
                </div>
                <Switch id="preset-default" checked={isDefault} onCheckedChange={setIsDefault} />
              </div>
            )}
          </div>

          <PedigreeRequirementsEditor value={requirements} onChange={setRequirements} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || submitting}>
            {submitting ? 'Enregistrement…' : editing ? 'Mettre à jour' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

