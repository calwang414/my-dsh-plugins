import { defineConfig } from 'vite'

// dsh Client bundle:__ModuleLoader__.load 格式(CJS 包裹),react 与官方图标库走平台模块。
// 注意:vite 8(rolldown)不再应用 rollupOptions.output.banner/footer,
// 因此用插件在 generateBundle 阶段注入 __ModuleLoader__.load 包裹。

const BANNER = 'window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-voice-pet", factory: (require) => { var module = { exports: {} }; var exports = module.exports;'
const FOOTER = '; return module.exports; } })'

function moduleLoaderWrap() {
  return {
    name: 'module-loader-wrap',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk') file.code = BANNER + file.code + FOOTER
      }
    },
  }
}

export default defineConfig({
  plugins: [moduleLoaderWrap()],
  build: {
    lib: {
      entry: 'src/client/index.js',
      formats: ['cjs'],
      fileName: () => 'client.js',
    },
    outDir: 'dist',
    // 主构建与 standalone 构建共用 dist/,不互相清空
    emptyOutDir: false,
    sourcemap: false,
    minify: false,
    rollupOptions: {
      external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
    },
    rolldownOptions: {
      external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
    },
  },
})
