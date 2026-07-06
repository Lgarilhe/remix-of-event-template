/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { visualizer } from "rollup-plugin-visualizer";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    // Analyse du bundle : ANALYZE=1 npx vite build → dist/stats.html
    process.env.ANALYZE && visualizer({ filename: "dist/stats.html", gzipSize: true }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  esbuild: {
    drop: mode === "production" ? ["console", "debugger"] : [],
  },
  test: {
    // Tests unitaires vitest uniquement — les specs e2e/ sont du Playwright
    // (npm run test:e2e) et ne doivent pas être ramassées ici.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  build: {
    sourcemap: mode === "production" ? "hidden" : true,
    rollupOptions: {
      output: {
        // Vendors stables dans des chunks dédiés : le cache navigateur les
        // conserve entre deux déploiements (l'entrée applicative, elle, change
        // à chaque deploy). ⚠️ N'y mettre QUE des libs déjà chargées par
        // l'entrée (App importe Toaster/TooltipProvider/Dialog) : un
        // manualChunk devient une dépendance statique du bundle initial —
        // y mettre lucide-react ou des radix utilisés seulement par des
        // routes lazy les ferait charger au premier paint.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-data": ["@supabase/supabase-js", "@tanstack/react-query"],
          "vendor-ui": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-toast",
          ],
        },
      },
    },
  },
}));
