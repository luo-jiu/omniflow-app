const DEFAULT_API_BASE_URL = 'http://localhost:8850/api';

const envBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export const API_CONFIG = {
  BASE_URL: normalizeBaseUrl(envBaseUrl || DEFAULT_API_BASE_URL),
};
