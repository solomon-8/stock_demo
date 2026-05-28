import { defineConfig } from 'vitest/config'

// 引擎是纯函数，node 环境即可，无需 jsdom。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    globals: true,
  },
})
