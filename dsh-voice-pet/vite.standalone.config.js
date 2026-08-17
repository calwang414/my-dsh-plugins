import { defineConfig } from 'vite'

// 独立页面 bundle:普通 IIFE(全局 DshVoicePet.mount),不依赖 dsh ModuleLoader。
export default defineConfig({
  build: {
    lib: {
      entry: 'src/client/standalone.js',
      formats: ['iife'],
      name: 'DshVoicePet',
      fileName: () => 'pet-standalone.js',
    },
    outDir: 'dist',
    // 主构建与 standalone 构建共用 dist/,不互相清空
    emptyOutDir: false,
    sourcemap: false,
    minify: false,
  },
})
