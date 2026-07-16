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
  },
  test: {
    globals: true,
    environment: 'node',
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
