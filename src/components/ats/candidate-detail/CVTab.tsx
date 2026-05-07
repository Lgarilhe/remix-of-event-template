/**
 * CVTab — onglet de gestion des CVs PDF d'un candidat.
 *
 * 3 états visuels :
 *   1. Loading : spinner pendant fetch initial
 *   2. Empty : drop zone full-tab si aucun CV
 *   3. Filled : preview iframe du CV primaire + toolbar (replace/delete/
 *      download/setPrimary) + liste des CVs alternatifs si multi-versions
 *
 * Stack technique :
 *   - <iframe src={signedUrl}> pour le preview (natif Chrome/Firefox/Edge,
 *     pas de dépendance, évite les ~50KB de react-pdf)
 *   - Drag&drop natif HTML5 + <input type="file">
 *   - Toast feedback pour toutes les actions
 *   - AlertDialog pour la suppression (cohérent avec le reste du site)
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Upload, FileText, Download, Trash2, Star, StarOff,
  Loader2, AlertCircle, RefreshCw, Pencil, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import {
  CandidateCV, listCVs, uploadCV, deleteCV, setPrimaryCV,
  getCVSignedUrl, updateCVNotes, formatFileSize,
  CV_MAX_SIZE_BYTES, CV_ALLOWED_TYPES,
} from '@/lib/cvStorage';

interface Props {
  candidateId: string;
  organizationId: string | null;
  candidateName: string;
}

export const CVTab: React.FC<Props> = ({ candidateId, organizationId, candidateName }) => {
  const [cvs, setCvs] = useState<CandidateCV[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCVId, setActiveCVId] = useState<string | null>(null);
  const [activeSignedUrl, setActiveSignedUrl] = useState<string | null>(null);
  const [signedUrlLoading, setSignedUrlLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CandidateCV | null>(null);
  const [editingNotes, setEditingNotes] = useState<{ cvId: string; value: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch CVs au mount
  const fetchCVs = useCallback(async () => {
    if (!organizationId) {
      setError("Organisation non détectée");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await listCVs(candidateId, organizationId);
      setCvs(list);
      // Active le primaire par défaut, sinon le 1er
      const primary = list.find(c => c.isPrimary) || list[0] || null;
      setActiveCVId(primary?.id || null);
    } catch (err: any) {
      console.error('[CVTab] fetch error:', err);
      setError(err?.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [candidateId, organizationId]);

  useEffect(() => { fetchCVs(); }, [fetchCVs]);

  // Re-génère la signed URL quand activeCVId change (URL valide 5 min)
  useEffect(() => {
    if (!activeCVId) {
      setActiveSignedUrl(null);
      return;
    }
    const cv = cvs.find(c => c.id === activeCVId);
    if (!cv) return;
    let cancelled = false;
    setSignedUrlLoading(true);
    getCVSignedUrl(cv.storagePath, 300)
      .then(url => { if (!cancelled) setActiveSignedUrl(url); })
      .catch(err => {
        console.error('[CVTab] signed URL error:', err);
        if (!cancelled) {
          setActiveSignedUrl(null);
          toast.error('Impossible de générer le lien de prévisualisation');
        }
      })
      .finally(() => { if (!cancelled) setSignedUrlLoading(false); });
    return () => { cancelled = true; };
  }, [activeCVId, cvs]);

  // Handler upload (drop ou input change)
  const handleFile = useCallback(async (file: File) => {
    if (!organizationId) {
      toast.error("Organisation non détectée");
      return;
    }
    if (!CV_ALLOWED_TYPES.includes(file.type)) {
      toast.error(`Type non supporté : ${file.type || 'inconnu'}. PDF uniquement.`);
      return;
    }
    if (file.size > CV_MAX_SIZE_BYTES) {
      toast.error(`Fichier trop volumineux (max ${CV_MAX_SIZE_BYTES / 1024 / 1024} MB)`);
      return;
    }
    setUploading(true);
    try {
      const newCV = await uploadCV({
        candidateId,
        organizationId,
        file,
      });
      setCvs(prev => {
        // Si le nouveau est primary, on désactive les autres côté state
        if (newCV.isPrimary) {
          return [newCV, ...prev.map(c => ({ ...c, isPrimary: false }))];
        }
        return [newCV, ...prev];
      });
      setActiveCVId(newCV.id);
      toast.success('CV uploadé');
    } catch (err: any) {
      console.error('[CVTab] upload error:', err);
      toast.error(err?.message || "Erreur lors de l'upload");
    } finally {
      setUploading(false);
    }
  }, [candidateId, organizationId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    if (files.length > 1) {
      toast.warning(`${files.length} fichiers — seul le premier sera uploadé`);
    }
    handleFile(files[0]);
  }, [handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input pour permettre de re-upload le même fichier (ex: après replace)
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleFile]);

  const handleDelete = useCallback(async (cv: CandidateCV) => {
    try {
      await deleteCV(cv);
      setCvs(prev => prev.filter(c => c.id !== cv.id));
      if (activeCVId === cv.id) {
        // Active le primaire restant ou le 1er
        const remaining = cvs.filter(c => c.id !== cv.id);
        setActiveCVId(remaining.find(c => c.isPrimary)?.id || remaining[0]?.id || null);
      }
      toast.success('CV supprimé');
    } catch (err: any) {
      console.error('[CVTab] delete error:', err);
      toast.error(err?.message || 'Erreur lors de la suppression');
    }
    setConfirmDelete(null);
  }, [activeCVId, cvs]);

  const handleSetPrimary = useCallback(async (cv: CandidateCV) => {
    if (cv.isPrimary) return; // déjà
    try {
      await setPrimaryCV(cv.id);
      setCvs(prev => prev.map(c => ({ ...c, isPrimary: c.id === cv.id })));
      toast.success(`${cv.fileName} défini comme CV principal`);
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  }, []);

  const handleSaveNotes = useCallback(async () => {
    if (!editingNotes) return;
    try {
      await updateCVNotes(editingNotes.cvId, editingNotes.value);
      setCvs(prev => prev.map(c => c.id === editingNotes.cvId ? { ...c, notes: editingNotes.value || null } : c));
      toast.success('Note enregistrée');
      setEditingNotes(null);
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  }, [editingNotes]);

  const handleDownload = useCallback(async (cv: CandidateCV) => {
    try {
      const url = await getCVSignedUrl(cv.storagePath, 60);
      // Force download avec le nom d'origine
      const a = document.createElement('a');
      a.href = url;
      a.download = cv.fileName;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: any) {
      toast.error("Téléchargement impossible");
    }
  }, []);

  const activeCV = cvs.find(c => c.id === activeCVId) || null;

  // ─── Render ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/5 border border-destructive/30 text-destructive">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-sm">Erreur de chargement</p>
          <p className="text-xs mt-1">{error}</p>
          <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={fetchCVs}>
            <RefreshCw className="w-3 h-3 mr-1.5" /> Réessayer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Hidden file input pour les boutons "Upload" / "Remplacer" */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleInputChange}
        aria-label="Sélectionner un CV PDF"
      />

      {cvs.length === 0 ? (
        // ═══ EMPTY STATE : drop zone full-tab ═══
        <DropZone
          dragActive={dragActive}
          uploading={uploading}
          onDragEnter={() => setDragActive(true)}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        />
      ) : (
        // ═══ FILLED STATE : preview + toolbar + list ═══
        <div className="space-y-3">
          {/* Toolbar du CV actif */}
          {activeCV && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl border border-border bg-card">
              <div className="h-9 w-9 rounded-lg bg-emerald-500/15 grid place-items-center shrink-0">
                <FileText className="w-4 h-4 text-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-[13px] font-semibold truncate">{activeCV.fileName}</p>
                  {activeCV.isPrimary && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/30">
                      <Star className="w-2.5 h-2.5" /> Principal
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {formatFileSize(activeCV.fileSizeBytes)}
                  {' · '}
                  Uploadé {format(new Date(activeCV.uploadedAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => handleDownload(activeCV)}
                  title="Télécharger"
                >
                  <Download className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Uploader un nouveau CV"
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline ml-1">Ajouter</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px] hover:text-destructive hover:border-destructive/40"
                  onClick={() => setConfirmDelete(activeCV)}
                  title="Supprimer ce CV"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Notes du CV actif (édition inline) */}
          {activeCV && (
            <div className="rounded-xl border border-border bg-muted/20 p-2.5">
              {editingNotes?.cvId === activeCV.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={editingNotes.value}
                    onChange={(e) => setEditingNotes({ ...editingNotes, value: e.target.value })}
                    placeholder="Note libre (ex: v3 envoyée par mail le 12/04, manque les diplômes)"
                    className="min-h-[60px] text-[12px]"
                    autoFocus
                  />
                  <div className="flex items-center gap-1.5 justify-end">
                    <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setEditingNotes(null)}>
                      Annuler
                    </Button>
                    <Button size="sm" className="h-7 text-[11px]" onClick={handleSaveNotes}>
                      Enregistrer
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingNotes({ cvId: activeCV.id, value: activeCV.notes || '' })}
                  className="w-full flex items-start gap-2 text-left text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="w-3 h-3 shrink-0 mt-0.5" />
                  {activeCV.notes
                    ? <span className="italic">{activeCV.notes}</span>
                    : <span className="opacity-70">Ajouter une note sur ce CV…</span>}
                </button>
              )}
            </div>
          )}

          {/* Preview iframe du PDF actif */}
          <div className="rounded-xl border border-border bg-background overflow-hidden">
            {signedUrlLoading || !activeSignedUrl ? (
              <div className="flex items-center justify-center h-[480px] sm:h-[640px] bg-muted/20">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <iframe
                src={activeSignedUrl}
                title={`CV de ${candidateName}`}
                className="w-full h-[480px] sm:h-[640px] border-0"
                aria-label={`Preview PDF du CV de ${candidateName}`}
              />
            )}
          </div>

          {/* Liste des autres CVs (versions alternatives) */}
          {cvs.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground px-1">
                Toutes les versions ({cvs.length})
              </p>
              {cvs.map(cv => (
                <CVListItem
                  key={cv.id}
                  cv={cv}
                  isActive={cv.id === activeCVId}
                  onSelect={() => setActiveCVId(cv.id)}
                  onSetPrimary={() => handleSetPrimary(cv)}
                  onDelete={() => setConfirmDelete(cv)}
                  onDownload={() => handleDownload(cv)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirmation suppression */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce CV ?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{confirmDelete?.fileName}</strong> sera supprimé définitivement.
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

// ═══════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════

function DropZone({
  dragActive, uploading, onDragEnter, onDragLeave, onDrop, onClick,
}: {
  dragActive: boolean;
  uploading: boolean;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={uploading ? undefined : onClick}
      onDragEnter={(e) => { e.preventDefault(); onDragEnter(); }}
      onDragOver={(e) => { e.preventDefault(); onDragEnter(); }}
      onDragLeave={(e) => { e.preventDefault(); onDragLeave(); }}
      onDrop={onDrop}
      disabled={uploading}
      className={cn(
        'group w-full min-h-[280px] sm:min-h-[360px] rounded-xl border-2 border-dashed p-6 transition-all flex flex-col items-center justify-center gap-3 cursor-pointer',
        dragActive
          ? 'border-foreground bg-foreground/[0.04] scale-[1.01]'
          : 'border-border bg-muted/10 hover:border-foreground/40 hover:bg-muted/20',
        uploading && 'opacity-60 cursor-wait',
      )}
    >
      <div
        className={cn(
          'h-14 w-14 rounded-2xl grid place-items-center transition-all',
          dragActive
            ? 'bg-foreground text-background scale-110'
            : 'bg-emerald-500/15 text-foreground group-hover:bg-emerald-500/25',
        )}
      >
        {uploading ? (
          <Loader2 className="w-6 h-6 animate-spin" />
        ) : (
          <Upload className="w-6 h-6" strokeWidth={2} />
        )}
      </div>
      <div className="text-center max-w-xs">
        <p className="font-display text-base font-bold text-foreground tracking-tight">
          {uploading ? 'Upload en cours…' : dragActive ? 'Lâche le fichier ici' : 'Aucun CV pour ce candidat'}
        </p>
        <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed">
          Glisse-dépose un PDF ici, ou clique pour parcourir.
          <br />
          <span className="opacity-70">PDF uniquement · max 10 MB</span>
        </p>
      </div>
    </button>
  );
}

function CVListItem({
  cv, isActive, onSelect, onSetPrimary, onDelete, onDownload,
}: {
  cv: CandidateCV;
  isActive: boolean;
  onSelect: () => void;
  onSetPrimary: () => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        isActive
          ? 'border-foreground/30 bg-foreground/[0.04]'
          : 'border-border bg-card hover:bg-muted/30 hover:border-foreground/20',
      )}
    >
      <div className="h-7 w-7 rounded-md bg-emerald-500/15 grid place-items-center shrink-0">
        <FileText className="w-3.5 h-3.5 text-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-[12px] font-semibold truncate">{cv.fileName}</p>
          {cv.isPrimary && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/30">
              Principal
            </span>
          )}
        </div>
        <p className="text-[10.5px] text-muted-foreground">
          {formatFileSize(cv.fileSizeBytes)}
          {' · '}
          {format(new Date(cv.uploadedAt), 'd MMM yyyy', { locale: fr })}
        </p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        {!cv.isPrimary && (
          <button
            onClick={onSetPrimary}
            className="h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Définir comme CV principal"
          >
            <StarOff className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={onDownload}
          className="h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Télécharger"
        >
          <Download className="w-3 h-3" />
        </button>
        <button
          onClick={onDelete}
          className="h-6 w-6 grid place-items-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Supprimer"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
