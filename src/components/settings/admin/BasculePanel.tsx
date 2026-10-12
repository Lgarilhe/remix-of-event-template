import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Copy, Loader2 } from 'lucide-react';
import { Section } from '@/components/layout/Section';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  ApplyResult,
  Failure,
  OrphanRow,
  Preview,
  PreviewPair,
  Readiness,
  ReadinessCheck,
  RollbackResult,
  UnmappedRow,
} from './basculeApi';
import {
  APPLY,
  BATCHES,
  PREVIEW,
  READINESS,
  ROLLBACK,
  STATUS_BADGE,
  STATUS_LABEL,
  checkedAtText,
  countsLine,
  kindLabel,
  previewSummary,
  readinessCounts,
  rowsText,
  skippedReasonLabel,
  unmappedReasonLabel,
  viaLabel,
} from './basculeCopy';
import { ApplyDialog, RollbackDialog } from './BasculeDialogs';
import type { Step } from './useBascule';

/**
 * Les trois étapes de la page « Bascule de la connexion » : vérifier, simuler, convertir.
 * Chaque étape a ses états : repos, chargement (squelette ou roue), échec (ErrorBox avec
 * « Réessayer »), résultat, et vide quand il n'y a rien à montrer.
 */

const maskedOrDash = (label: string | null) => label ?? 'Sans nom';

// Cellules plus serrées sur téléphone : les tableaux de quelques colonnes tiennent sans défilement.
const TH = 'px-2 text-xs sm:px-4 sm:text-sm';
const TD = 'px-2 py-3 sm:p-4';

function Intro({ children }: { children: ReactNode }) {
  return <p className="text-sm text-foreground-secondary">{children}</p>;
}

function Idle({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** Squelette d'une lecture. Le texte masqué est lu par la zone `aria-live` qui l'entoure. */
function RowsSkeleton({ count, label }: { count: number; label: string }) {
  return (
    <div className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} aria-hidden="true" className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

/**
 * Bloc de résultat d'une action qui retire le bouton qui l'a lancée (conversion, annulation) : le focus y
 * passe dès que l'étape quitte le repos, sinon il retombe sur la page.
 */
function useFocusOnStart(phase: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase !== 'idle') ref.current?.focus?.();
  }, [phase]);
  return ref;
}

function failureMessage(failure: Failure): string {
  return failure.message;
}

// ---------------------------------------------------------------------------
// 1. Vérifier
// ---------------------------------------------------------------------------

function UnmappedList({ rows, truncated }: { rows: UnmappedRow[]; truncated: boolean }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg bg-muted px-3 py-2">
      <p className="text-xs font-semibold text-foreground">{READINESS.unmappedHeading}</p>
      <ul className="mt-1 space-y-0.5 text-xs text-foreground-secondary">
        {rows.map((row, index) => (
          <li key={`${row.ref}-${index}`}>
            {kindLabel(row.kind)}, {maskedOrDash(row.label)} <span className="font-mono">{row.ref}</span> : {unmappedReasonLabel(row.reason)}
          </li>
        ))}
        {truncated && <li>{PREVIEW.listTruncated}</li>}
      </ul>
    </div>
  );
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  return (
    <li className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="sm:w-32 sm:shrink-0">
        <Badge variant={STATUS_BADGE[check.status]}>{STATUS_LABEL[check.status]}</Badge>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{check.label}</p>
        {check.detail && <p className="mt-0.5 text-sm text-foreground-secondary">{check.detail}</p>}
        <UnmappedList rows={check.unmapped} truncated={check.unmappedTruncated} />
      </div>
    </li>
  );
}

function ReadinessResult({ value }: { value: Readiness }) {
  const checkedAt = checkedAtText(value.generatedAt);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge variant={value.summary.ready ? 'success' : 'danger'}>
          {value.summary.ready ? READINESS.readyTitle : READINESS.notReadyTitle}
        </Badge>
        <p className="text-sm text-foreground-secondary">{readinessCounts(value.summary)}.</p>
      </div>
      {checkedAt && <p className="text-xs text-muted-foreground">{checkedAt}</p>}
      <ul className="divide-y divide-border border-y border-border" aria-label="Résultat des contrôles">
        {value.checks.map((check) => (
          <CheckRow key={check.id || check.label} check={check} />
        ))}
      </ul>
    </div>
  );
}

