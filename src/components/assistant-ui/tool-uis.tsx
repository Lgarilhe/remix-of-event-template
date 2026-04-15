import { makeAssistantToolUI } from "@assistant-ui/react";
import { Search, Building2, Globe, Loader2 } from "lucide-react";

export const SearchCandidatesToolUI = makeAssistantToolUI({
  toolName: "search_candidates",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent text-xs text-muted-foreground my-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>
            Recherche de{" "}
            {(args as Record<string, unknown>)?.person_titles
              ? ((args as Record<string, string[]>).person_titles || []).join(
                  ", ",
                )
              : "profils"}
            ...
          </span>
        </div>
      );
    }

    let data: Record<string, unknown> | null = null;
    try {
      data =
        typeof result === "string" ? JSON.parse(result) : (result as Record<string, unknown> | null);
    } catch {
      // ignore parse errors
    }
    if (!data) return null;

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-accent text-xs text-muted-foreground my-2">
        <Search className="h-3 w-3" />
        <span>{(data.total as number) || 0} profils trouves</span>
      </div>
    );
  },
});

export const EnrichCompanyToolUI = makeAssistantToolUI({
  toolName: "enrich_company",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent text-xs text-muted-foreground my-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>
            Analyse de {(args as Record<string, unknown>)?.company_name as string || "l'entreprise"}
            ...
          </span>
        </div>
      );
    }

    let data: Record<string, unknown> | null = null;
    try {
      data =
        typeof result === "string" ? JSON.parse(result) : (result as Record<string, unknown> | null);
    } catch {
      // ignore parse errors
    }
    if (!data) return null;

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-accent text-xs text-muted-foreground my-2">
        <Building2 className="h-3 w-3" />
        <span>
          {(data.name as string) || "?"} &mdash; {(data.employees as string) || "?"} employes,{" "}
          {(data.industry as string) || "?"}
        </span>
      </div>
    );
  },
});

export const WebSearchToolUI = makeAssistantToolUI({
  toolName: "web_search",
  render: ({ args, status }) => {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-accent text-xs text-muted-foreground my-2">
        <Globe className="h-3 w-3" />
        <span>
          {status.type === "running"
            ? "Recherche web..."
            : `Web: ${(args as Record<string, unknown>)?.query || ""}`}
        </span>
      </div>
    );
  },
});
