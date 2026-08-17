const WINDOWS_RESERVED_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const INVALID_FILE_NAME_CHARACTERS = new Set('<>:"/\\|?*')

function replaceInvalidFileNameCharacters(fileName: string): string {
  return Array.from(fileName, character => (
    character.charCodeAt(0) < 32 || INVALID_FILE_NAME_CHARACTERS.has(character)
      ? '_'
      : character
  )).join('')
}

export function normalizeDownloadFileName(fileName: string): string {
  const normalized = replaceInvalidFileNameCharacters(String(fileName || 'file').normalize('NFC'))
    .trim()
    .replace(/[. ]+$/g, '')

  if (!normalized || normalized === '.' || normalized === '..') {
    return 'file'
  }
  if (WINDOWS_RESERVED_BASENAME.test(normalized)) {
    return `_${normalized}`
  }
  return normalized
}
