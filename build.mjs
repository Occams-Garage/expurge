import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const watch = process.argv.includes('--watch');

mkdirSync('dist', { recursive: true });

const common = {
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  sourcemap: watch ? 'inline' : false,
};

const entries = [
  { entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js' },
  { entryPoints: ['src/content/index.ts'],    outfile: 'dist/content.js'    },
  { entryPoints: ['src/popup/index.ts'],      outfile: 'dist/popup.js'      },
  { entryPoints: ['src/popup/style.css'],     outfile: 'dist/style.css'     },
];

function copyStatics() {
  // Strip "dist/" prefix from file paths — manifest lives inside dist/ so paths are relative to it.
  const manifest = readFileSync('manifest.json', 'utf8').replaceAll('"dist/', '"');
  writeFileSync('dist/manifest.json', manifest);
  copyFileSync('src/popup/index.html', 'dist/popup.html');
}

if (watch) {
  const ctxs = await Promise.all(entries.map(e => esbuild.context({ ...common, ...e })));
  copyStatics();
  await Promise.all(ctxs.map(c => c.watch()));
  console.log('[expurge] watching — ctrl-c to stop');
} else {
  await Promise.all(entries.map(e => esbuild.build({ ...common, ...e })));
  copyStatics();
  console.log('[expurge] build complete → dist/');
}
