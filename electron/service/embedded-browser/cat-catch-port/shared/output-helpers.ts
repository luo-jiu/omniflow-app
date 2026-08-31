/**
 * Output helpers ported from the pinned Cat Catch workflow.
 *
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/function.js#appendZero/getUrlFileName/ArrayBufferToBlob/
 *   stringModify/filterFileName; js/templates.js#Template
 * Reason: filename templates and large-buffer conversion are shared behavior,
 * while filesystem paths and renderer downloads remain platform adapters.
 * Adaptation: `downloadDataURL` is represented by a callback-free data URL
 * descriptor; no DOM or Electron side effect occurs in this pure port.
 * Fixtures: output.filename-template-parity, output.large-buffer-delivery
 */

const reFilterFileName = /[<>:"|?*~]/g
const ZERO_WIDTH_CHARACTERS = /[\u200B\u200C\u200D]/g

export type OutputTemplateData = Record<string, unknown> & {
  pageDOM?: {
    querySelector?: (selector: string) => { innerText?: string } | null
  }
  prompt?: (message: string, value: string) => string | null
  requestHeaders?: Record<string, string>
  url?: string
}

export type OutputDataUrlDownload = {
  fileName: string
  url: string
}

type TemplateTextNode = { type: 'text'; value: string }
type TemplateArgument = TemplateNode[] | TemplateTextNode
type TemplatePipeNode = { type: 'pipe'; name: string; args: TemplateArgument[] }
type TemplateTagNode = { type: 'tag'; varName: string; pipes: TemplatePipeNode[] }
type TemplateNode = TemplateTextNode | TemplateTagNode

export function appendZero(value: unknown) {
  const number = Number.parseInt(String(value), 10)
  return number < 10 ? `0${value}` : value
}

export function isEmpty(value: unknown) {
  return typeof value === 'undefined' || value === null || value === '' || value === ' '
}

export function getUrlFileName(url: string) {
  try {
    const pathname = new URL(url).pathname
    return pathname.split('/').pop() || 'NULL'
  } catch {
    return 'NULL'
  }
}

/** Match Cat Catch's filename replacement vocabulary, including its HTML-safe defaults. */
export function filterFileName(input: string, replacement?: string) {
  if (!input) return input
  let value = String(input).replace(ZERO_WIDTH_CHARACTERS, '')
  reFilterFileName.lastIndex = 0
  value = value.replace(reFilterFileName, match => replacement || ({
    '<': '&lt;',
    '>': '&gt;',
    ':': '&colon;',
    '"': '&quot;',
    '|': '&vert;',
    '?': '&quest;',
    '*': '&ast;',
    '~': '_',
  }[match] || match))
  if (value.endsWith('.')) value += 'catCatch'
  if (value.startsWith('.')) value = `catCatch${value}`
  return value
}

export function stringModify(input: string, replacement?: string) {
  if (!input) return input
  const value = filterFileName(input, replacement)
  return value.replace(/[\\/]/g, match => replacement || ({
    '\\': '&bsol;',
    '/': '&sol;',
  }[match] || match))
}

/** Convert bytes to a Blob while avoiding a single >1 GiB Blob part. */
export function arrayBufferToBlob(
  input: ArrayBuffer | ArrayBufferView | Blob,
  options?: BlobPropertyBag,
) {
  if (input instanceof Blob) return input
  const buffer = input instanceof ArrayBuffer
    ? input
    : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
  if (buffer.byteLength === 0) return new Blob([], options)
  const maxChunkSize = 1024 * 1024 * 1024
  if (buffer.byteLength < 2 * maxChunkSize) return new Blob([buffer], options)
  const blobs: Blob[] = []
  for (let offset = 0; offset < buffer.byteLength; offset += maxChunkSize) {
    blobs.push(new Blob([buffer.slice(offset, Math.min(offset + maxChunkSize, buffer.byteLength))]))
  }
  return new Blob(blobs, options)
}

export function createDataUrlDownload(url: string, fileName: string): OutputDataUrlDownload {
  return { fileName, url }
}

function splitTopLevel(value: string, separator: string) {
  const parts: string[] = []
  let start = 0
  let inDouble = false
  let inSingle = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '"' && !inSingle) inDouble = !inDouble
    else if (character === "'" && !inDouble) inSingle = !inSingle
    else if (character === separator && !inDouble && !inSingle) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}

