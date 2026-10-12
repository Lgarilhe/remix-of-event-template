/**
 * « Coller un lien de recherche LinkedIn » : une adresse de recherche de personnes
 * (Classic, Recruiter ou Sales Navigator) devient les filtres de l'écran.
 *
 * Le serveur lit l'adresse (action `search_from_url`) ; aucune recherche n'est lancée.
 * Les filtres lus sont rendus à l'appelant par `onApplyFilters`, qui les fusionne dans
 * l'état comme le fait la génération par l'IA. Ce qui n'a pas pu être lu est écrit sous
 * le champ, en français. Logique de lecture : `searchUrlFilters.ts`.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invokeUnipile } from '@/lib/invokeUnipile';
import type { LinkedInApiType, LinkedInFiltersState } from '@/components/outreach/types';
import {
  appliedFiltersText,
  PASTE_URL_COPY,
} from './searchControlsCopy';
import {
  availableSearchApis,
  buildSearchUrlUpdate,
  parseSearchFromUrlResponse,
} from './searchUrlFilters';

interface PasteSearchUrlProps {
  accountId: string | null;
  /** Source de recherche en cours. */
  api: LinkedInApiType;
  /** Licences du compte sélectionné. */
  subscriptions?: { recruiter?: boolean; sales_navigator?: boolean };
  onApplyFilters: (update: Partial<LinkedInFiltersState>) => void;
  disabled?: boolean;
}

interface Feedback {
  tone: 'success' | 'info' | 'error';
  message: string;
  warnings: string[];
}

export const PasteSearchUrl: React.FC<PasteSearchUrlProps> = ({
  accountId,
  api,
  subscriptions,
  onApplyFilters,
  disabled,
}) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const requestRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** Vrai quand le champ vient d'être refermé par la personne ou par une réussite : le focus revient au bouton. */
  const restoreFocusRef = useRef(false);
  const inputId = React.useId();

  // Un autre compte : la lecture en cours et le message affiché ne le concernent plus.
  useEffect(() => {
    requestRef.current += 1;
    setLoading(false);
    setFeedback(null);
    return () => { requestRef.current += 1; };
  }, [accountId]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  // Le bouton « Reprendre les filtres » est désactivé pendant la lecture et perd le focus : il revient au champ en cas d'échec.
  useEffect(() => {
    if (!loading && open && document.activeElement === document.body) inputRef.current?.focus();
  }, [loading, open]);

  const submit = useCallback(async () => {
    const url = value.trim();
    if (!url) {
      setFeedback({ tone: 'error', message: PASTE_URL_COPY.emptyInput, warnings: [] });
      return;
    }
    if (!accountId) {
      setFeedback({ tone: 'error', message: PASTE_URL_COPY.needsAccount, warnings: [] });
      return;
    }
    const request = ++requestRef.current;
    setLoading(true);
    setFeedback(null);
    try {
      const { data } = await invokeUnipile({ body: { action: 'search_from_url', account_id: accountId, url } });
      if (requestRef.current !== request) return;
      const parsed = parseSearchFromUrlResponse(data);
      if ('message' in parsed) {
        setFeedback({ tone: 'error', message: parsed.message, warnings: [] });
        return;
      }
      const { update, count, warnings } = buildSearchUrlUpdate(parsed.value, {
        currentApi: api,
        availableApis: availableSearchApis(subscriptions),
      });
      if (count === 0) {
        setFeedback({ tone: 'info', message: PASTE_URL_COPY.nothingRead, warnings });
        return;
      }
      onApplyFilters(update);
      setValue('');
      restoreFocusRef.current = true;
      setOpen(false);
      setFeedback({
        tone: 'success',
        message: `${appliedFiltersText(count)} ${PASTE_URL_COPY.replacedHint}`,
        warnings,
      });
    } catch {
      if (requestRef.current === request) {
        setFeedback({ tone: 'error', message: PASTE_URL_COPY.genericError, warnings: [] });
      }
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [value, accountId, api, subscriptions, onApplyFilters]);

  const close = () => {
    restoreFocusRef.current = true;
    setOpen(false);
    setValue('');
    setFeedback((current) => (current?.tone === 'success' ? current : null));
  };

  return (
    <div className="space-y-2">
      {!open ? (
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="sm"
          className="max-sm:min-h-11"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <Link2 aria-hidden="true" />
          {PASTE_URL_COPY.trigger}
        </Button>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor={inputId} className="text-xs text-muted-foreground">
            {PASTE_URL_COPY.label}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={inputRef}
              id={inputId}
              type="url"
              inputMode="url"
              autoComplete="off"
              value={value}
              readOnly={loading}
              aria-busy={loading}
              placeholder={PASTE_URL_COPY.placeholder}
              aria-describedby={feedback?.tone === 'error' ? `${inputId}-help ${inputId}-result` : `${inputId}-help`}
              error={feedback?.tone === 'error'}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); if (!loading) void submit(); }
                else if (e.key === 'Escape' && !loading) close();
              }}
              className="min-w-0 flex-1 max-sm:h-11"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="max-sm:min-h-11"
              disabled={loading || disabled || value.trim() === ''}
              onClick={() => void submit()}
            >
              {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
              {loading ? PASTE_URL_COPY.submitting : PASTE_URL_COPY.submit}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="max-sm:min-h-11"
              disabled={loading}
              onClick={close}
            >
              {PASTE_URL_COPY.close}
            </Button>
          </div>
          <p id={`${inputId}-help`} className="text-xs text-muted-foreground">{PASTE_URL_COPY.help}</p>
        </div>
      )}

      {/* La zone vocale existe avant le message : un texte inséré dans une zone déjà montée est annoncé. */}
      <div id={`${inputId}-result`} role="status" aria-live="polite" aria-atomic="true">
        {feedback && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1 space-y-1">
              <p className={feedback.tone === 'error' ? 'text-destructive' : 'text-foreground'}>{feedback.message}</p>
              {feedback.warnings.length > 0 && (
                <div className="text-muted-foreground">
                  <p>{PASTE_URL_COPY.warningsTitle}</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {feedback.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                  <p className="mt-1">{PASTE_URL_COPY.warningsHint}</p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              aria-label={PASTE_URL_COPY.dismissResult}
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:h-11 max-sm:w-11"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
