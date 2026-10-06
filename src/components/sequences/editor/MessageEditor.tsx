// Champ d'un message de séquence (lot 5d-2) : un champ de texte doublé d'un
// calque, sans changer ce qui est enregistré.
// - Hors saisie, le calque montre chaque variable en puce française
//   (« Prénom »), et une variable inconnue telle quelle, soulignée en rouge.
// - En saisie, le texte brut est modifiable ({{prenom}}) ; le calque, placé
//   dessous, surligne les variables à leur place exacte.
// « + Variable » ouvre le menu (VariableMenu), qui écrit la clé du moteur.
// Taper {{ propose les variables sous le champ sans lui prendre le focus : la
// frappe continue de filtrer la liste (clé ou libellé), ↑ ↓ choisissent,
// Entrée ou Tab écrivent la variable, Échap ferme sans rien changer ; une clé
// tapée en entier ({{prenom}}) reste telle quelle. Une ligne « Si Prénom
// manque, écrire : » par variable posée écrit le texte de secours dans la
// syntaxe du moteur (setVariableFallback).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import {
  SEQUENCE_VARIABLES,
  insertVariable,
  matchVariables,
  setVariableFallback,
  templateSegments,
  unknownTemplateVariables,
  usedVariables,
  variableFallback,
  variableQueryAt,
  type UsedVariable,
} from '@/lib/sequenceVariables';
import { cn } from '@/lib/utils';
import { VariableMenu } from './VariableMenu';

// Textes de secours proposés pour les données du candidat, celles qui manquent d'un profil à l'autre.
const CANDIDATE_LABELS = new Set(SEQUENCE_VARIABLES.filter((v) => v.group === 'Le candidat').map((v) => v.label));
// Même boîte pour le champ et son calque : les variables tombent à la même place.
const BOX = 'px-3 py-2 text-sm md:text-sm';

interface MessageEditorProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  /** Variables personnelles de l'expéditeur, connues du moteur. */
  extraKeys?: readonly string[];
  describedBy?: string;
  invalid?: boolean;
  /** Sous le champ, avant « + Variable » et les textes de secours : aide et compteur du champ. */
  belowField?: ReactNode;
}

/** Ligne « Si X manque, écrire : » ; la saisie reste locale tant qu'elle a le focus (espaces de fin gardés). */
function FallbackLine({ variable, text, onChange }: { variable: UsedVariable; text: string; onChange: (next: string) => void }) {
  const stored = variableFallback(text, variable.key) ?? '';
  const [draft, setDraft] = useState(stored);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(stored);
  }, [stored, editing]);
  const label = variable.label ?? variable.key;
  return (
    <div className="grid grid-cols-1 items-center gap-1 text-xs sm:grid-cols-[minmax(0,1fr)_11rem] sm:gap-3">
      <span className="text-muted-foreground">Si {label} manque, écrire :</span>
      <Input
        value={draft}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(setVariableFallback(text, variable.key, e.target.value));
        }}
        placeholder="texte de secours"
        aria-label={`Texte de secours pour ${label}`}
        className="h-8 w-full text-xs max-md:h-11"
      />
    </div>
  );
}

