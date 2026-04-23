import { copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Buffer } from 'node:buffer'

export type EmbeddedBrowserExtractedResourceSaveFile = {
  base64?: string
  fileName: string
  filePath?: string
}

function sanitizeFileName(input: string) {
  const normalized = String(input || '').trim().replace(/[\\/:*?"<>|]+/g, '_')
  return normalized || 'media'
}

export function deriveEmbeddedBrowserExtractedResourceOutputFileName(
  resourceFileName: string,
  suggestedFileName?: string,
) {
  const normalizedResourceName = sanitizeFileName(resourceFileName)
  const resourceExtension = path.extname(normalizedResourceName)
  const normalizedSuggestion = sanitizeFileName(suggestedFileName || '')
  if (!normalizedSuggestion || normalizedSuggestion === 'media') {
    return normalizedResourceName
  }

  const parsedSuggestion = path.parse(normalizedSuggestion)
  const outputExtension = parsedSuggestion.ext || resourceExtension
  return `${sanitizeFileName(parsedSuggestion.name || normalizedSuggestion)}${outputExtension}`
}

export async function saveEmbeddedBrowserExtractedResourceFile(
  resource: EmbeddedBrowserExtractedResourceSaveFile,
  outputPath: string,
) {
  if (resource.filePath) {
    await copyFile(resource.filePath, outputPath)
    return outputPath
  }
  if (!resource.base64) {
    throw new Error('缺少可保存的资源内容')
  }
  await writeFile(outputPath, Buffer.from(resource.base64, 'base64'))
  return outputPath
}
