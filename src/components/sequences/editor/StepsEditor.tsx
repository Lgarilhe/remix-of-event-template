// Onglet « Étapes » de la page d'une séquence, drapeau konekt.sequences-v2
// allumé (lot 5d-2) : l'éditeur unique. Le fil à gauche avec, collée en bas
// de sa colonne, la barre de vérification ; le panneau de l'étape ouverte à
// droite, colonne séparée par un filet et collée en haut de la fenêtre
// (440 px ; plein écran sous 768 px) ; le bandeau quand des candidats sont
// inscrits. L'état vit dans useSequenceEditor, tenu par la page : il survit
// au passage d'un onglet à l'autre. L'aperçu réel est lu par la page
// (useSequencePreview) et passé au panneau.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import type { SequenceIssue, SequenceValidation } from '@/components/outreach/sequence/sequenceGraph';
import type { SequenceEditor } from '@/hooks/useSequenceEditor';
import type { SequencePreview } from '@/hooks/useSequencePreview';
import { useInertWhile } from '@/hooks/useInertWhile';
import { useMediaQuery } from '@/components/missions/v3/shell/useMediaQuery';
import { issueStepOrder, issuesByOrder, primaryOf } from '@/lib/sequenceEditor';
import { plural } from '@/lib/plural';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AddStepPalette } from './AddStepPalette';
import { SequenceFlow } from './SequenceFlow';
import { StepPanel } from './StepPanel';
import { ValidationBar } from './ValidationBar';

const PHONE_QUERY = '(max-width: 767px)';
/** Marge gardée autour de la carte ouverte quand le fil défile en largeur. */
const CARD_MARGIN = 16;

/**
 * Tant que l'éditeur est affiché :
 * - body passe en `overflow-x: clip`. index.css pose `overflow-x: auto` sur
 *   html et body : body devient un conteneur de défilement qui ne défile
 *   jamais, et `sticky` s'y accroche au lieu de la fenêtre (la barre de
 *   vérification et le panneau ne collaient pas). `clip` coupe le débordement
 *   sans créer de conteneur ; le fil a sa propre zone de défilement en largeur.
 * - body porte `data-sequence-editor` : la bulle de l'assistant s'efface
 *   (elle recouvrait l'aperçu et la barre) ; Ctrl K reste.
 * Les autres pages ne changent pas.
 */
function useEditorViewport() {
  useEffect(() => {
    const body = document.body;
    const previous = body.style.overflowX;
    body.style.overflowX = 'clip';
    body.setAttribute('data-sequence-editor', '');
    return () => {
      body.style.overflowX = previous;
      body.removeAttribute('data-sequence-editor');
    };
  }, []);
}

interface StepsEditorProps {
  editor: SequenceEditor;
  /** validateSequence de la séquence (seule règle) : points par carte. */
  validation: SequenceValidation;
  /** Inscrits de la séquence : bandeau sur l'effet des modifications. */
  enrolledCount: number;
  /** Étapes relues en base à l'ouverture. */
  state: 'loading' | 'ready' | 'error';
  onRetry: () => void;
  preview: SequencePreview;
  /** Variables personnelles de l'expéditeur, connues du moteur. */
  extraKeys: readonly string[];
  /** « Voir » d'un point sur les expéditeurs : onglet Réglages. */
  onShowSettings: () => void;
  /**
   * Enregistrement en cours : le fil et le panneau sont figés (comme l'ancienne
   * fenêtre, fermée à l'enregistrement), pour qu'aucune saisie ne soit remplacée
   * sans bruit par les étapes relues après l'enregistrement.
   */
  frozen?: boolean;
}

