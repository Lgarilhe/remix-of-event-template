import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Marqueur de build (refonte mission, lot 0b) : 7 premiers caractères du commit
// déployé par Vercel, sinon « dev ». Envoyé dans X-Client-Info par le client
// Supabase ; le journal des écritures directes le relève.
const commitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
const KONEKT_BUILD = /^[0-9a-f]{7,40}$/i.test(commitSha) ? commitSha.slice(0, 7).toLowerCase() : "dev";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __KONEKT_BUILD__: JSON.stringify(KONEKT_BUILD),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  esbuild: {
    drop: mode === "production" ? ["console", "debugger"] : [],
  },
  build: {
    sourcemap: mode === "production" ? "hidden" : true,
  },
}));
