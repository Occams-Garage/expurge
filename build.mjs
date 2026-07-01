import * as esbuild from 'esbuild';
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

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
  { entryPoints: ['src/options/index.ts'],    outfile: 'dist/options.js'    },
  { entryPoints: ['src/options/style.css'],   outfile: 'dist/options.css'   },
  { entryPoints: ['src/sidebar/index.ts'],    outfile: 'dist/sidebar.js'    },
  { entryPoints: ['src/sidebar/style.css'],   outfile: 'dist/sidebar.css'   },
];

function copyStatics() {
  // Strip "dist/" prefix from file paths — manifest lives inside dist/ so paths are relative to it.
  const manifest = readFileSync('manifest.json', 'utf8').replaceAll('"dist/', '"');
  writeFileSync('dist/manifest.json', manifest);
  copyFileSync('src/popup/index.html',   'dist/popup.html');
  copyFileSync('src/options/index.html', 'dist/options.html');
  copyFileSync('src/sidebar/index.html', 'dist/sidebar.html');
  // Self-hosted fonts: fonts.css is loaded by all three surfaces; its url()s resolve to
  // dist/fonts/*.woff2 (copied verbatim — not bundled, so esbuild never touches the woff2).
  copyFileSync('src/styles/fonts.css', 'dist/fonts.css');
  cpSync('src/styles/fonts', 'dist/fonts', { recursive: true });
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