export function StepsEditor({ editor, validation, enrolledCount, state, onRetry, preview, extraKeys, onShowSettings, frozen = false }: StepsEditorProps) {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const issues = useMemo(() => issuesByOrder(validation), [validation]);
  const { steps, flow, selectedId } = editor;
  const selected = selectedId ? primaryOf(steps, selectedId) : undefined;
  const selectedPrimaryId = selected?.id ?? null;
  const panelBeside = !!selected && !isPhone;
  useEditorViewport();
  // Fil plus large que sa zone : centré sur le départ, et la carte ouverte toujours entière.
  const scrollRef = useRef<HTMLDivElement>(null);
  const editAreaRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  useInertWhile(editAreaRef, frozen);
  useInertWhile(sheetRef, frozen);
  const hasSteps = steps.length > 0;
  // Candidat de l'aperçu : le même d'une étape à l'autre.
  const [previewIndex, setPreviewIndex] = useState(0);
  const showIssue = (issue: SequenceIssue) => {
    if (issue.area === 'senders') {
      onShowSettings();
      return;
    }
    const order = issueStepOrder(issue.message);
    const target = order === null ? undefined : steps.find((s) => s.order === order && (!s.variantGroup || s.variantGroup === 'A'));
    if (target) editor.select(target.id);
  };
  // À l'ouverture, à l'ouverture du panneau (la zone rétrécit) et à chaque carte ouverte :
  // fil centré, décalé seulement ce qu'il faut pour montrer la carte ouverte en entier.
  useEffect(() => {
    const el = scrollRef.current;
    if (state !== 'ready' || !hasSteps || !el) return;
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow <= 0) return;
    let left = overflow / 2;
    const card = selectedPrimaryId ? el.querySelector(`[data-step-card="${CSS.escape(selectedPrimaryId)}"]`) : null;
    if (card) {
      const zone = el.getBoundingClientRect();
      const box = card.getBoundingClientRect();
      const start = box.left - zone.left + el.scrollLeft;
      const end = start + box.width;
      if (start - CARD_MARGIN < left) left = start - CARD_MARGIN;
      else if (end + CARD_MARGIN > left + el.clientWidth) left = end + CARD_MARGIN - el.clientWidth;
    }
    el.scrollLeft = Math.max(0, Math.min(overflow, left));
  }, [state, hasSteps, selectedPrimaryId, panelBeside]);

  if (state === 'loading') {
    return (
      <div role="status" aria-label="Chargement des étapes" className="mx-auto w-full max-w-sm space-y-4">
        <Skeleton className="mx-auto h-6 w-56 rounded-full" />
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div role="alert" className="space-y-3 text-sm text-muted-foreground">
        <p>Étapes indisponibles pour l’instant.</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="max-md:h-11">Réessayer</Button>
      </div>
    );
  }

  const panel = selected && (
    <StepPanel
      steps={steps}
      stepId={selectedId ?? selected.id}
      flow={flow}
      issues={issues.get(selected.order)}
      onClose={() => editor.select(null)}
      onUpdateVersion={editor.updateVersion}
      onUpdateStep={editor.updateStep}
      onSetAfter={editor.setAfter}
      onAddVersion={editor.addVersion}
      onRemove={(id) => { void editor.requestRemove(id); }}
      removing={editor.checkingRemoval}
      renderTitle={isPhone ? (text) => <SheetTitle className="text-md">{text}</SheetTitle> : undefined}
      preview={preview}
      previewIndex={previewIndex}
      onPreviewIndexChange={setPreviewIndex}
      extraKeys={extraKeys}
    />
  );

  return (
    <div className="space-y-5">
      {enrolledCount > 0 && (
        <p role="note" className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {plural(enrolledCount, 'candidat est inscrit', 'candidats sont inscrits')}. Vos changements de texte et de délai valent pour les étapes pas encore envoyées. Une étape déjà envoyée ne peut pas être supprimée.
        </p>
      )}

      <div ref={editAreaRef} aria-busy={frozen || undefined} className="flex gap-6">
        <div className="min-w-0 flex-1">
          <div ref={scrollRef} className="overflow-x-auto pb-6">
            {steps.length === 0 ? (
              <div className="mx-auto w-full max-w-md space-y-4 py-6">
                <div className="space-y-1 text-center">
                  <h2 className="text-lg font-semibold text-foreground">Commencer par ajouter une étape</h2>
                  <p className="text-sm text-muted-foreground">La plupart des séquences de recrutement commencent par une visite de profil ou une invitation.</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-2">
                  <AddStepPalette steps={steps} position={{ afterStepId: null }} onPick={(type) => { editor.add({ afterStepId: null }, type); }} />
                </div>
              </div>
            ) : (
              <SequenceFlow
                flow={flow}
                steps={steps}
                selectedId={selectedId}
                issues={issues}
                onSelect={editor.select}
                onAdd={(position, type) => { editor.add(position, type); }}
                onDelayChange={editor.updateStep}
                onAddVersion={(id) => { editor.addVersion(id); }}
                onMove={editor.move}
                onRemove={(id) => { void editor.requestRemove(id); }}
                removing={editor.checkingRemoval}
                compact={panelBeside}
              />
            )}
          </div>
          {/* Séquence encore vide et intacte : l'état vide dit quoi faire, la barre ne montre pas déjà une erreur. */}
          {(hasSteps || editor.dirty) && <ValidationBar validation={validation} onShowIssue={showIssue} />}
        </div>
        {panel && panelBeside && (
          // Colonne pleine hauteur séparée par un filet ; le panneau y reste collé en haut de la fenêtre.
          <div className="w-[440px] shrink-0 border-l border-border">
            <aside
              aria-label={`Réglages de l’étape ${flow.numbers.get(selected.id) ?? selected.order + 1}`}
              className="sticky top-0 flex max-h-screen flex-col overflow-hidden"
            >
              {panel}
            </aside>
          </div>
        )}
      </div>

      {panel && isPhone && (
        <Sheet open onOpenChange={(open) => { if (!open) editor.select(null); }}>
          {/* Fermeture du panneau d'étape (44 px), à la place de celle du kit. */}
          <SheetContent ref={sheetRef} side="right" hideClose className="flex w-full max-w-none flex-col p-0 sm:max-w-none" aria-describedby={undefined}>
            {panel}
          </SheetContent>
        </Sheet>
      )}

      <AlertDialog open={!!editor.removalBlock} onOpenChange={(open) => { if (!open) editor.dismissRemovalBlock(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{editor.removalBlock?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {`Elle a déjà été envoyée ou traitée pour des candidats de cette séquence (${editor.removalBlock?.count ?? 0} fois) : son historique doit être conservé. Modifiez plutôt son contenu.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Garder l’étape</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