function findTopLevelSeparator(value: string, separator: string) {
  let inDouble = false
  let inSingle = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '"' && !inSingle) inDouble = !inDouble
    else if (character === "'" && !inDouble) inSingle = !inSingle
    else if (character === separator && !inDouble && !inSingle) return index
  }
  return -1
}

function readBalanced(value: string, start: number) {
  let depth = 1
  let inDouble = false
  let inSingle = false
  let escaped = false
  let index = start
  while (index < value.length && depth > 0) {
    const character = value[index]
    index += 1
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '"' && !inSingle) inDouble = !inDouble
    else if (character === "'" && !inDouble) inSingle = !inSingle
    else if (!inDouble && !inSingle && character === '$' && value[index] === '{') {
      depth += 1
      index += 1
    } else if (!inDouble && !inSingle && character === '}') {
      depth -= 1
    }
  }
  return { content: value.slice(start, Math.max(start, index - 1)), end: index }
}

function parseTemplate(input: string): TemplateNode[] {
  const nodes: TemplateNode[] = []
  let index = 0
  while (index < input.length) {
    const tagStart = input.indexOf('${', index)
    if (tagStart === -1) {
      nodes.push({ type: 'text', value: input.slice(index) })
      break
    }
    if (tagStart > index) nodes.push({ type: 'text', value: input.slice(index, tagStart) })
    const balanced = readBalanced(input, tagStart + 2)
    const pipeIndex = findTopLevelSeparator(balanced.content, '|')
    const varName = (pipeIndex === -1 ? balanced.content : balanced.content.slice(0, pipeIndex)).trim()
    const pipes = pipeIndex === -1
      ? []
      : splitTopLevel(balanced.content.slice(pipeIndex + 1), '|').map(parsePipe)
    nodes.push({ type: 'tag', varName, pipes })
    index = balanced.end
  }
  return nodes
}

function parsePipe(input: string): TemplatePipeNode {
  const colonIndex = input.indexOf(':')
  const name = (colonIndex === -1 ? input : input.slice(0, colonIndex)).trim()
  const rawArgs = colonIndex === -1 ? '' : input.slice(colonIndex + 1).trim()
  const args: TemplateArgument[] = rawArgs
    ? splitTopLevel(rawArgs, ',').map((argument) => {
      const trimmed = argument.trim().replace(/^("|')([\s\S]*)\1$/, '$2')
      return trimmed.includes('${')
        ? parseTemplate(trimmed)
        : { type: 'text', value: trimmed } as TemplateTextNode
    })
    : []
  return { type: 'pipe', name, args }
}

function replaceEvery(source: string, search: string, replacement: string) {
  return search ? source.split(search).join(replacement) : source
}

function toBase64(value: string) {
  try {
    const encoded = encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_match, hex: string) => (
      String.fromCharCode(Number.parseInt(hex, 16))
    ))
    return typeof btoa === 'function' ? btoa(encoded) : value
  } catch {
    return value
  }
}

function resolveTemplateArg(arg: TemplateArgument, data: OutputTemplateData, trimData: Record<string, unknown>) {
  if (Array.isArray(arg)) return evaluateTemplate(arg, data, trimData)
  return arg.value
}

function evaluateTemplate(nodes: TemplateNode[], data: OutputTemplateData, trimData: Record<string, unknown>) {
  return nodes.map(node => node.type === 'text'
    ? node.value
    : evaluateTag(node, data, trimData)).join('')
}

