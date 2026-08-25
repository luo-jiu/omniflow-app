import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { TextDecoder } from 'node:util'

import type { JsonObject } from './types.ts'

export function sha256Bytes(input: string | Buffer): string {
  return `sha256:${createHash('sha256').update(input).digest('hex')}`
}

export function decodeUtf8Bytes(input: Uint8Array, source: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input)
  } catch {
    throw new Error(`${source} is not valid UTF-8`)
  }
}

export function readJsonObject(filePath: string): JsonObject {
  const value: unknown = JSON.parse(decodeUtf8Bytes(readFileSync(filePath), filePath))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${filePath} must contain a JSON object`)
  }
  return value as JsonObject
}

export function hashFile(filePath: string): string {
  return sha256Bytes(readFileSync(filePath))
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function getStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value
    : []
}
