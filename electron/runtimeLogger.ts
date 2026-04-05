const ENABLE_RUNTIME_LOGS =
  process.env.NODE_ENV === 'test' ||
  Boolean(process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) ||
  process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === 'true';

type RuntimeLogLevel = 'debug' | 'info' | 'log' | 'warn' | 'error';

const print = (level: RuntimeLogLevel, ...args: unknown[]) => {
  if (!ENABLE_RUNTIME_LOGS) return;
  console[level](...args);
};

export const runtimeLogger = {
  debug: (...args: unknown[]) => print('debug', ...args),
  info: (...args: unknown[]) => print('info', ...args),
  log: (...args: unknown[]) => print('log', ...args),
  warn: (...args: unknown[]) => print('warn', ...args),
  error: (...args: unknown[]) => print('error', ...args),
};
