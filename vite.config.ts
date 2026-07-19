import { configDefaults, defineConfig } from 'vitest/config';

// Single config driving both `vite build` and `vitest`.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    // SSR/Node build: Vite externalizes node built-ins AND package.json
    // `dependencies`, so only our source is bundled. ESM out matches "type":"module".
    ssr: 'src/index.ts',
    rollupOptions: {
      // `bin` (dist/index.js) is exec'd by the kernel; without a shebang the OS runs
      // it under /bin/sh and `npx readability-mcp` dies parsing `import`.
      output: {
        banner: chunk => (chunk.isEntry ? '#!/usr/bin/env node' : ''),
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
