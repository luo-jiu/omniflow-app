import crypto from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { app, safeStorage, systemPreferences } from 'electron'
import { runtimeLogger } from '../runtimeLogger'
import type {
  EmbeddedBrowserCapturedCredential,
  EmbeddedBrowserPasswordStore,
  EmbeddedBrowserSavedPassword,
  EmbeddedBrowserSavedPasswordEntry,
} from './embeddedBrowserPasswordTypes'

const STORE_FILE_NAME = 'embedded-browser-passwords.json'
const CREDENTIAL_CACHE_TTL_MS = 60_000

let cachedStore: EmbeddedBrowserPasswordStore | null = null
const credentialCache = new Map<string, {
  credential: EmbeddedBrowserCapturedCredential
  timer: ReturnType<typeof setTimeout>
}>()

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE_NAME)
}

function loadPasswordStore(): EmbeddedBrowserPasswordStore {
  if (cachedStore) {
    return cachedStore
  }
  const storePath = getStorePath()
  if (!existsSync(storePath)) {
    cachedStore = { passwords: [], blacklistedDomains: [] }
    return cachedStore
  }
  try {
    const raw = readFileSync(storePath, 'utf-8')
    const parsed = JSON.parse(raw) as EmbeddedBrowserPasswordStore
    cachedStore = {
      passwords: Array.isArray(parsed.passwords) ? parsed.passwords : [],
      blacklistedDomains: Array.isArray(parsed.blacklistedDomains) ? parsed.blacklistedDomains : [],
    }
    return cachedStore
  } catch (error) {
    runtimeLogger.warn('embedded browser password store load failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    cachedStore = { passwords: [], blacklistedDomains: [] }
    return cachedStore
  }
}

function savePasswordStore(store: EmbeddedBrowserPasswordStore) {
  cachedStore = store
  const storePath = getStorePath()
  const storeDir = path.dirname(storePath)
  if (!existsSync(storeDir)) {
    mkdirSync(storeDir, { recursive: true })
  }
  writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8')
}

function toEntry(saved: EmbeddedBrowserSavedPassword): EmbeddedBrowserSavedPasswordEntry {
  return {
    id: saved.id,
    domain: saved.domain,
    username: saved.username,
    pageUrl: saved.pageUrl,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  }
}

export function listEmbeddedBrowserPasswords(): EmbeddedBrowserSavedPasswordEntry[] {
  const store = loadPasswordStore()
  return store.passwords.map(toEntry)
}

export function getEmbeddedBrowserPasswordsForDomain(domain: string): EmbeddedBrowserSavedPasswordEntry[] {
  const normalizedDomain = String(domain || '').trim().toLowerCase()
  if (!normalizedDomain) {
    return []
  }
  const store = loadPasswordStore()
  return store.passwords
    .filter((p) => p.domain === normalizedDomain)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(toEntry)
}

export function decryptEmbeddedBrowserPasswordForAutoFill(id: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return null
  }
  const store = loadPasswordStore()
  const entry = store.passwords.find((p) => p.id === id)
  if (!entry) {
    return null
  }
  try {
    const buffer = Buffer.from(entry.encryptedPassword, 'base64')
    return safeStorage.decryptString(buffer)
  } catch {
    return null
  }
}

export function hasEmbeddedBrowserMatchingPassword(domain: string, username: string): boolean {
  const normalizedDomain = String(domain || '').trim().toLowerCase()
  const normalizedUsername = String(username || '').trim()
  if (!normalizedDomain || !normalizedUsername) {
    return false
  }
  const store = loadPasswordStore()
  return store.passwords.some((p) => p.domain === normalizedDomain && p.username === normalizedUsername)
}

export function saveEmbeddedBrowserPassword(
  credential: EmbeddedBrowserCapturedCredential,
): EmbeddedBrowserSavedPasswordEntry {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统加密服务不可用，无法保存密码')
  }
  const store = loadPasswordStore()
  const encryptedPassword = safeStorage.encryptString(credential.password).toString('base64')
  const now = Date.now()
  const existing = store.passwords.find(
    (p) => p.domain === credential.domain && p.username === credential.username,
  )
  if (existing) {
    existing.encryptedPassword = encryptedPassword
    existing.pageUrl = credential.pageUrl
    existing.updatedAt = now
    savePasswordStore(store)
    return toEntry(existing)
  }
  const newEntry: EmbeddedBrowserSavedPassword = {
    id: crypto.randomUUID(),
    domain: credential.domain,
    username: credential.username,
    encryptedPassword,
    pageUrl: credential.pageUrl,
    createdAt: now,
    updatedAt: now,
  }
  store.passwords.push(newEntry)
  savePasswordStore(store)
  return toEntry(newEntry)
}

export function deleteEmbeddedBrowserPassword(id: string): boolean {
  const store = loadPasswordStore()
  const index = store.passwords.findIndex((p) => p.id === id)
  if (index === -1) {
    return false
  }
  store.passwords.splice(index, 1)
  savePasswordStore(store)
  return true
}

export function deleteAllEmbeddedBrowserPasswords(): void {
  const store = loadPasswordStore()
  store.passwords = []
  savePasswordStore(store)
}

export async function getEmbeddedBrowserDecryptedPassword(id: string): Promise<string> {
  if (process.platform === 'darwin') {
    await systemPreferences.promptTouchID('查看已保存的密码')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统加密服务不可用')
  }
  const store = loadPasswordStore()
  const entry = store.passwords.find((p) => p.id === id)
  if (!entry) {
    throw new Error('密码条目不存在')
  }
  const buffer = Buffer.from(entry.encryptedPassword, 'base64')
  return safeStorage.decryptString(buffer)
}

export function addEmbeddedBrowserBlacklistedDomain(domain: string): void {
  const normalizedDomain = String(domain || '').trim().toLowerCase()
  if (!normalizedDomain) {
    return
  }
  const store = loadPasswordStore()
  if (!store.blacklistedDomains.includes(normalizedDomain)) {
    store.blacklistedDomains.push(normalizedDomain)
    savePasswordStore(store)
  }
}

export function isEmbeddedBrowserBlacklistedDomain(domain: string): boolean {
  const normalizedDomain = String(domain || '').trim().toLowerCase()
  if (!normalizedDomain) {
    return false
  }
  const store = loadPasswordStore()
  return store.blacklistedDomains.includes(normalizedDomain)
}

export function cacheEmbeddedBrowserCredential(
  credential: EmbeddedBrowserCapturedCredential,
): string {
  const requestId = crypto.randomUUID()
  const timer = setTimeout(() => {
    credentialCache.delete(requestId)
  }, CREDENTIAL_CACHE_TTL_MS)
  credentialCache.set(requestId, { credential, timer })
  return requestId
}

export function consumeEmbeddedBrowserCachedCredential(
  requestId: string,
): EmbeddedBrowserCapturedCredential | null {
  const entry = credentialCache.get(requestId)
  if (!entry) {
    return null
  }
  clearTimeout(entry.timer)
  credentialCache.delete(requestId)
  return entry.credential
}