function evaluateTag(tag: TemplateTagNode, data: OutputTemplateData, trimData: Record<string, unknown>) {
  let value: unknown
  if (tag.varName === 'data') {
    const { pageDOM, year, month, date, day, fullDate, time, hours, minutes, seconds, mobileUserAgent, ...rest } = trimData
    void pageDOM
    void year
    void month
    void date
    void day
    void fullDate
    void time
    void hours
    void minutes
    void seconds
    void mobileUserAgent
    value = JSON.stringify(rest)
  } else {
    value = data[tag.varName]
  }
  let current = value === undefined ? '' : String(value)
  if (tag.pipes.length === 0) return value === undefined ? `\${${tag.varName}}` : current

  for (const pipe of tag.pipes) {
    const resolvedArgs = pipe.args.map(arg => resolveTemplateArg(arg, data, trimData))
    if (isEmpty(current) && !['exists', 'find', 'prompt'].includes(pipe.name)) return ''
    if (resolvedArgs.length === 0 && !['filter', 'prompt'].includes(pipe.name)) break
    switch (pipe.name) {
      case 'slice': current = current.slice(...resolvedArgs.map(Number) as [number, number?]); break
      case 'replace': current = current.replace(resolvedArgs[0] || '', resolvedArgs[1] || ''); break
      case 'replaceAll': current = replaceEvery(current, resolvedArgs[0] || '', resolvedArgs[1] || ''); break
      case 'regexp': {
        const match = current.match(new RegExp(resolvedArgs[0] || '', resolvedArgs[1] || ''))
        current = match ? match.slice(1).filter(Boolean).map(item => item.trim()).join('') : ''
        break
      }
      case 'exists': current = current
        ? replaceEvery(String(resolvedArgs[0] || ''), '*', current)
        : replaceEvery(String(resolvedArgs[1] || ''), '*', current); break
      case 'prepend': current = `${resolvedArgs[0] || ''}${current}`; break
      case 'concat': current += resolvedArgs[0] || ''; break
      case 'filter': current = stringModify(current, resolvedArgs[0]); break
      case 'to': {
        switch (resolvedArgs[0]) {
          case 'base64': current = toBase64(current); break
          case 'urlEncode': current = encodeURIComponent(current); break
          case 'urlDecode': try { current = decodeURIComponent(current) } catch { /* keep source */ } break
          case 'lowerCase': current = current.toLowerCase(); break
          case 'upperCase': current = current.toUpperCase(); break
          case 'trim': current = current.trim(); break
          case 'filter': current = stringModify(current.trim()); break
          default: break
        }
        break
      }
      case 'find': {
        try { current = data.pageDOM?.querySelector?.(resolvedArgs[0] || '')?.innerText?.trim() || '' } catch { current = '' }
        break
      }
      case 'prompt': current = data.prompt?.('', current) || ''; break
      default: break
    }
  }
  return current
}

/** Shared class name used by the capability map and future platform adapters. */
export class OutputHelpers {
  static appendZero = appendZero
  static arrayBufferToBlob = arrayBufferToBlob
  static createDataUrlDownload = createDataUrlDownload
  static filterFileName = filterFileName
  static getUrlFileName = getUrlFileName
  static isEmpty = isEmpty
  static stringModify = stringModify

  static renderTemplate(template: string, input: OutputTemplateData = {}) {
    if (isEmpty(template)) return ''
    const data: OutputTemplateData = { ...input }
    const fullFileName = data.url ? getUrlFileName(String(data.url)) : 'NULL'
    const fileNameParts = fullFileName.split('.')
    const fileName = fileNameParts.length > 1 ? fileNameParts.slice(0, -1).join('.') : fullFileName
    const ext = isEmpty(data.ext) && fileNameParts.length > 1
      ? fileNameParts[fileNameParts.length - 1]
      : data.ext
    const date = new Date()
    const trimData: Record<string, unknown> = {
      url: data.url ?? '',
      referer: data.requestHeaders?.referer ?? '',
      origin: data.requestHeaders?.origin ?? '',
      initiator: data.requestHeaders?.referer || data.initiator,
      webUrl: data.webUrl ?? '',
      title: String(data._title || data.title || 'NULL').replace(/[/\\]/g, '_'),
      pageDOM: data.pageDOM,
      cookie: data.cookie ?? '',
      tabId: data.tabId ?? 0,
      year: date.getFullYear(),
      month: appendZero(date.getMonth() + 1),
      date: appendZero(date.getDate()),
      day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()],
      fullDate: `${date.getFullYear()}-${appendZero(date.getMonth() + 1)}-${appendZero(date.getDate())}`,
      time: `${appendZero(date.getHours())}'${appendZero(date.getMinutes())}'${appendZero(date.getSeconds())}`,
      hours: appendZero(date.getHours()),
      minutes: appendZero(date.getMinutes()),
      seconds: appendZero(date.getSeconds()),
      now: Date.now(),
      timestamp: date.toISOString(),
      fullFileName,
      fileName,
      ext: ext ?? '',
      mobileUserAgent: data.mobileUserAgent ?? '',
      userAgent: data.userAgent ?? '',
    }
    return evaluateTemplate(parseTemplate(String(template)), { ...data, ...trimData }, trimData)
  }
}

export const renderOutputTemplate = OutputHelpers.renderTemplate
