const ENABLE_RUNTIME_LOGS =
  import.meta.env.DEV ||
  import.meta.env.MODE === 'test' ||
  import.meta.env.VITE_ENABLE_RUNTIME_LOGS === 'true';

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

export const isRuntimeLogEnabled = () => ENABLE_RUNTIME_LOGS;
