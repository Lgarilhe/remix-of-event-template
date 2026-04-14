import { makeAssistantToolUI } from "@assistant-ui/react";
import { Search, Building2, Globe, Check } from "lucide-react";
import { cn } from "@/lib/utils";

function ToolCard({
  icon: Icon,
  label,
  isRunning,
  children,
}: {
  icon: React.ElementType;
  label: string;
  isRunning: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 my-2 rounded-xl border transition-all duration-300 animate-fade-in",
        isRunning
          ? "border-primary/20 bg-primary/5 shadow-sm shadow-primary/5"
          : "border-border/40 bg-muted/20"
      )}
    >
      {/* Icon with spinner or check */}
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        {isRunning ? (
          <>
            <span className="absolute inset-0 rounded-lg border-2 border-transparent border-t-primary animate-spin" />
            <Icon className="h-3.5 w-3.5 text-primary" />
          </>
        ) : (
          <>
            <Icon className="h-3.5 w-3.5 text-primary/60" />
            <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary/80 flex items-center justify-center">
              <Check className="h-2 w-2 text-primary-foreground" />
            </span>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          "text-xs font-medium truncate",
          isRunning ? "text-foreground" : "text-muted-foreground"
        )}>
          {label}
        </p>
        {children && (
          <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
            {children}
          </p>
        )}
      </div>

      {/* Running shimmer bar */}
      {isRunning && (
        <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full w-1/2 rounded-full bg-primary/50"
            style={{
              animation: "shimmer 1.5s ease-in-out infinite",
            }}
          />
        </div>
      )}
    </div>
  );
}

export const SearchCandidatesToolUI = makeAssistantToolUI({
  toolName: "search_candidates",
  render: ({ args, result, status }) => {
    const isRunning = status.type === "running";
    const titles = (args as Record<string, string[]>)?.person_titles;
    const label = isRunning
      ? `Recherche ${titles?.length ? titles.join(", ") : "de profils"}…`
      : (() => {
          let data: Record<string, unknown> | null = null;
          try {
            data = typeof result === "string" ? JSON.parse(result) : (result as Record<string, unknown> | null);
          } catch { /* skip */ }
          return `${(data?.total as number) || 0} profils trouvés`;
        })();

    return (
      <ToolCard icon={Search} label={label} isRunning={isRunning}>
        {!isRunning && titles?.length ? titles.join(", ") : null}
      </ToolCard>
    );
  },
});

export const EnrichCompanyToolUI = makeAssistantToolUI({
  toolName: "enrich_company",
  render: ({ args, result, status }) => {
    const isRunning = status.type === "running";
    const companyName = (args as Record<string, unknown>)?.company_name as string || "l'entreprise";

    let detail: string | null = null;
    if (!isRunning) {
      let data: Record<string, unknown> | null = null;
      try {
        data = typeof result === "string" ? JSON.parse(result) : (result as Record<string, unknown> | null);
      } catch { /* skip */ }
      if (data) {
        detail = [data.employees, data.industry].filter(Boolean).join(" · ");
      }
    }

    return (
      <ToolCard
        icon={Building2}
        label={isRunning ? `Analyse de ${companyName}…` : companyName}
        isRunning={isRunning}
      >
        {detail}
      </ToolCard>
    );
  },
});

export const WebSearchToolUI = makeAssistantToolUI({
  toolName: "web_search",
  render: ({ args, status }) => {
    const isRunning = status.type === "running";
    const query = (args as Record<string, unknown>)?.query as string || "";

    return (
      <ToolCard
        icon={Globe}
        label={isRunning ? "Recherche web…" : `Web : ${query}`}
        isRunning={isRunning}
      >
        {isRunning && query ? query : null}
      </ToolCard>
    );
  },
});
