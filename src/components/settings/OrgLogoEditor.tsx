import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Building2, Upload, Trash2, Globe, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface OrgLogoEditorProps {
  organizationId: string;
  logoUrl: string | null;
  website: string | null;
  orgName: string;
  isOwner: boolean;
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

export const OrgLogoEditor = ({ organizationId, logoUrl, website, orgName, isOwner }: OrgLogoEditorProps) => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [editingWebsite, setEditingWebsite] = useState(false);
  const [websiteValue, setWebsiteValue] = useState(website || '');
  const [savingWebsite, setSavingWebsite] = useState(false);

  const effectiveLogo = logoUrl || getFaviconUrl(website);
  const initials = orgName?.slice(0, 2).toUpperCase() || '??';

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Fichier image uniquement');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image trop lourde (max 2 Mo)');
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `${organizationId}/logo.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('org-logos')
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('org-logos')
        .getPublicUrl(path);

      const logoWithBust = `${publicUrl}?v=${Date.now()}`;

      const { error: updateError } = await supabase
        .from('organizations')
        .update({ logo_url: logoWithBust })
        .eq('id', organizationId);
      if (updateError) throw updateError;

      queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      toast.success('Logo mis à jour');
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de l\'upload');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveLogo = async () => {
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ logo_url: null })
        .eq('id', organizationId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      toast.success('Logo supprimé');
    } catch {
      toast.error('Erreur lors de la suppression');
    }
  };

  const handleSaveWebsite = async () => {
    setSavingWebsite(true);
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ website: websiteValue.trim() || null })
        .eq('id', organizationId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      setEditingWebsite(false);
      toast.success('Site web mis à jour');
    } catch {
      toast.error('Erreur lors de la mise à jour');
    } finally {
      setSavingWebsite(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Logo display + actions */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 border border-border bg-muted flex items-center justify-center overflow-hidden shrink-0">
          {effectiveLogo ? (
            <img
              src={effectiveLogo}
              alt={orgName}
              className="w-full h-full object-contain p-1"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <span className={`text-lg font-bold text-muted-foreground ${effectiveLogo ? 'hidden' : ''}`}>
            {initials}
          </span>
        </div>

        {isOwner && (
          <div className="flex flex-col gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUpload}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs uppercase tracking-wider gap-1.5"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {uploading ? 'Upload…' : 'Changer le logo'}
            </Button>
            {logoUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs uppercase tracking-wider gap-1.5 text-destructive hover:text-destructive"
                onClick={handleRemoveLogo}
              >
                <Trash2 className="w-3 h-3" />
                Supprimer
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Website field */}
      <div>
        <label className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5" />
          Site web
        </label>
        {editingWebsite && isOwner ? (
          <div className="flex items-center gap-2 mt-1">
            <Input
              value={websiteValue}
              onChange={e => setWebsiteValue(e.target.value)}
              placeholder="https://monentreprise.com"
              className="h-9 text-sm max-w-xs"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSaveWebsite()}
            />
            <Button
              size="sm"
              className="h-9 gap-1"
              onClick={handleSaveWebsite}
              disabled={savingWebsite}
            >
              {savingWebsite ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '✓'}
              Sauver
            </Button>
            <Button size="sm" variant="ghost" className="h-9" onClick={() => setEditingWebsite(false)}>
              Annuler
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-foreground text-sm">
              {website || <span className="text-muted-foreground italic">Non renseigné</span>}
            </p>
            {isOwner && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={() => { setWebsiteValue(website || ''); setEditingWebsite(true); }}
              >
                <Building2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        )}
        {!logoUrl && website && (
          <p className="text-xs text-muted-foreground mt-1">
            Le logo est récupéré automatiquement depuis le domaine. Uploadez un logo custom pour le remplacer.
          </p>
        )}
      </div>
    </div>
  );
};
