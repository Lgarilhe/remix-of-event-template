import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Upload, Trash2, Globe, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { updateOrganization } from '@/lib/organizationUpdate';

interface OrgLogoEditorProps {
  organizationId: string;
  logoUrl: string | null;
  website: string | null;
  orgName: string;
  /** Propriétaire ou administrateur : logo et site sont dans la liste blanche admin. */
  canEdit: boolean;
}

// Bornes du bucket org-logos (file_size_limit, allowed_mime_types) : SVG exclu,
// il peut porter du script. L'extension vient du type MIME, pas du nom du fichier.
const LOGO_BUCKET = 'org-logos';
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const LOGO_UPLOAD_FAILED = 'Le logo n’a pas pu être envoyé. Réessayez.';
const PUBLIC_PREFIX = `/storage/v1/object/public/${LOGO_BUCKET}/`;

/** Chemin dans le bucket si l'URL pointe un logo importé de cette organisation, sinon null (URL externe). */
function ownedLogoPath(url: string | null, orgId: string): string | null {
  if (!url) return null;
  const i = url.indexOf(PUBLIC_PREFIX);
  if (i < 0) return null;
  const path = decodeURIComponent(url.slice(i + PUBLIC_PREFIX.length).split('?')[0]);
  return path.startsWith(`${orgId}/`) ? path : null;
}

/** Nettoyage en « best effort » : un échec laisse un fichier orphelin, sans effet sur l'écran. */
function removeStoredLogo(path: string) {
  supabase.storage.from(LOGO_BUCKET).remove([path])
    .then(({ error }) => { if (error) console.warn('[OrgLogoEditor] nettoyage', path, error); })
    .catch((e) => console.warn('[OrgLogoEditor] nettoyage', path, e));
}

/** Derives a favicon URL from a website domain */
function getFaviconUrl(website: string | null): string | null {
  if (!website) return null;
  try {
    let domain = website.trim();
    if (!domain.startsWith('http')) domain = `https://${domain}`;
    const url = new URL(domain);
    return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=128`;
  } catch {
    return null;
  }
}

export const OrgLogoEditor = ({ organizationId, logoUrl, website, orgName, canEdit }: OrgLogoEditorProps) => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [editingWebsite, setEditingWebsite] = useState(false);
  const [websiteValue, setWebsiteValue] = useState(website || '');
  const [savingWebsite, setSavingWebsite] = useState(false);

  const effectiveLogo = logoUrl || getFaviconUrl(website);
  const initials = orgName?.slice(0, 2).toUpperCase() || '??';
  // Échec de chargement tenu dans l'état React, pas dans le DOM : masquer l'<img>
  // à la main survivait au changement de src (même nœud réutilisé), et un
  // nouveau logo restait invisible derrière les initiales.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const logoSrc = effectiveLogo && failedSrc !== effectiveLogo ? effectiveLogo : null;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Remis à zéro d'emblée : rechoisir le même fichier redéclenche onChange,
    // y compris après un refus de format ou de taille.
    e.target.value = '';
    if (!file) return;

    const ext = LOGO_TYPES[file.type];
    if (!ext) {
      toast.error('Formats acceptés : PNG, JPEG, WebP ou GIF.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error('Image trop lourde : 2 Mo maximum.');
      return;
    }

    setUploading(true);
    // Nom unique à chaque envoi : pas d'écrasement (ni policy UPDATE, ni cache
    // navigateur périmé), l'ancien fichier est supprimé une fois l'URL écrite.
    const path = `${organizationId}/logo-${crypto.randomUUID()}.${ext}`;
    let uploaded = false;
    try {
      const { error: uploadError } = await supabase.storage.from(LOGO_BUCKET).upload(path, file);
      if (uploadError) {
        console.error('[OrgLogoEditor] upload failed:', uploadError);
        throw new Error(LOGO_UPLOAD_FAILED);
      }
      uploaded = true;

      const { data: { publicUrl } } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
      await updateOrganization(organizationId, { logo_url: publicUrl });

      const previous = ownedLogoPath(logoUrl, organizationId);
      if (previous && previous !== path) removeStoredLogo(previous);
      queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      toast.success('Logo enregistré');
    } catch (err) {
      // URL non écrite : le fichier envoyé n'est référencé nulle part.
      if (uploaded) removeStoredLogo(path);
      toast.error(err instanceof Error ? err.message : LOGO_UPLOAD_FAILED);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    try {
      await updateOrganization(organizationId, { logo_url: null });
      // Un logo externe (récupéré à l'inscription) n'a pas de fichier à supprimer.
      const stored = ownedLogoPath(logoUrl, organizationId);
      if (stored) removeStoredLogo(stored);
      queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      toast.success('Logo supprimé');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Le logo n’a pas pu être retiré.');
    }
  };

  const handleSaveWebsite = async () => {
    setSavingWebsite(true);
    try {
      await updateOrganization(organizationId, { website: websiteValue.trim() || null });
      queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      setEditingWebsite(false);
      toast.success('Site web enregistré');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Le site web n’a pas pu être enregistré.');
    } finally {
      setSavingWebsite(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Logo et actions. Revue design (F-18) : vignette arrondie, boutons en casse de phrase. */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
          {logoSrc ? (
            <img
              src={logoSrc}
              alt={orgName}
              className="w-full h-full object-contain p-1"
              onError={() => setFailedSrc(logoSrc)}
            />
          ) : null}
          <span className={`text-base font-semibold text-muted-foreground ${logoSrc ? 'hidden' : ''}`}>
            {initials}
          </span>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleUpload}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="max-md:h-11"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              loading={uploading}
            >
              {!uploading && <Upload aria-hidden="true" />}
              {uploading ? 'Envoi…' : 'Changer le logo'}
            </Button>
            {logoUrl && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-danger max-md:h-11"
                  >
                    <Trash2 aria-hidden="true" />
                    Supprimer le logo
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer le logo ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {ownedLogoPath(logoUrl, organizationId)
                        ? 'Le logo importé sera supprimé définitivement. Vous pourrez en importer un autre à tout moment.'
                        : 'Le logo ne sera plus affiché. Vous pourrez en importer un autre à tout moment.'}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRemoveLogo} className="bg-destructive">
                      Supprimer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </div>

      {/* Site web. Revue design (F-09, F-15, F-22) : libellé relié au champ, « Enregistrer », crayon. */}
      <div>
        <label
          htmlFor={editingWebsite && canEdit ? 'org-website' : undefined}
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <Globe className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />
          Site web
        </label>
        {editingWebsite && canEdit ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Input
              id="org-website"
              inputMode="url"
              value={websiteValue}
              onChange={e => setWebsiteValue(e.target.value)}
              placeholder="https://monentreprise.com"
              className="max-w-xs max-md:h-11"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSaveWebsite()}
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="max-md:h-11"
              onClick={handleSaveWebsite}
              loading={savingWebsite}
            >
              Enregistrer
            </Button>
            <Button type="button" size="sm" variant="ghost" className="max-md:h-11" onClick={() => setEditingWebsite(false)}>
              Annuler
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-sm text-foreground">
              {website || <span className="text-muted-foreground">Non renseigné</span>}
            </p>
            {canEdit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="max-md:h-11 max-md:w-11"
                    onClick={() => { setWebsiteValue(website || ''); setEditingWebsite(true); }}
                    aria-label="Modifier le site web"
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Modifier le site web</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
        {!logoUrl && website && (
          <p className="text-xs text-muted-foreground mt-1">
            Le logo est récupéré automatiquement depuis le domaine. Importez votre logo pour le remplacer.
          </p>
        )}
      </div>
    </div>
  );
};