export function MessageEditor({
  id,
  value,
  onChange,
  placeholder,
  rows = 6,
  maxLength,
  extraKeys = [],
  describedBy,
  invalid,
  belowField,
}: MessageEditorProps) {
  const helpId = useId();
  const listId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Suggestions de « {{ » : position du curseur, « {{ » écarté par Échap, entrée choisie au clavier.
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  // Sélection remplacée par la variable choisie, et curseur à poser après l'écriture.
  const rangeRef = useRef<{ start: number; end: number } | null>(null);
  const caretRef = useRef<number | null>(null);

  const segments = useMemo(() => templateSegments(value, extraKeys), [value, extraKeys]);
  const hasVariables = segments.some((s) => s.kind === 'variable');
  const unknown = useMemo(() => unknownTemplateVariables([value], extraKeys), [value, extraKeys]);
  const fallbacks = useMemo(
    () => usedVariables([value], extraKeys).filter((v) => v.known && !!v.label && CANDIDATE_LABELS.has(v.label)),
    [value, extraKeys],
  );

  // Hauteur du champ = hauteur du texte : pas de barre de défilement, le calque reste aligné.
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value, focused]);

  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (caretRef.current === null || !el) return;
    const caret = caretRef.current;
    caretRef.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [value]);

  const query = focused && caret !== null ? variableQueryAt(value, caret) : null;
  const queryStart = query?.start ?? null;
  const queryText = query?.query ?? null;
  const suggestions = useMemo(
    () => (queryStart !== null && queryText !== null && queryStart !== dismissedAt ? matchVariables(queryText) : []),
    [queryStart, queryText, dismissedAt],
  );
  const suggesting = suggestions.length > 0;
  const activeIndex = Math.min(active, Math.max(0, suggestions.length - 1));
  useEffect(() => setActive(0), [queryStart, queryText]);
  useEffect(() => {
    if (suggesting) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [suggesting, activeIndex, listId]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setCaret(e.target.selectionStart ?? next.length);
    onChange(next);
  };

  /** Variable choisie dans les suggestions : elle remplace « {{ » et ce qui a été tapé depuis. */
  const complete = (key: string) => {
    if (!query || caret === null) return;
    const result = insertVariable(value, query.start, caret, key);
    if (maxLength && result.text.length > maxLength) return;
    caretRef.current = result.caret;
    setCaret(result.caret);
    onChange(result.text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggesting || !query) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      complete(suggestions[activeIndex].key);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDismissedAt(query.start);
    }
  };

  const pick = (key: string) => {
    const el = fieldRef.current;
    const range = rangeRef.current ?? { start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
    rangeRef.current = null;
    const result = insertVariable(value, range.start, range.end, key);
    if (maxLength && result.text.length > maxLength) return;
    caretRef.current = result.caret;
    onChange(result.text);
  };

  const describedByIds = [describedBy, helpId].filter(Boolean).join(' ');

  return (
    <div className="space-y-2">
      <Popover
        open={suggesting}
        onOpenChange={(open) => {
          if (!open && queryStart !== null) setDismissedAt(queryStart);
        }}
      >
        <PopoverAnchor asChild>
          <div
            ref={boxRef}
            className={cn(
              'relative rounded-lg border border-input bg-background transition-[border-color,box-shadow] duration-150 hover:border-muted-foreground',
              'focus-within:border-ring focus-within:ring-1 focus-within:ring-ring',
              invalid && 'border-danger hover:border-danger',
            )}
          >
            <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words', BOX)}>
              {segments.map((segment, i) => {
                if (segment.kind === 'text') {
                  return <span key={i} className={focused ? 'text-transparent' : 'text-foreground'}>{segment.text}</span>;
                }
                const v = segment.variable;
                if (!v.known) {
                  return (
                    <span key={i} className={cn('underline decoration-danger decoration-wavy underline-offset-2', focused ? 'text-transparent' : 'text-foreground')}>
                      {v.raw}
                    </span>
                  );
                }
                if (focused) return <span key={i} className="rounded-sm bg-brand/15 text-transparent">{v.raw}</span>;
                return (
                  <span key={i} className="rounded-sm bg-brand/15 px-0.5 font-medium text-foreground">
                    {v.label ?? v.key}
                    {v.fallback !== null && <span className="text-muted-foreground"> ·</span>}
                  </span>
                );
              })}
              {'\n'}
            </div>
            <Textarea
              ref={fieldRef}
              id={id}
              value={value}
              onChange={handleChange}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={placeholder}
              rows={rows}
              maxLength={maxLength}
              aria-describedby={describedByIds || undefined}
              aria-invalid={invalid || unknown.some((u) => !u.hasFallback) || undefined}
              aria-autocomplete="list"
              aria-controls={suggesting ? listId : undefined}
              aria-activedescendant={suggesting ? `${listId}-${activeIndex}` : undefined}
              className={cn(
                'relative min-h-0 resize-none overflow-hidden border-0 bg-transparent shadow-none hover:border-0 focus-visible:ring-0',
                BOX,
                !focused && hasVariables && 'text-transparent caret-foreground',
              )}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          collisionPadding={8}
          className="max-h-64 w-72 overflow-y-auto p-1"
          // Le champ garde le focus : la frappe continue dans le message.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            // Un clic dans le champ déplace le curseur : la liste suit, elle ne se ferme pas.
            if (event.target instanceof Node && boxRef.current?.contains(event.target)) event.preventDefault();
          }}
        >
          <div role="listbox" id={listId} aria-label="Variables">
            {suggestions.map((v, i) => (
              <div
                key={v.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => complete(v.key)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm max-md:min-h-11',
                  i === activeIndex && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="shrink-0 text-foreground">{v.label}</span>
                {v.example && <span className="min-w-0 truncate text-xs text-muted-foreground">· {v.example}</span>}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {belowField}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <VariableMenu
          open={menuOpen}
          onOpenChange={(open) => {
            // Ouvert par le bouton : la variable prendra la place de la sélection du champ.
            if (open && !rangeRef.current) {
              const el = fieldRef.current;
              rangeRef.current = { start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
            }
            setMenuOpen(open);
          }}
          onPick={pick}
          onClosed={() => {
            // Fermé sans choix : le curseur revient où il était ; après un choix, il suit la variable.
            const el = fieldRef.current;
            const range = rangeRef.current;
            rangeRef.current = null;
            if (!el) return;
            el.focus();
            if (range) el.setSelectionRange(range.end, range.end);
          }}
        />
        <p id={helpId} className="text-xs text-muted-foreground">Ou tapez {'{{'} dans le texte.</p>
      </div>
      {fallbacks.length > 0 && (
        <div className="space-y-1.5">
          {fallbacks.map((v) => <FallbackLine key={v.key} variable={v} text={value} onChange={onChange} />)}
        </div>
      )}
    </div>
  );
}
