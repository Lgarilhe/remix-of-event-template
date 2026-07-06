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
        // à chaque deploy). Ne pas y mettre les libs lazy-loadées (@xyflow,
        // recharts, @assistant-ui) : elles doivent rester dans leurs chunks
        // à la demande.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-data": ["@supabase/supabase-js", "@tanstack/react-query"],
          "vendor-ui": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-popover",
            "@radix-ui/react-select",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toast",
            "lucide-react",
          ],
        },
      },
    },
  },
}));
