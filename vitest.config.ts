import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', include: ['shared/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'cli', include: ['cli/**/*.test.ts'], environment: 'node' } },
    ],
  },
})
