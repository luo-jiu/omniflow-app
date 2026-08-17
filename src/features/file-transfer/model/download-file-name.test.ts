import { describe, expect, it } from 'vitest'

import { normalizeDownloadFileName } from './download-file-name'

describe('normalizeDownloadFileName', () => {
  it('preserves normal and unicode file names', () => {
    expect(normalizeDownloadFileName('error-2026-03-11.txt')).toBe('error-2026-03-11.txt')
    expect(normalizeDownloadFileName('桂林图片.png')).toBe('桂林图片.png')
  })

  it('replaces path separators and Windows-invalid characters', () => {
    expect(normalizeDownloadFileName('../bad:name?.txt')).toBe('.._bad_name_.txt')
  })

  it('normalizes Windows reserved names and trailing dots', () => {
    expect(normalizeDownloadFileName('CON.txt')).toBe('_CON.txt')
    expect(normalizeDownloadFileName('aux')).toBe('_aux')
    expect(normalizeDownloadFileName('report... ')).toBe('report')
  })

  it('falls back when normalization removes the whole name', () => {
    expect(normalizeDownloadFileName('...')).toBe('file')
    expect(normalizeDownloadFileName('   ')).toBe('file')
  })
})
