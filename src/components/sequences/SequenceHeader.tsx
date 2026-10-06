// En-tête de la page d'une séquence (lot 5c-2) : fil d'Ariane (par la mission
// d'origine avec &depuis=mission:<id>), nom avec « Renommer la séquence »,
// pastille de statut, ligne de rythme et un seul bouton plein : « Enregistrer »
// tant que des modifications (étapes ou réglages) ne sont pas enregistrées,
// « Inscrire des candidats » sinon (qui passe alors en bouton discret). État
// d'enregistrement (lot 5d-2) : « Modifications non enregistrées »,
// « Enregistrement… », « Enregistré à 14 h 32 », « Échec de l'enregistrement ».
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Check, ChevronRight, Pencil, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SEQUENCES_PATH } from '@/lib/sequencesBeta';
import type { EditorSaveState } from '@/hooks/useEditorSaveFlow';

export const SEQUENCE_NAME_MAX = 200;

interface SequenceHeaderProps {
  name: string;
  /** Mission d'origine (&depuis=mission:<id>) : le fil d'Ariane passe par elle. */
  mission: { id: string; name: string } | null;
  canRename: boolean;
  /** Rend true si le nom est enregistré. */
  onRename: (name: string) => Promise<boolean>;
  status?: ReactNode;
  /** Étapes ou réglages modifiés et pas encore enregistrés (une séquence pas encore créée l'est toujours). */
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  /** État d'enregistrement affiché ; null : rien à dire. */
  saveState?: EditorSaveState;
  savedAt?: Date | null;
  /** Absent pour une séquence pas encore créée. */
  enrollHref: string | null;
  menu?: ReactNode;
  rhythm?: ReactNode;
}

const timeLabel = (date: Date) => date.toLocaleTimeString('fr-FR', { hour: 'numeric', minute: '2-digit' }).replace(':', ' h ');

function SaveStateText({ state, savedAt, onRetry }: { state: EditorSaveState; savedAt: Date | null; onRetry: () => void }) {
  if (!state) return null;
  return (
    <span role="status" aria-live="polite" className={state === 'error' ? 'inline-flex items-center gap-1.5 text-xs text-danger' : 'inline-flex items-center gap-1.5 text-xs text-muted-foreground'}>
      {state === 'saved' && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
      {state === 'unsaved' && <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />}
      {state === 'error' && <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />}
      {/* Sous 1 280 px, le point seul (le texte reste lu) : l'en-tête garde sa hauteur à la première modification. */}
      {state === 'unsaved' && <span className="max-xl:sr-only">{'Modifications non enregistrées'}</span>}
      {state === 'saving' && 'Enregistrement…'}
      {state === 'saved' && (savedAt ? `Enregistré à ${timeLabel(savedAt)}` : 'Enregistré')}
      {state === 'error' && (
        <>
          Échec de l’enregistrement
          <Button type="button" variant="link" size="xs" onClick={onRetry} className="h-auto p-0 text-xs text-danger max-md:min-h-11">Réessayer</Button>
        </>
      )}
    </span>
  );
}

export function SequenceHeader({ name, mission, canRename, onRename, status, dirty, saving, onSave, saveState, savedAt = null, enrollHref, menu, rhythm }: SequenceHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [renaming, setRenaming] = useState(false);
  const pencilRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const close = () => {
    setEditing(false);
    window.requestAnimationFrame(() => pencilRef.current?.focus());
  };
  const commit = async () => {
    const next = draft.trim();
    if (!next || next === name) {
      close();
      return;
    }
    setRenaming(true);
    const ok = await onRename(next.slice(0, SEQUENCE_NAME_MAX));
    setRenaming(false);
    if (ok) close();
  };

  const enroll = enrollHref && (
    <Button asChild variant={dirty ? 'outline' : 'primary'} size="sm" className="max-md:h-11">
      <Link to={enrollHref}>
        <Send aria-hidden="true" />
        Inscrire des candidats
      </Link>
    </Button>
  );
  const state: EditorSaveState = saveState === undefined ? (saving ? 'saving' : dirty ? 'unsaved' : null) : saveState;

  return (
    <header className="mb-4 space-y-3">
      <nav aria-label="Fil d’Ariane" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {mission ? (
          <>
            <Link to="/missions" className="hover:text-foreground max-md:inline-flex max-md:min-h-11 max-md:items-center">Missions</Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <Link to={`/missions/${encodeURIComponent(mission.id)}?panneau=contact`} className="max-w-[16rem] truncate hover:text-foreground max-md:inline-flex max-md:min-h-11 max-md:items-center">
              {mission.name}
            </Link>
          </>
        ) : (
          <Link to={SEQUENCES_PATH} className="hover:text-foreground max-md:inline-flex max-md:min-h-11 max-md:items-center">Séquences</Link>
        )}
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        {/* Le titre garde au moins 16 rem : les boutons passent dessous plutôt que de l'écraser. À partir de
            768 px, crayon et pastille restent sur la ligne du titre, tronqué au besoin (rien ne descend à la première modification). */}
        <div className="flex min-w-0 flex-[1_1_16rem] flex-wrap items-center gap-x-2 gap-y-1 md:flex-nowrap">
          {editing ? (
            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void commit();
              }}
            >
              <Input
                ref={inputRef}
                value={draft}
                maxLength={SEQUENCE_NAME_MAX}
                aria-label="Nom de la séquence"
                disabled={renaming}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { if (!renaming) void commit(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setDraft(name);
                    close();
                  }
                }}
                className="h-10 max-w-xl text-lg font-semibold"
              />
            </form>
          ) : (
            <>
              <h1 title={name} className="min-w-0 break-words text-title font-semibold text-foreground md:truncate">{name}</h1>
              {canRename && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      ref={pencilRef}
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Renommer la séquence"
                      onClick={() => setEditing(true)}
                      className="text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11"
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Renommer la séquence</TooltipContent>
                </Tooltip>
              )}
            </>
          )}
          {status}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SaveStateText state={state} savedAt={savedAt} onRetry={onSave} />
          {dirty && (
            <Button type="button" variant="primary" size="sm" onClick={onSave} loading={saving} className="max-md:h-11">
              Enregistrer
            </Button>
          )}
          {enroll}
          {menu}
        </div>
      </div>

      {rhythm}
    </header>
  );
}
