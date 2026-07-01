import { defineConfig } from 'vitest/config';

// Two projects: pure logic runs in a fast `node` env; DOM/overlay tests (added in a later
// phase) run in `happy-dom`. Coverage is configured once at the root and aggregates both.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/shared/**/*.test.ts', 'src/background/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['src/content/**/*.test.ts', 'src/options/**/*.test.ts'],
          // setupFiles: ['tests/setup/dom.ts'] — added with the first DOM test (Phase 3)
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Scoped to the modules under test; widen as tiers land.
      include: ['src/shared/**', 'src/background/coordinator.ts'],
      exclude: ['src/shared/types.ts', '**/*.test.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        // Sane floor everywhere covered…
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 80,
        // …crown-jewel rigor on the draft gate (wrong address mails PII) and opt-out output.
        'src/shared/gate.ts': { lines: 100, functions: 100, branches: 95 },
        'src/shared/templates.ts': { lines: 100, functions: 100, branches: 95 },
      },
    },
  },
});
