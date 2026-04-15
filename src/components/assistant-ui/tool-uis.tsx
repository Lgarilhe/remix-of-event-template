/**
 * Tool UI components for assistant-ui
 * These render tool call results inline in the chat thread.
 * Currently the tools (search_candidates, enrich_company, web_search) are executed
 * server-side in the edge function, so these are placeholder display components.
 */
import React from "react";

export const SearchCandidatesToolUI: React.FC = () => {
  // Tool calls are handled server-side — no client-side rendering needed
  return null;
};

export const EnrichCompanyToolUI: React.FC = () => {
  return null;
};

export const WebSearchToolUI: React.FC = () => {
  return null;
};
