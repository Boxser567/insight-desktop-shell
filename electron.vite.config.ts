import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'
import { relaxRendererCspForDevelopment } from './src/renderer/development-csp'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          harness: resolve('src/preload/harness.ts'),
          shell: resolve('src/preload/shell.ts'),
          update: resolve('src/preload/update.ts'),
          'windows-menu': resolve('src/preload/windows-menu.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    plugins: [
      {
        name: 'insight-renderer-development-csp',
        apply: 'serve',
        transformIndexHtml: relaxRendererCspForDevelopment
      }
    ],
    esbuild: {
      jsx: 'automatic'
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          update: resolve('src/renderer/update.html')
        }
      }
    }
  }
})
