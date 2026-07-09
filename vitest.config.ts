import { defineConfig } from 'vitest/config';

// Single project so EVERY `src/**/*.test.ts` is discovered — no per-directory include
// allow-list to keep in sync (a test in an unlisted dir would silently run zero tests).
// Tests default to the fast `node` env; the two DOM suites opt into jsdom via a
// `// @vitest-environment jsdom` docblock. jsdom over happy-dom: it materializes <iframe>
// elements inertly (no subresource fetch), which the challenge-detection fixtures need.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Opt-out, not opt-in: every source file counts (coverage.all defaults true), so a
      // newly extracted+tested module is covered by default. The DOM/browser-bound
      // entrypoints (they run init()/addListener at import and aren't unit-tested yet) are
      // excluded EXPLICITLY below — visible here, not silently omitted from an include list.
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        'src/**/*.d.ts',
        'src/shared/types.ts', // type-only, no runtime
        'src/test-support/**', // shared test fixtures
        'src/background/index.ts', // entrypoint: message dispatch / storage I/O — integration-test TODO
        'src/background/tab-registry.ts', // polyfill-bound session-storage I/O wrappers — not node-testable
                                          //   (the pure resolvers in tab-registry-resolve.ts ARE covered)
        'src/background/dataset-store.ts', // polyfill/fetch/permissions I/O wrapper — not node-testable
                                           //   (the pure core in src/shared/dataset.ts IS covered)
        'src/content/index.ts', // entrypoint: headless challenge reporter (DOM observer) — integration-test TODO
        'src/options/index.ts', // entrypoint: form/nav wiring — integration-test TODO
        'src/popup/index.ts', // entrypoint: thin popup render — integration-test TODO
        'src/sidebar/index.ts', // entrypoint: sidebar render layer / message wiring — integration-test TODO
                                //   (its pure parts live in state.ts + paste.ts, which ARE covered)
      ],
      // The html tree is dev-only; CI never uploads it (coverage/ is gitignored).
      reporter: process.env['CI'] ? ['text'] : ['text', 'html'],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 80,
        // Crown-jewel rigor: the draft gate (a wrong address mails PII) + opt-out output.
        // NOTE: these keys are literal paths — if gate.ts/templates.ts are renamed/moved the
        // glob silently stops matching and the file drops to the global floor. Keep in sync.
        'src/shared/gate.ts': { statements: 100, lines: 100, functions: 100, branches: 95 },
        'src/shared/templates.ts': { statements: 100, lines: 100, functions: 100, branches: 95 },
      },
    },
  },
});
