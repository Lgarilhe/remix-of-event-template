import React from 'react';
import { makeAssistantToolUI } from '@assistant-ui/react';

/** Placeholder tool UIs — these render inline cards when tools are invoked */

export const SearchCandidatesToolUI = makeAssistantToolUI({
  toolName: 'search_candidates',
  render: ({ args, status }) => (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">🔍 Recherche de candidats</span>
      {status.type === 'running' && (
        <span className="ml-2 animate-pulse">en cours…</span>
      )}
      {status.type === 'complete' && (
        <span className="ml-2 text-accent">✓ terminée</span>
      )}
    </div>
  ),
});

export const EnrichCompanyToolUI = makeAssistantToolUI({
  toolName: 'enrich_company',
  render: ({ args, status }) => (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">🏢 Enrichissement entreprise</span>
      {status.type === 'running' && (
        <span className="ml-2 animate-pulse">en cours…</span>
      )}
      {status.type === 'complete' && (
        <span className="ml-2 text-accent">✓ terminé</span>
      )}
    </div>
  ),
});

export const WebSearchToolUI = makeAssistantToolUI({
  toolName: 'web_search',
  render: ({ args, status }) => (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">🌐 Recherche web</span>
      {status.type === 'running' && (
        <span className="ml-2 animate-pulse">en cours…</span>
      )}
      {status.type === 'complete' && (
        <span className="ml-2 text-accent">✓ terminée</span>
      )}
    </div>
  ),
});