export function ReadinessStep({ step, onRun }: { step: Step<Readiness>; onRun: () => void }) {
  return (
    <Section title={READINESS.heading} headingLevel={2} padded>
      <div className="space-y-3">
        <Intro>{READINESS.intro}</Intro>
        <Button variant="primary" className="min-h-11 md:min-h-0" onClick={onRun} loading={step.phase === 'loading'}>
          {READINESS.button}
        </Button>
      </div>
      <div className="mt-4 space-y-3">
        <div aria-live="polite">
          {step.phase === 'idle' && <Idle>{READINESS.emptyBody}</Idle>}
          {step.phase === 'loading' && <RowsSkeleton count={5} label="Vérification en cours" />}
          {step.phase === 'done' && <ReadinessResult value={step.value} />}
        </div>
        {step.phase === 'error' && (
          <ErrorBox title={READINESS.errorTitle} detail={failureMessage(step.failure)} onRetry={onRun} />
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 2. Simuler
// ---------------------------------------------------------------------------

/** Chiffres de la simulation, pour le résumé et pour le dialogue de conversion. */
export function previewTotals(preview: Preview) {
  const all = preview.counts.all;
  return {
    total: all.total,
    already: all.already_v2,
    toConvert: preview.pairs.length,
    unmapped: all.unmapped,
    rows: preview.pairs.reduce((sum, pair) => sum + pair.totalRows, 0),
  };
}

function CountsTable({ preview }: { preview: Preview }) {
  const cols = PREVIEW.columns;
  const kinds = (['linkedin', 'email', 'whatsapp'] as const).filter((kind) => preview.counts[kind].total > 0);
  const rows = [
    ...kinds.map((kind) => ({ key: kind, label: kindLabel(kind), c: preview.counts[kind] })),
    { key: 'all', label: PREVIEW.totalRow, c: preview.counts.all },
  ];
  return (
    <>
      {/* Téléphone : une ligne par type, les quatre chiffres nommés. */}
      <ul className="divide-y divide-border border-y border-border sm:hidden" aria-label={PREVIEW.countsHeading}>
        {rows.map(({ key, label, c }) => (
          <li key={key} className="py-3">
            <p className={key === 'all' ? 'text-sm font-semibold text-foreground' : 'text-sm text-foreground'}>{label}</p>
            <p className="text-xs text-foreground-secondary">{countsLine(c)}</p>
          </li>
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table aria-label={PREVIEW.countsHeading}>
          <TableHeader>
            <TableRow>
              <TableHead className={TH}>{cols.kind}</TableHead>
              <TableHead className={`${TH} text-right`}>{cols.total}</TableHead>
              <TableHead className={`${TH} text-right`}>{cols.already}</TableHead>
              <TableHead className={`${TH} text-right`}>{cols.toConvert}</TableHead>
              <TableHead className={`${TH} text-right`}>{cols.unmapped}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ key, label, c }) => (
              <TableRow key={key} className={key === 'all' ? 'font-semibold' : undefined}>
                <TableCell className={TD}>{label}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`}>{c.total}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`}>{c.already_v2}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`}>{c.via_v1_account_id + c.via_email}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`}>{c.unmapped}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function PairsTable({ pairs }: { pairs: PreviewPair[] }) {
  const cols = PREVIEW.columns;
  return (
    <>
      {/* Téléphone : une ligne par compte. */}
      <ul className="divide-y divide-border border-y border-border sm:hidden" aria-label={PREVIEW.pairsHeading}>
        {pairs.map((pair, index) => (
          <li key={`${pair.ref}-${index}`} className="space-y-1 py-3">
            <p className="text-sm text-foreground">
              {kindLabel(pair.kind)}, {maskedOrDash(pair.label)}{' '}
              <span className="font-mono text-xs text-muted-foreground">{pair.ref}</span>
            </p>
            <p className="text-xs text-foreground-secondary">
              {viaLabel(pair.via)} : {pair.usageError ? PREVIEW.usageUnread.toLowerCase() : rowsText(pair.totalRows)}
            </p>
            {pair.notes.length > 0 && <p className="text-xs text-foreground-secondary">{pair.notes.join(' ')}</p>}
          </li>
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table aria-label={PREVIEW.pairsHeading}>
          <TableHeader>
            <TableRow>
              <TableHead className={TH}>{cols.kind}</TableHead>
              <TableHead className={TH}>{cols.account}</TableHead>
              <TableHead className={TH}>{cols.via}</TableHead>
              <TableHead className={`${TH} text-right`}>{cols.rows}</TableHead>
              <TableHead className={TH}>{cols.notes}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pairs.map((pair, index) => (
              <TableRow key={`${pair.ref}-${index}`}>
                <TableCell className={`${TD} whitespace-nowrap`}>{kindLabel(pair.kind)}</TableCell>
                <TableCell className={TD}>
                  <span className="text-foreground">{maskedOrDash(pair.label)}</span>{' '}
                  <span className="font-mono text-xs text-muted-foreground">{pair.ref}</span>
                </TableCell>
                <TableCell className={`${TD} whitespace-nowrap`}>{viaLabel(pair.via)}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`}>{pair.usageError ? PREVIEW.usageUnread : pair.totalRows}</TableCell>
                <TableCell className={`${TD} min-w-48 text-xs text-foreground-secondary`}>
                  {pair.notes.length > 0 ? pair.notes.join(' ') : ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function UnmappedTable({ rows, truncated }: { rows: UnmappedRow[]; truncated: boolean }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{PREVIEW.unmappedHeading}</h3>
      <Intro>{PREVIEW.unmappedIntro}</Intro>
      <ul className="divide-y divide-border border-y border-border" aria-label={PREVIEW.unmappedHeading}>
        {rows.map((row, index) => (
          <li key={`${row.ref}-${index}`} className="py-3">
            <p className="text-sm text-foreground">
              {kindLabel(row.kind)}, {maskedOrDash(row.label)} <span className="font-mono text-xs text-muted-foreground">{row.ref}</span>
            </p>
            <p className="text-xs text-foreground-secondary">{unmappedReasonLabel(row.reason)}</p>
          </li>
        ))}
      </ul>
      {truncated && <p className="text-xs text-muted-foreground">{PREVIEW.listTruncated}</p>}
    </div>
  );
}

function BatchesList({ preview, busy, onRollback }: { preview: Preview; busy: boolean; onRollback: (batchId: string) => void }) {
  if (preview.batches.length === 0 && !preview.batchesError) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{BATCHES.heading}</h3>
      {preview.batchesError && <p className="text-sm text-foreground-secondary">{BATCHES.unreadable}</p>}
      <ul className="divide-y divide-border border-y border-border">
        {preview.batches.map((batch) => (
          <li key={batch.batchId} className="space-y-2 py-3">
            <div className="min-w-0">
              <p className="break-all font-mono text-xs text-foreground">{batch.batchId}</p>
              <p className="text-xs text-muted-foreground">
                {BATCHES.pairs(batch.pairs)}
                {batch.appliedAt ? `, ${new Date(batch.appliedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Badge variant={batch.rolledBack ? 'muted' : 'info'}>{batch.rolledBack ? BATCHES.rolledBack : BATCHES.applied}</Badge>
              {!batch.rolledBack && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 text-muted-foreground hover:text-danger md:min-h-0"
                  aria-label={BATCHES.rollbackAria(batch.batchId)}
                  disabled={busy}
                  onClick={() => onRollback(batch.batchId)}
                >
                  {BATCHES.rollbackButton}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function nothingToConvertText(preview: Preview): string {
  const all = preview.counts.all;
  if (all.total === 0) return PREVIEW.nothingNoAccounts;
  if (all.already_v2 === all.total) return PREVIEW.nothingAllConverted;
  return PREVIEW.nothingNoMatch;
}

function OrphansList({ rows, truncated }: { rows: OrphanRow[]; truncated: boolean }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{PREVIEW.orphansHeading}</h3>
      <Intro>{PREVIEW.orphansIntro}</Intro>
      <ul className="divide-y divide-border border-y border-border" aria-label={PREVIEW.orphansHeading}>
        {rows.map((row, index) => (
          <li key={`${row.table}-${row.column}-${row.ref}-${index}`} className="py-3">
            <p className="text-sm text-foreground">
              <span className="font-mono text-xs">{row.table}.{row.column}</span>{' '}
              <span className="font-mono text-xs text-muted-foreground">{row.ref}</span>
            </p>
            <p className="text-xs text-foreground-secondary">{rowsText(row.rows)}</p>
          </li>
        ))}
      </ul>
      {truncated && <p className="text-xs text-muted-foreground">{PREVIEW.orphansTruncated}</p>}
    </div>
  );
}

function PreviewResult({ preview, busy, onRollback }: { preview: Preview; busy: boolean; onRollback: (batchId: string) => void }) {
  const totals = previewTotals(preview);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{previewSummary(totals)}</p>
        {totals.toConvert > 0 && (
          <p className="text-sm text-foreground-secondary">{rowsText(totals.rows)} à réécrire dans la base.</p>
        )}
      </div>
      {preview.truncated && (
        <p className="rounded-lg bg-warning-muted px-3 py-2 text-sm text-foreground">{PREVIEW.truncated}</p>
      )}
      {preview.sharedTargets > 0 && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground-secondary">{PREVIEW.sharedTargets(preview.sharedTargets)}</p>
      )}
      {totals.total > 0 && <CountsTable preview={preview} />}
      {preview.pairs.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{PREVIEW.pairsHeading}</h3>
          <PairsTable pairs={preview.pairs} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm font-semibold text-foreground">{PREVIEW.nothingTitle}</p>
          <p className="mt-1 text-sm text-foreground-secondary">{nothingToConvertText(preview)}</p>
        </div>
      )}
      {preview.unmapped.length > 0 && <UnmappedTable rows={preview.unmapped} truncated={preview.unmappedTruncated} />}
      {preview.orphansError && (
        <p className="rounded-lg bg-warning-muted px-3 py-2 text-sm text-foreground">{PREVIEW.orphansUnread}</p>
      )}
      {preview.orphans.length > 0 && <OrphansList rows={preview.orphans} truncated={preview.orphansTruncated} />}
      <BatchesList preview={preview} busy={busy} onRollback={onRollback} />
    </div>
  );
}

export function PreviewStep({
  step,
  busy,
  onRun,
  onRollback,
}: {
  step: Step<Preview>;
  /** Une conversion ou une annulation est en cours : les boutons d'annulation sont éteints. */
  busy: boolean;
  onRun: () => void;
  onRollback: (batchId: string) => void;
}) {
  return (
    <Section title={PREVIEW.heading} headingLevel={2} padded>
      <div className="space-y-3">
        <Intro>{PREVIEW.intro}</Intro>
        <Button variant="default" className="min-h-11 md:min-h-0" onClick={onRun} loading={step.phase === 'loading'}>
          {PREVIEW.button}
        </Button>
      </div>
      <div className="mt-4 space-y-3">
        <div aria-live="polite">
          {step.phase === 'idle' && <Idle>{PREVIEW.emptyBody}</Idle>}
          {step.phase === 'loading' && <RowsSkeleton count={4} label="Simulation en cours" />}
          {step.phase === 'done' && <PreviewResult preview={step.value} busy={busy} onRollback={onRollback} />}
        </div>
        {step.phase === 'error' && (
          <ErrorBox title={PREVIEW.errorTitle} detail={failureMessage(step.failure)} onRetry={onRun} />
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 3. Convertir
// ---------------------------------------------------------------------------

function CopyBatchId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Copie refusée par le navigateur : le numéro reste affiché et sélectionnable.
    }
  };
  return (
    <Button variant="ghost" size="sm" className="min-h-11 md:min-h-0" onClick={copy} aria-label={APPLY.copyAria}>
      <Copy aria-hidden="true" />
      {copied ? APPLY.copied : APPLY.copy}
    </Button>
  );
}

function ApplyResultView({
  result,
  rolledBack,
  busy,
  onRollback,
}: {
  result: ApplyResult;
  rolledBack: boolean;
  busy: boolean;
  onRollback: (batchId: string) => void;
}) {
  if (!result.batchId) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
        <p className="text-sm text-foreground-secondary">{APPLY.nothingDone}</p>
      </div>
    );
  }
  // Des lignes restées sur l'ancien identifiant (colonnes sautées) font d'un lot sans échec un lot partiel.
  const clean = result.success && result.failed === 0 && !result.incomplete && result.skippedRows === 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={clean ? 'success' : 'warning'}>{clean ? APPLY.doneTitle : APPLY.partialTitle}</Badge>
        <p className="text-sm text-foreground">{APPLY.summary(result.applied, result.rowsTotal)}</p>
      </div>
      {result.failed > 0 && <p className="text-sm text-foreground-secondary">{APPLY.failedPairs(result.failed)}</p>}
      {result.remaining > 0 && <p className="text-sm text-foreground-secondary">{APPLY.remaining(result.remaining)}</p>}
      {result.unmappedLeft > 0 && <p className="text-sm text-foreground-secondary">{APPLY.unmappedLeft(result.unmappedLeft)}</p>}

      {result.skippedRows > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{APPLY.skippedHeading}</h3>
          <p className="rounded-lg bg-warning-muted px-3 py-2 text-sm text-foreground">{APPLY.skippedRows(result.skippedRows)}</p>
          <ul className="divide-y divide-border border-y border-border" aria-label={APPLY.skippedHeading}>
            {result.skippedColumns.map((column, index) => (
              <li key={`${column.ref}-${column.table}-${column.column}-${index}`} className="py-3">
                <p className="text-sm text-foreground">
                  <span className="font-mono text-xs">{column.table}.{column.column}</span>{' '}
                  <span className="font-mono text-xs text-muted-foreground">{column.ref}</span>
                </p>
                <p className="text-xs text-foreground-secondary">
                  {APPLY.skippedLine(maskedOrDash(column.label), skippedReasonLabel(column.status), column.rows)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.failedPairs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{APPLY.failedHeading}</h3>
          <ul className="divide-y divide-border border-y border-border" aria-label={APPLY.failedHeading}>
            {result.failedPairs.map((pair, index) => (
              <li key={`${pair.ref}-${index}`} className="py-3">
                <p className="text-sm text-foreground">
                  {kindLabel(pair.kind)}, {maskedOrDash(pair.label)} <span className="font-mono text-xs text-muted-foreground">{pair.ref}</span>
                </p>
                <p className="text-xs text-foreground-secondary">{pair.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg bg-muted px-3 py-2">
        <p className="text-xs font-semibold text-foreground">{APPLY.batchLabel}</p>
        <div className="flex flex-wrap items-center gap-x-2">
          <p className="break-all font-mono text-sm text-foreground">{result.batchId}</p>
          <CopyBatchId id={result.batchId} />
        </div>
      </div>

      {rolledBack ? null : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-sm text-foreground-secondary">{APPLY.rollbackHint}</p>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 text-muted-foreground hover:text-danger md:min-h-0"
            disabled={busy}
            onClick={() => onRollback(result.batchId as string)}
          >
            {BATCHES.rollbackButton}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ApplyStep({
  step,
  preview,
  readiness,
  rolledBackBatch,
  busy,
  onApply,
  onRollback,
}: {
  step: Step<ApplyResult>;
  preview: Step<Preview>;
  readiness: Step<Readiness>;
  /** Lot déjà annulé pendant cette visite, pour masquer son bouton d'annulation. */
  rolledBackBatch: string | null;
  /** Une conversion ou une annulation est en cours. */
  busy: boolean;
  onApply: (allowUnmapped: boolean) => void;
  onRollback: (batchId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const totals = useMemo(() => (preview.phase === 'done' ? previewTotals(preview.value) : null), [preview]);
  const running = step.phase === 'loading';
  const canApply = totals !== null && totals.toConvert > 0 && !busy;
  const blocking = readiness.phase === 'done' ? readiness.value.summary.ko : 0;
  const hint = totals === null ? APPLY.needPreview : totals.toConvert === 0 ? APPLY.nothing : null;
  // Le bouton de la conversion s'éteint pendant l'appel : le focus passe au bloc de résultat.
  const resultRef = useFocusOnStart(step.phase);

  return (
    <Section title={APPLY.heading} headingLevel={2} padded>
      <div className="space-y-3">
        <Intro>{APPLY.intro}</Intro>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="primary" className="min-h-11 md:min-h-0" disabled={!canApply} loading={running} onClick={() => setOpen(true)}>
            {APPLY.button}
          </Button>
          {hint && !running && <p className="text-sm text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {step.phase !== 'idle' && (
        <div
          ref={resultRef}
          tabIndex={-1}
          role="group"
          aria-label={APPLY.resultLabel}
          aria-live={step.phase === 'error' ? 'off' : 'polite'}
          className="mt-4 space-y-3 outline-none"
        >
          {running && (
            <p className="flex items-center gap-2 text-sm text-foreground-secondary">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {APPLY.running}
            </p>
          )}
          {step.phase === 'error' && (
            <ErrorBox
              title={step.failure.lost ? APPLY.unknownTitle : APPLY.failedTitle}
              detail={step.failure.lost ? APPLY.lostAnswer : failureMessage(step.failure)}
            />
          )}
          {step.phase === 'done' && (
            <ApplyResultView
              result={step.value}
              rolledBack={step.value.batchId !== null && step.value.batchId === rolledBackBatch}
              busy={busy}
              onRollback={onRollback}
            />
          )}
        </div>
      )}
      {totals && (
        <ApplyDialog
          open={open}
          onOpenChange={setOpen}
          accounts={totals.toConvert}
          rows={totals.rows}
          unmapped={totals.unmapped}
          blocking={blocking}
          onConfirm={onApply}
        />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Annulation d'un lot
// ---------------------------------------------------------------------------

export function RollbackStatus({ step, batchId }: { step: Step<RollbackResult>; batchId: string | null }) {
  // Le bouton qui a lancé l'annulation disparaît (la simulation est remise à zéro) : le focus passe ici.
  const ref = useFocusOnStart(step.phase);
  if (step.phase === 'idle') return null;
  return (
    <Section title={ROLLBACK.heading} headingLevel={2} padded>
      <div
        ref={ref}
        tabIndex={-1}
        role="group"
        aria-label={ROLLBACK.statusLabel}
        aria-live={step.phase === 'error' ? 'off' : 'polite'}
        className="space-y-2 outline-none"
      >
        {batchId && <p className="break-all font-mono text-xs text-muted-foreground">{batchId}</p>}
        {step.phase === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-foreground-secondary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {ROLLBACK.running}
          </p>
        )}
        {step.phase === 'error' && (
          <ErrorBox
            title={step.failure.lost ? ROLLBACK.unknownTitle : ROLLBACK.failedTitle}
            detail={step.failure.lost ? ROLLBACK.lostAnswer : failureMessage(step.failure)}
          />
        )}
        {step.phase === 'done' && (
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              {ROLLBACK.doneTitle}
            </p>
            <p className="text-sm text-foreground-secondary">{ROLLBACK.summary(step.value.pairs, step.value.restoredRows)}</p>
            {step.value.movedRows > 0 && (
              <p className="text-sm text-foreground-secondary">{ROLLBACK.moved(step.value.movedRows)}</p>
            )}
            {step.value.stillNewRows > 0 && (
              <p className="rounded-lg bg-warning-muted px-3 py-2 text-sm text-foreground">{ROLLBACK.stillNew(step.value.stillNewRows)}</p>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

export { RollbackDialog };
