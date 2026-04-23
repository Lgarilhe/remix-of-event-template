#!/usr/bin/env node
/**
 * generate-icons.mjs — convertit l'icône SVG source en 4 PNG aux tailles requises
 * par le manifest Chrome : 16, 32, 48, 128 px.
 *
 * Usage : `node scripts/generate-icons.mjs`
 *   (depuis le dossier extensions/chrome)
 *
 * Dependency : sharp (npm install --no-save sharp)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SVG_PATH = resolve(__dirname, '../public/icons/icon.svg');
const OUT_DIR = resolve(__dirname, '../public/icons');

if (!existsSync(SVG_PATH)) {
  console.error('❌ icon.svg not found at', SVG_PATH);
  process.exit(1);
}

const svgBuffer = readFileSync(SVG_PATH);
const SIZES = [16, 32, 48, 128];

console.log('🎨 Generating Konekt extension icons from SVG…');

for (const size of SIZES) {
  const outPath = resolve(OUT_DIR, `icon-${size}.png`);
  await sharp(svgBuffer)
    .resize(size, size, {
      kernel: sharp.kernel.lanczos3,
      fit: 'contain',
      background: { r: 10, g: 10, b: 10, alpha: 1 },
    })
    .png({
      compressionLevel: 9,
      palette: false,
    })
    .toFile(outPath);
  console.log(`  ✓ icon-${size}.png`);
}

console.log(`\n✅ 4 icons generated in ${OUT_DIR}`);
