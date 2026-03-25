import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/Navbar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Search, Users, BarChart3, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// ── Tab components (stubs for now, will be fleshed out) ──

const BriefTab = ({ project }: { project: any }) => (
  <div className="space-y-6 p-6">
    <h2 className="text-xl font-semibold">Brief de la mission</h2>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-border p-4 space-y-2">
        <p className="text-sm text-muted-foreground">Titre</p>
        <p className="font-medium">{project?.title || "—"}</p>
      </div>
      <div className="rounded-lg border border-border p-4 space-y-2">
        <p className="text-sm text-muted-foreground">Entreprise</p>
        <p className="font-medium">{project?.company || "—"}</p>
      </div>
      <div className="rounded-lg border border-border p-4 space-y-2">
        <p className="text-sm text-muted-foreground">Localisation</p>
        <p className="font-medium">{project?.location || "—"}</p>
      </div>
      <div className="rounded-lg border border-border p-4 space-y-2">
        <p className="text-sm text-muted-foreground">Statut</p>
        <p className="font-medium capitalize">{project?.status || "—"}</p>
      </div>
    </div>
    {project?.description && (
      <div className="rounded-lg border border-border p-4 space-y-2">
        <p className="text-sm text-muted-foreground">Description</p>
        <p className="text-sm whitespace-pre-wrap">{project.description}</p>
      </div>
    )}
  </div>
);

const SourcingTab = ({ projectId }: { projectId: string }) => (
  <div className="p-6 space-y-4">
    <h2 className="text-xl font-semibold">Sourcing</h2>
    <p className="text-muted-foreground text-sm">
      Lancez des recherches et ajoutez des candidats à cette mission.
    </p>
    <div className="flex items-center justify-center h-48 border border-dashed border-border rounded-lg">
      <div className="text-center space-y-2">
        <Search className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Recherche LinkedIn, Apollo, PDL…</p>
        <Button variant="outline" size="sm">Lancer une recherche</Button>
      </div>
    </div>
  </div>
);

const PipelineTab = ({ projectId }: { projectId: string }) => (
  <div className="p-6 space-y-4">
    <h2 className="text-xl font-semibold">Pipeline</h2>
    <p className="text-muted-foreground text-sm">
      Suivez la progression des candidats dans le processus de recrutement.
    </p>
    <div className="flex items-center justify-center h-48 border border-dashed border-border rounded-lg">
      <div className="text-center space-y-2">
        <Users className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Aucun candidat dans le pipeline</p>
      </div>
    </div>
  </div>
);

const InsightsTab = ({ projectId }: { projectId: string }) => (
  <div className="p-6 space-y-4">
    <h2 className="text-xl font-semibold">Insights</h2>
    <p className="text-muted-foreground text-sm">
      Statistiques et analyses de cette mission.
    </p>
    <div className="flex items-center justify-center h-48 border border-dashed border-border rounded-lg">
      <div className="text-center space-y-2">
        <BarChart3 className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Données insuffisantes pour afficher les insights</p>
      </div>
    </div>
  </div>
);

// ── Copilot Bar ──

const CopilotBar = ({ projectId, projectTitle }: { projectId: string; projectTitle: string }) => {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    toast.info("Copilot en cours de développement", {
      description: `Requête : "${query}" pour la mission "${projectTitle}"`,
    });
    setQuery("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm px-4 py-3"
    >
      <div className="max-w-4xl mx-auto flex items-center gap-3">
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Demandez au Copilot… (mission : ${projectTitle})`}
          className="flex-1 border-none bg-muted/50 focus-visible:ring-1"
          disabled={isLoading}
        />
        <Button type="submit" size="sm" disabled={!query.trim() || isLoading}>
          Envoyer
        </Button>
      </div>
    </form>
  );
};

// ── Main page ──

const MissionWorkspace = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("brief");

  useEffect(() => {
    if (!id) return;

    const fetchProject = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("sourcing_projects")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error || !data) {
        toast.error("Mission introuvable");
        navigate("/missions");
        return;
      }
      setProject(data);
      setLoading(false);
    };

    fetchProject();
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center h-[60vh]">
          <div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 pt-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/missions")}
            className="shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold truncate">{project?.title || "Mission"}</h1>
            {project?.company && (
              <p className="text-sm text-muted-foreground truncate">{project.company}</p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="brief" className="gap-1.5">
              <FileText className="w-3.5 h-3.5" />
              Brief
            </TabsTrigger>
            <TabsTrigger value="sourcing" className="gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Sourcing
            </TabsTrigger>
            <TabsTrigger value="pipeline" className="gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Pipeline
            </TabsTrigger>
            <TabsTrigger value="insights" className="gap-1.5">
              <BarChart3 className="w-3.5 h-3.5" />
              Insights
            </TabsTrigger>
          </TabsList>

          <TabsContent value="brief">
            <BriefTab project={project} />
          </TabsContent>
          <TabsContent value="sourcing">
            <SourcingTab projectId={id!} />
          </TabsContent>
          <TabsContent value="pipeline">
            <PipelineTab projectId={id!} />
          </TabsContent>
          <TabsContent value="insights">
            <InsightsTab projectId={id!} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Copilot Bar */}
      <CopilotBar projectId={id!} projectTitle={project?.title || "Mission"} />
    </div>
  );
};

export default MissionWorkspace;
