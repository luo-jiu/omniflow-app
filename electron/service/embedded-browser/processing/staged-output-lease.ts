import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

export type StagedOutputLeaseState = 'staged' | 'claimed'

export type StagedOutputLeaseMetadata = {
  fileName: string
  mimeType?: string
  purpose: string
  sizeBytes: number
}

export type StagedOutputLeaseSnapshot = {
  createdAt: number
  expiresAt: number
  fileName: string
  lastActivityAt: number
  leaseId: string
  mimeType?: string
  ownerTaskId: string
  purpose: string
  sizeBytes: number
  state: StagedOutputLeaseState
}

export type StagedOutputLeaseHandle = {
  leaseId: string
  metadata: StagedOutputLeaseMetadata
  path: string
}

export type StagedOutputLeaseClaim = {
  claimId: string
  leaseId: string
  metadata: StagedOutputLeaseMetadata
}

type StagedOutputLeaseRecord = StagedOutputLeaseSnapshot & {
  claimId?: string
  path: string
}

export type StagedOutputLeaseStoreOptions = {
  now?: () => number
  rootPath: string
  ttlMs?: number
}

const DEFAULT_TTL_MS = 30 * 60 * 1000

function normalizeText(value: unknown, fallback: string) {
  return String(value ?? '').trim() || fallback
}

function normalizeTtl(value: unknown) {
  const normalized = Number(value)
  return Number.isFinite(normalized) && normalized > 0 ? normalized : DEFAULT_TTL_MS
}

function normalizeSize(value: unknown) {
  const normalized = Number(value)
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : 0
}

function sanitizeFileName(value: unknown) {
  const normalized = Array.from(String(value ?? ''), (character) => {
    const code = character.charCodeAt(0)
    return character === '/' || character === '\\' || code < 0x20 ? '_' : character
  }).join('').trim()
  return normalized || 'output'
}

/** Main-only owner for temporary output paths and one delivery claim. */
export class StagedOutputLeaseStore {
  private readonly now: () => number

  private readonly rootPath: string

  private readonly ttlMs: number

  private readonly leases = new Map<string, StagedOutputLeaseRecord>()

  constructor(options: StagedOutputLeaseStoreOptions) {
    this.now = options.now || Date.now
    this.rootPath = path.resolve(String(options.rootPath || '').trim())
    if (!String(options.rootPath || '').trim() || this.rootPath === path.parse(this.rootPath).root) {
      throw new Error('staged output lease rootPath 无效')
    }
    this.ttlMs = normalizeTtl(options.ttlMs)
  }

  async create(input: {
    fileName?: string
    mimeType?: string
    ownerTaskId: string
    purpose: string
    sizeBytes?: number
    ttlMs?: number
  }): Promise<StagedOutputLeaseHandle> {
    const ownerTaskId = normalizeText(input.ownerTaskId, '')
    const purpose = normalizeText(input.purpose, '')
    if (!ownerTaskId || !purpose) {
      throw new Error('staged output lease 缺少 ownerTaskId 或 purpose')
    }
    const leaseId = `output-lease-${randomUUID()}`
    const fileName = sanitizeFileName(input.fileName)
    const leasePath = path.join(this.rootPath, leaseId, fileName)
    const createdAt = this.now()
    const metadata: StagedOutputLeaseMetadata = {
      fileName,
      mimeType: normalizeText(input.mimeType, '') || undefined,
      purpose,
      sizeBytes: normalizeSize(input.sizeBytes),
    }
    await mkdir(path.dirname(leasePath), { recursive: true })
    this.leases.set(leaseId, {
      ...metadata,
      createdAt,
      expiresAt: createdAt + normalizeTtl(input.ttlMs ?? this.ttlMs),
      lastActivityAt: createdAt,
      leaseId,
      ownerTaskId,
      path: leasePath,
      state: 'staged',
    })
    return { leaseId, metadata, path: leasePath }
  }

  get(leaseId: string, ownerTaskId?: string) {
    const record = this.getRecord(leaseId, ownerTaskId)
    return record ? this.toSnapshot(record) : null
  }

  resolvePath(leaseId: string, ownerTaskId: string) {
    return this.getRecord(leaseId, ownerTaskId)?.path || null
  }

  claim(leaseId: string, deliveryId: string): StagedOutputLeaseClaim | null {
    const record = this.getRecord(leaseId)
    const normalizedDeliveryId = normalizeText(deliveryId, '')
    if (!record || record.expiresAt <= this.now() || record.state !== 'staged' || !normalizedDeliveryId) {
      return null
    }
    record.claimId = `output-claim-${randomUUID()}`
    record.state = 'claimed'
    record.lastActivityAt = this.now()
    record.expiresAt = record.lastActivityAt + this.ttlMs
    return {
      claimId: record.claimId,
      leaseId: record.leaseId,
      metadata: this.toMetadata(record),
    }
  }

  touch(leaseId: string, claimId?: string) {
    const record = this.getRecord(leaseId)
    if (!record || (record.state === 'claimed' && record.claimId !== claimId)) {
      return false
    }
    record.lastActivityAt = this.now()
    record.expiresAt = record.lastActivityAt + this.ttlMs
    return true
  }

  async release(leaseId: string, claimId?: string) {
    const record = this.getRecord(leaseId)
    if (!record || (record.state === 'claimed' && record.claimId !== claimId)) {
      return false
    }
    this.leases.delete(record.leaseId)
    await rm(path.dirname(record.path), { force: true, recursive: true }).catch(() => undefined)
    return true
  }

  async reapExpired() {
    const expired = Array.from(this.leases.values())
      .filter(record => record.expiresAt <= this.now())
    await Promise.all(expired.map(record => this.release(record.leaseId, record.claimId)))
    return expired.length
  }

  getSnapshot() {
    return Array.from(this.leases.values()).map(record => this.toSnapshot(record))
  }

  private getRecord(leaseId: string, ownerTaskId?: string) {
    const normalizedLeaseId = String(leaseId || '').trim()
    const record = normalizedLeaseId ? this.leases.get(normalizedLeaseId) : undefined
    if (!record || (ownerTaskId !== undefined && record.ownerTaskId !== ownerTaskId)) {
      return null
    }
    return record
  }

  private toMetadata(record: StagedOutputLeaseRecord): StagedOutputLeaseMetadata {
    return {
      fileName: record.fileName,
      mimeType: record.mimeType,
      purpose: record.purpose,
      sizeBytes: record.sizeBytes,
    }
  }

  private toSnapshot(record: StagedOutputLeaseRecord): StagedOutputLeaseSnapshot {
    return {
      ...this.toMetadata(record),
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      lastActivityAt: record.lastActivityAt,
      leaseId: record.leaseId,
      ownerTaskId: record.ownerTaskId,
      state: record.state,
    }
  }
}
