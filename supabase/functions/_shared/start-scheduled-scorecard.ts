/** Called only after the appointment has been saved. Preparation must not fail scheduling. */
export function startScheduledScorecard(sessionId: string, organizationId: string | null | undefined): void {
  if (!organizationId) return;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return;
  const work = fetch(`${url}/functions/v1/generate-scorecard`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ qualificationSessionId: sessionId, organization_id: organizationId, background: true }),
    signal: AbortSignal.timeout(15_000),
  }).then(async response => {
    if (!response.ok) console.error('[scheduled-scorecard] start refused', response.status);
    await response.body?.cancel();
  }).catch(error => console.error('[scheduled-scorecard] start failed', error));
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
}
