export const meta = {
  name: 'feature',
  description: "Orchestre une feature Konekt de bout en bout : archi cadre → frontend-dev + edge-dev implémentent en parallèle → security-reviewer + archi valident en adversaire. C'est l'organigramme de l'équipe d'agents, en code.",
  model: 'fable',
  phases: [
    { title: 'Cadrage', detail: 'archi découpe la tâche (front / edge / data / risques / hors-scope)', model: 'fable' },
    { title: 'Implémentation', detail: 'frontend-dev + edge-dev en parallèle sur leurs zones disjointes', model: 'fable' },
    { title: 'Revue', detail: 'security-reviewer (adversaire) + archi (conformité) sur le diff', model: 'fable' },
  ],
}

// Modèle épinglé : toute l'équipe tourne sur Fable 5 (claude-fable-5), quel que
// soit le modèle de session. On ne dépend PAS de l'héritage (qui basculait sur Opus).
const MODEL = 'fable'

// La description de la feature arrive via `args` (string, ou { task })
const task = typeof args === 'string' ? args : (args && (args.task || args.prompt)) || ''
if (!task) {
  log('⚠️ Aucune description de feature. Passe-la dans `args` (string).')
  return { error: 'no-task' }
}

const PLAN = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'frontendTasks', 'edgeTasks'],
  properties: {
    summary: { type: 'string', description: 'Résumé + critères de succès vérifiables' },
    frontendTasks: { type: 'array', items: { type: 'string' } },
    edgeTasks: { type: 'array', items: { type: 'string' } },
    dataTasks: { type: 'array', items: { type: 'string' }, description: 'Migrations / RLS éventuelles' },
    risks: { type: 'array', items: { type: 'string' } },
    outOfScope: { type: 'array', items: { type: 'string' } },
  },
}

// ── Phase 1 : Cadrage (le tech-lead découpe avant que quiconque code) ──────────
phase('Cadrage')
const plan = await agent(
  `Cadre cette feature Konekt pour la distribuer aux exécutants.\n\nFEATURE:\n${task}\n\n` +
  `Découpe en tâches frontend (src/), edge (supabase/functions/) et data (migrations). ` +
  `Explicite les critères de succès, les risques (multi-tenant, race, migration, quota LLM/LinkedIn) et ce qui est HORS scope.`,
  { agentType: 'archi', model: MODEL, phase: 'Cadrage', label: 'archi:cadrage', schema: PLAN }
)
if (!plan) { log('Cadrage échoué — arrêt.'); return { error: 'planning-failed' } }
log(`Plan : ${plan.frontendTasks.length} front · ${plan.edgeTasks.length} edge · ${(plan.dataTasks || []).length} data`)

// ── Phase 2 : Implémentation (front & edge en parallèle, zones disjointes) ─────
phase('Implémentation')
const oos = (plan.outOfScope || []).join(' ; ') || '—'
const jobs = []
if (plan.frontendTasks.length)
  jobs.push(() => agent(
    `Implémente la part FRONTEND.\n\nContexte : ${plan.summary}\n\nTâches :\n- ${plan.frontendTasks.join('\n- ')}\n\nHORS scope : ${oos}`,
    { agentType: 'frontend-dev', model: MODEL, phase: 'Implémentation', label: 'frontend-dev' }
  ))
if (plan.edgeTasks.length)
  jobs.push(() => agent(
    `Implémente la part EDGE / BACKEND.\n\nContexte : ${plan.summary}\n\nTâches :\n- ${plan.edgeTasks.join('\n- ')}\n\n` +
    `Data/migrations à prévoir : ${(plan.dataTasks || []).join(' ; ') || '—'}\nHORS scope : ${oos}`,
    { agentType: 'edge-dev', model: MODEL, phase: 'Implémentation', label: 'edge-dev' }
  ))
const built = (await parallel(jobs)).filter(Boolean)

// ── Phase 3 : Revue adversariale (sécurité + conformité archi) ────────────────
phase('Revue')
const [security, conformity] = await parallel([
  () => agent(
    `Audite en ADVERSAIRE le diff courant de cette feature (\`git diff origin/main\`).\n` +
    `Feature : ${plan.summary}\n` +
    `Priorités : IDOR / multi-tenant, branding (lance \`node scripts/check-branding.mjs\` sur les fichiers touchés), races React, RLS, secrets/PII loggés.`,
    { agentType: 'security-reviewer', model: MODEL, phase: 'Revue', label: 'security-review' }
  ),
  () => agent(
    `Vérifie que l'implémentation respecte le cadrage et les frontières de modules. Diff : \`git diff origin/main\`.\n` +
    `Critères de succès attendus : ${plan.summary}\nRisques identifiés au cadrage : ${(plan.risks || []).join(' ; ') || '—'}\n` +
    `Signale tout écart au plan, toute violation de frontière de module, tout scope débordé. Ne corrige pas — remonte.`,
    { agentType: 'archi', model: MODEL, phase: 'Revue', label: 'archi:conformité' }
  ),
])

return {
  plan,
  implemented: built.length,
  review: { security, conformity },
  note: "QA e2e (Playwright) et deploy edge (/deploy) restent des gates de suivi hors de ce workflow.",
}
