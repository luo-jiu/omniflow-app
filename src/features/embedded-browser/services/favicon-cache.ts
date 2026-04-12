type FaviconCacheEntry = {
  dataUrl: string;
  updatedAt: number;
};

type FaviconCacheLookup = {
  ownerKey?: string | number | null;
  iconUrl?: string | null;
  pageUrl?: string | null;
};

const FAVICON_CACHE_STORAGE_PREFIX = 'embedded-browser:favicon-cache:';
const FAVICON_CACHE_MAX_ENTRIES = 180;
const FAVICON_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

const faviconEntryMemoryCache = new Map<string, FaviconCacheEntry | null>();

function isPersistableFaviconDataUrl(rawValue?: string | null): rawValue is string {
  const value = String(rawValue || '').trim();
  return value.startsWith('data:image/');
}

function normalizeUrlWithoutHash(rawValue?: string | null) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return '';
  }
  try {
    const next = new URL(value);
    next.hash = '';
    return next.toString();
  } catch {
    return '';
  }
}

function normalizePageOrigin(rawValue?: string | null) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return '';
  }
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function normalizeOwnerKey(rawValue?: string | number | null) {
  const value = String(rawValue || '').trim();
  return value ? `owner:${value}` : '';
}

function buildLookupKeys({ ownerKey, iconUrl, pageUrl }: FaviconCacheLookup) {
  const keys: string[] = [];
  const pushKey = (value: string) => {
    if (value && !keys.includes(value)) {
      keys.push(value);
    }
  };

  const normalizedOwnerKey = normalizeOwnerKey(ownerKey);
  if (!normalizedOwnerKey) {
    return keys;
  }
  const normalizedIconUrl = normalizeUrlWithoutHash(iconUrl);
  const normalizedPageUrl = normalizeUrlWithoutHash(pageUrl);
  const normalizedPageOrigin = normalizePageOrigin(pageUrl);

  pushKey(normalizedIconUrl ? `${normalizedOwnerKey}:icon:${normalizedIconUrl}` : '');
  pushKey(normalizedPageUrl ? `${normalizedOwnerKey}:page:${normalizedPageUrl}` : '');
  pushKey(normalizedPageOrigin ? `${normalizedOwnerKey}:origin:${normalizedPageOrigin}` : '');

  return keys;
}

function getStorageKey(cacheKey: string) {
  return `${FAVICON_CACHE_STORAGE_PREFIX}${cacheKey}`;
}

function isEntryExpired(entry: FaviconCacheEntry) {
  return !entry.updatedAt || Date.now() - entry.updatedAt > FAVICON_CACHE_MAX_AGE_MS;
}

function parseFaviconCacheEntry(rawValue: string | null): FaviconCacheEntry | null {
  if (!rawValue) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawValue) as FaviconCacheEntry;
    if (!isPersistableFaviconDataUrl(parsed?.dataUrl) || typeof parsed?.updatedAt !== 'number') {
      return null;
    }
    if (isEntryExpired(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function readFaviconCacheEntry(cacheKey: string) {
  if (faviconEntryMemoryCache.has(cacheKey)) {
    return faviconEntryMemoryCache.get(cacheKey) ?? null;
  }

  const storageKey = getStorageKey(cacheKey);
  const entry = parseFaviconCacheEntry(localStorage.getItem(storageKey));
  if (!entry) {
    faviconEntryMemoryCache.set(cacheKey, null);
    localStorage.removeItem(storageKey);
    return null;
  }
  faviconEntryMemoryCache.set(cacheKey, entry);
  return entry;
}

function writeFaviconCacheEntry(cacheKey: string, entry: FaviconCacheEntry) {
  const storageKey = getStorageKey(cacheKey);
  faviconEntryMemoryCache.set(cacheKey, entry);
  localStorage.setItem(storageKey, JSON.stringify(entry));
}

function trimFaviconCache() {
  const collected: Array<{ cacheKey: string; updatedAt: number }> = [];

  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const storageKey = localStorage.key(index);
    if (!storageKey?.startsWith(FAVICON_CACHE_STORAGE_PREFIX)) {
      continue;
    }
    const cacheKey = storageKey.slice(FAVICON_CACHE_STORAGE_PREFIX.length);
    const entry = parseFaviconCacheEntry(localStorage.getItem(storageKey));
    if (!entry) {
      faviconEntryMemoryCache.delete(cacheKey);
      localStorage.removeItem(storageKey);
      continue;
    }
    faviconEntryMemoryCache.set(cacheKey, entry);
    collected.push({ cacheKey, updatedAt: entry.updatedAt });
  }

  if (collected.length <= FAVICON_CACHE_MAX_ENTRIES) {
    return;
  }

  collected
    .sort((left, right) => left.updatedAt - right.updatedAt)
    .slice(0, collected.length - FAVICON_CACHE_MAX_ENTRIES)
    .forEach(({ cacheKey }) => {
      faviconEntryMemoryCache.delete(cacheKey);
      localStorage.removeItem(getStorageKey(cacheKey));
    });
}

export function getCachedFaviconDataUrl(lookup: FaviconCacheLookup) {
  const keys = buildLookupKeys(lookup);
  for (const cacheKey of keys) {
    const entry = readFaviconCacheEntry(cacheKey);
    if (entry?.dataUrl) {
      return entry.dataUrl;
    }
  }
  return '';
}

export function cacheResolvedFaviconDataUrl(
  lookup: FaviconCacheLookup & { dataUrl?: string | null },
) {
  if (!isPersistableFaviconDataUrl(lookup.dataUrl)) {
    return;
  }
  const cacheKeys = buildLookupKeys(lookup);
  if (!cacheKeys.length) {
    return;
  }

  const entry: FaviconCacheEntry = {
    dataUrl: lookup.dataUrl,
    updatedAt: Date.now(),
  };

  try {
    cacheKeys.forEach((cacheKey) => {
      writeFaviconCacheEntry(cacheKey, entry);
    });
    trimFaviconCache();
  } catch {
    trimFaviconCache();
    try {
      cacheKeys.forEach((cacheKey) => {
        writeFaviconCacheEntry(cacheKey, entry);
      });
    } catch {
      // Ignore quota errors here and keep the in-memory render path working.
    }
  }
}
