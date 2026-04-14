import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

function normalizeBaseUrl(url: string): string {
  return String(url || '').replace(/\/+$/, '');
}

function resolveApiOrigins(mode: string): { apiOrigin: string; apiWsOrigin: string } {
  const env = loadEnv(mode, process.cwd(), '');
  const fallbackBaseUrl = 'http://localhost:8850/api';
  const baseUrl = normalizeBaseUrl(env.VITE_API_BASE_URL || fallbackBaseUrl);
  try {
    const parsed = new URL(baseUrl);
    const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return {
      apiOrigin: parsed.origin,
      apiWsOrigin: `${wsProtocol}//${parsed.host}`,
    };
  } catch {
    return {
      apiOrigin: 'http://localhost:8850',
      apiWsOrigin: 'ws://localhost:8850',
    };
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const { apiOrigin, apiWsOrigin } = resolveApiOrigins(mode);
  return {
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          build: {
            minify: false,
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 8080,
    host: '127.0.0.1',
    strictPort: true,
    headers: {
      'Content-Security-Policy':
        `default-src 'self'; connect-src 'self' ${apiOrigin} ${apiWsOrigin} http://localhost:9000 http://127.0.0.1:9000; img-src 'self' data: blob: http://localhost:9000 http://127.0.0.1:9000; media-src 'self' data: blob: http://localhost:9000 http://127.0.0.1:9000; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';`
    }
  },
}
})
