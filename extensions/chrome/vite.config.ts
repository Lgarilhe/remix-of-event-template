import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

/**
 * Vite config pour la Chrome extension Konekt.
 *
 * Build 3 entry points (popup, options, background, content) en parallèle dans dist/.
 * Le manifest.json + icons sont copiés au final via un plugin custom.
 */
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-manifest-and-icons',
      writeBundle() {
        // Copie le manifest tel quel à la racine du dist
        copyFileSync(resolve(__dirname, 'manifest.json'), resolve(__dirname, 'dist/manifest.json'));

        // Copie les icons
        const iconsDir = resolve(__dirname, 'dist/icons');
        if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
        for (const size of [16, 32, 48, 128]) {
          const src = resolve(__dirname, `public/icons/icon-${size}.png`);
          if (existsSync(src)) {
            copyFileSync(src, resolve(iconsDir, `icon-${size}.png`));
          }
        }
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        // 3 entry points HTML pour popup + options
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        // Background SW + content script en JS pur (pas de HTML wrapper)
        background: resolve(__dirname, 'src/background/sw.ts'),
        content: resolve(__dirname, 'src/content/linkedin.ts'),
      },
      output: {
        // Garde les chemins prévisibles : src/background/sw.js, src/content/linkedin.js, etc.
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'src/background/sw.js';
          if (chunkInfo.name === 'content') return 'src/content/linkedin.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          // CSS du content script doit être à src/content/linkedin.css (référencé dans manifest)
          if (assetInfo.name?.endsWith('.css') && assetInfo.name.includes('linkedin')) {
            return 'src/content/linkedin.css';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
