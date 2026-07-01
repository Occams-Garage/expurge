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
          // jsdom over happy-dom: it materializes <iframe> elements inertly (no subresource
          // fetch, no throw), which the challenge-detection fixtures rely on.
          environment: 'jsdom',
          include: ['src/content/**/*.test.ts', 'src/options/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Scoped to the modules under test; widen as tiers land.
      include: [
        'src/shared/**',
        'src/background/coordinator.ts',
        'src/content/classify.ts',
        'src/options/aka-form.ts',
      ],
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
