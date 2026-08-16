import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

function normalizeBaseUrl(url: string): string {
  return String(url || '').replace(/\/+$/, '');
}

function parseHttpOrigins(value: string, variableName: string): string[] {
  return value
    .split(/[\s,]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const parsed = new URL(item);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`${variableName} only accepts http(s) origins: ${item}`);
      }
      return parsed.origin;
    });
}

function resolveNetworkOrigins(mode: string): {
  apiOrigin: string;
  apiWsOrigin: string;
  connectSources: string;
} {
  const env = loadEnv(mode, process.cwd(), '');
  const fallbackBaseUrl = 'http://127.0.0.1:8850/api';
  const baseUrl = normalizeBaseUrl(env.VITE_API_BASE_URL || fallbackBaseUrl);
  const storageOrigins = parseHttpOrigins(
    env.VITE_STORAGE_ORIGINS || 'http://localhost:9000 http://127.0.0.1:9000',
    'VITE_STORAGE_ORIGINS',
  );
  try {
    const parsed = new URL(baseUrl);
    const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    const apiOrigin = parsed.origin;
    const apiWsOrigin = `${wsProtocol}//${parsed.host}`;
    return {
      apiOrigin,
      apiWsOrigin,
      connectSources: Array.from(new Set([
        apiOrigin,
        apiWsOrigin,
        'http://localhost:9000',
        'http://127.0.0.1:9000',
        ...storageOrigins,
      ])).join(' '),
    };
  } catch {
    return {
      apiOrigin: 'http://127.0.0.1:8850',
      apiWsOrigin: 'ws://127.0.0.1:8850',
      connectSources: Array.from(new Set([
        'http://127.0.0.1:8850',
        'ws://127.0.0.1:8850',
        'http://localhost:9000',
        'http://127.0.0.1:9000',
        ...storageOrigins,
      ])).join(' '),
    };
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const { connectSources } = resolveNetworkOrigins(mode);
  const env = loadEnv(mode, process.cwd(), '');
  const updateBaseUrl = normalizeBaseUrl(
    process.env.VITE_UPDATE_BASE_URL || env.VITE_UPDATE_BASE_URL || '',
  );
  return {
  plugins: [
    {
      name: 'omniflow-csp-network-origins',
      transformIndexHtml(html) {
        return html.replaceAll('__OMNIFLOW_CSP_CONNECT_SOURCES__', connectSources);
      },
    },
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          define: {
            __OMNIFLOW_UPDATE_BASE_URL__: JSON.stringify(updateBaseUrl),
          },
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
    alias: [
      {
        find: /^react-dom$/,
        replacement: path.resolve(__dirname, 'src/utils/react-dom-compat.ts'),
      },
      {
        find: /^react-dom-actual$/,
        replacement: path.resolve(__dirname, 'node_modules/react-dom/index.js'),
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, 'src'),
      },
    ],
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        overlay: path.resolve(__dirname, 'overlay.html'),
      },
    },
  },
  server: {
    port: 8849,
    host: '127.0.0.1',
    strictPort: true,
    headers: {
      'Content-Security-Policy':
        `default-src 'self'; connect-src 'self' ${connectSources}; img-src 'self' data: blob: omniflow-preview: http://*:*; media-src 'self' data: blob: http://*:*; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';`
    }
  },
}
})
