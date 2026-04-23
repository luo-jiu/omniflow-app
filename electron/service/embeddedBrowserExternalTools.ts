import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { app, shell } from 'electron'

import { runtimeLogger } from '../runtimeLogger'
import type {
  EmbeddedBrowserExternalToolDispatchPayload,
  EmbeddedBrowserExternalToolKey,
  EmbeddedBrowserExternalToolOption,
  EmbeddedBrowserExternalToolSettings,
} from '../../src/features/embedded-browser/external-tools/model/embedded-browser-external-tools'
import {
  cloneEmbeddedBrowserExternalToolSettings,
  createDefaultEmbeddedBrowserExternalToolSettings,
  listEnabledEmbeddedBrowserExternalTools,
} from '../../src/features/embedded-browser/external-tools/model/embedded-browser-external-tools'

const STORE_FILE_NAME = 'embedded-browser-external-tools.json'

let cachedSettings: EmbeddedBrowserExternalToolSettings | null = null

function getExternalToolStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE_NAME)
}

function sanitizeLabel(value: string, fallback: string) {
  return String(value || '').trim() || fallback
}

function normalizeSettings(
  input?: Partial<EmbeddedBrowserExternalToolSettings> | null,
): EmbeddedBrowserExternalToolSettings {
  const defaults = createDefaultEmbeddedBrowserExternalToolSettings()
  return {
    aria2: {
      downloadDir: String(input?.aria2?.downloadDir || '').trim(),
      enabled: Boolean(input?.aria2?.enabled),
      label: sanitizeLabel(input?.aria2?.label || '', defaults.aria2.label),
      rpcUrl: String(input?.aria2?.rpcUrl || defaults.aria2.rpcUrl).trim(),
      secret: String(input?.aria2?.secret || '').trim(),
    },
    command: {
      enabled: Boolean(input?.command?.enabled),
      label: sanitizeLabel(input?.command?.label || '', defaults.command.label),
      template: String(input?.command?.template || defaults.command.template).trim(),
      workingDirectory: String(input?.command?.workingDirectory || '').trim(),
    },
    protocol: {
      enabled: Boolean(input?.protocol?.enabled),
      label: sanitizeLabel(input?.protocol?.label || '', defaults.protocol.label),
      urlTemplate: String(input?.protocol?.urlTemplate || defaults.protocol.urlTemplate).trim(),
    },
  }
}

function loadSettingsFromDisk(): EmbeddedBrowserExternalToolSettings {
  const storePath = getExternalToolStorePath()
  if (!existsSync(storePath)) {
    return createDefaultEmbeddedBrowserExternalToolSettings()
  }
  try {
    const raw = readFileSync(storePath, 'utf8')
    const parsed = JSON.parse(raw) as EmbeddedBrowserExternalToolSettings
    return normalizeSettings(parsed)
  } catch (error) {
    runtimeLogger.warn('embedded browser external tool settings load failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return createDefaultEmbeddedBrowserExternalToolSettings()
  }
}

function persistSettings(settings: EmbeddedBrowserExternalToolSettings) {
  const storePath = getExternalToolStorePath()
  const directoryPath = path.dirname(storePath)
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true })
  }
  writeFileSync(storePath, JSON.stringify(settings, null, 2), 'utf8')
}

function getSettings() {
  if (!cachedSettings) {
    cachedSettings = loadSettingsFromDisk()
  }
  return cloneEmbeddedBrowserExternalToolSettings(cachedSettings)
}

function resolveDownloadDirectory(preferredPath: string) {
  return String(preferredPath || '').trim() || path.join(os.homedir(), 'Downloads')
}

function deriveFileName(input: EmbeddedBrowserExternalToolDispatchPayload) {
  const explicit = String(input.fileName || '').trim()
  if (explicit) {
    return explicit
  }
  const title = String(input.title || '').trim().replace(/[\\/:*?"<>|]+/g, '_')
  if (title) {
    return title
  }
  try {
    const pathname = new URL(input.url).pathname
    const fileName = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim()
    if (fileName) {
      return fileName
    }
  } catch {
    // fall through
  }
  return 'captured-resource'
}

function buildDispatchContext(
  settings: EmbeddedBrowserExternalToolSettings,
  input: EmbeddedBrowserExternalToolDispatchPayload,
) {
  const headers = Object.fromEntries(
    Object.entries(input.headers || {}).filter(([headerName, headerValue]) => (
      Boolean(String(headerName || '').trim()) && Boolean(String(headerValue || '').trim())
    )),
  )
  const fileName = deriveFileName(input)
  const title = String(input.title || fileName).trim() || fileName
  const downloadDir = resolveDownloadDirectory(settings.aria2.downloadDir)
  const referer = String(input.referer || input.pageUrl || headers.referer || headers.Referer || '').trim()
  const cookie = String(headers.cookie || headers.Cookie || '').trim()
  const userAgent = String(headers['user-agent'] || headers['User-Agent'] || '').trim()
  const headerArgs = Object.entries(headers)
    .map(([headerName, headerValue]) => `--header "${headerName}: ${String(headerValue).replace(/"/g, '\\"')}"`)
    .join(' ')
    .trim()

  return {
    cookie,
    downloadDir,
    encodedUrl: encodeURIComponent(input.url),
    fileName,
    filename: fileName,
    headerArgs,
    headersJson: JSON.stringify(headers),
    mimeType: String(input.mimeType || '').trim(),
    pageUrl: String(input.pageUrl || '').trim(),
    referer,
    title,
    url: input.url,
    userAgent,
  }
}

function applyTemplate(template: string, context: Record<string, string>) {
  return String(template || '').replace(/\{([a-zA-Z0-9]+)\}/g, (_match, key) => context[key] ?? '')
}

async function dispatchToAria2(
  settings: EmbeddedBrowserExternalToolSettings,
  input: EmbeddedBrowserExternalToolDispatchPayload,
) {
  const rpcUrl = String(settings.aria2.rpcUrl || '').trim()
  if (!rpcUrl) {
    throw new Error('请先填写 aria2 RPC 地址')
  }
  const parsedUrl = new URL(rpcUrl)
  const transport = parsedUrl.protocol === 'https:' ? https : http
  const context = buildDispatchContext(settings, input)
  const params: unknown[] = []
  if (settings.aria2.secret) {
    params.push(`token:${settings.aria2.secret}`)
  }
  params.push([input.url])
  params.push({
    dir: context.downloadDir,
    header: Object.entries(input.headers || {}).map(([headerName, headerValue]) => `${headerName}: ${headerValue}`),
    out: context.fileName,
    referer: context.referer || undefined,
    'user-agent': context.userAgent || undefined,
  })

  const payload = JSON.stringify({
    id: `omniflow-${Date.now()}`,
    jsonrpc: '2.0',
    method: 'aria2.addUri',
    params,
  })

  await new Promise<void>((resolve, reject) => {
    const request = transport.request({
      headers: {
        'content-length': Buffer.byteLength(payload),
        'content-type': 'application/json',
      },
      hostname: parsedUrl.hostname,
      method: 'POST',
      path: `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`,
      port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
      protocol: parsedUrl.protocol,
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      response.on('end', () => {
        const responseText = Buffer.concat(chunks).toString('utf8')
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
          reject(new Error(`aria2 RPC 请求失败：HTTP ${response.statusCode || 0}`))
          return
        }
        try {
          const parsed = JSON.parse(responseText) as { error?: { message?: string } }
          if (parsed.error?.message) {
            reject(new Error(parsed.error.message))
            return
          }
        } catch {
          // allow non-json success payloads
        }
        resolve()
      })
    })
    request.on('error', reject)
    request.write(payload)
    request.end()
  })
}

async function dispatchToProtocol(
  settings: EmbeddedBrowserExternalToolSettings,
  input: EmbeddedBrowserExternalToolDispatchPayload,
) {
  const template = String(settings.protocol.urlTemplate || '').trim()
  if (!template) {
    throw new Error('请先填写 URL 协议模板')
  }
  const targetUrl = applyTemplate(template, buildDispatchContext(settings, input))
  if (!targetUrl) {
    throw new Error('URL 协议模板展开后为空')
  }
  await shell.openExternal(targetUrl)
}

async function dispatchToCommand(
  settings: EmbeddedBrowserExternalToolSettings,
  input: EmbeddedBrowserExternalToolDispatchPayload,
) {
  const template = String(settings.command.template || '').trim()
  if (!template) {
    throw new Error('请先填写命令模板')
  }
  const command = applyTemplate(template, buildDispatchContext(settings, input)).trim()
  if (!command) {
    throw new Error('命令模板展开后为空')
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      cwd: String(settings.command.workingDirectory || '').trim() || undefined,
      detached: true,
      shell: true,
      stdio: 'ignore',
      windowsHide: true,
    })

    let settled = false
    let timer: NodeJS.Timeout | null = null

    const cleanup = () => {
      child.removeAllListeners('error')
      child.removeAllListeners('exit')
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    const resolveLaunch = () => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve()
    }

    const rejectLaunch = (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      runtimeLogger.warn('embedded browser external command spawn failed', {
        command,
        error: error.message,
      })
      reject(error)
    }

    child.once('error', (error) => {
      rejectLaunch(error instanceof Error ? error : new Error(String(error)))
    })

    child.once('exit', (code, signal) => {
      if (settled) {
        return
      }
      if (typeof code === 'number' && code !== 0) {
        rejectLaunch(new Error(`本地命令启动失败，退出码 ${code}`))
        return
      }
      if (signal) {
        rejectLaunch(new Error(`本地命令启动失败，进程被 ${signal} 中断`))
        return
      }
      resolveLaunch()
    })

    child.unref()
    timer = setTimeout(() => {
      resolveLaunch()
    }, 800)
  })
}

export function listEmbeddedBrowserExternalToolSettings(): EmbeddedBrowserExternalToolSettings {
  return getSettings()
}

export function listEnabledEmbeddedBrowserExternalToolOptions(): EmbeddedBrowserExternalToolOption[] {
  return listEnabledEmbeddedBrowserExternalTools(getSettings())
}

export function updateEmbeddedBrowserExternalToolSettings(
  nextSettings: EmbeddedBrowserExternalToolSettings,
): EmbeddedBrowserExternalToolSettings {
  const normalizedSettings = normalizeSettings(nextSettings)
  cachedSettings = normalizedSettings
  persistSettings(normalizedSettings)
  return cloneEmbeddedBrowserExternalToolSettings(normalizedSettings)
}

export function resetEmbeddedBrowserExternalToolSettings(): EmbeddedBrowserExternalToolSettings {
  const defaults = createDefaultEmbeddedBrowserExternalToolSettings()
  cachedSettings = defaults
  persistSettings(defaults)
  return cloneEmbeddedBrowserExternalToolSettings(defaults)
}

export async function dispatchEmbeddedBrowserExternalTool(
  toolKey: EmbeddedBrowserExternalToolKey,
  payload: EmbeddedBrowserExternalToolDispatchPayload,
) {
  const settings = getSettings()
  if (!/^https?:\/\//i.test(String(payload.url || '').trim())) {
    throw new Error('只有 http(s) 资源可以发送到外部工具')
  }
  if (toolKey === 'aria2') {
    if (!settings.aria2.enabled) {
      throw new Error('aria2 RPC 尚未启用')
    }
    await dispatchToAria2(settings, payload)
    return
  }
  if (toolKey === 'protocol') {
    if (!settings.protocol.enabled) {
      throw new Error('URL 协议工具尚未启用')
    }
    await dispatchToProtocol(settings, payload)
    return
  }
  if (toolKey === 'command') {
    if (!settings.command.enabled) {
      throw new Error('本地命令工具尚未启用')
    }
    await dispatchToCommand(settings, payload)
    return
  }
  throw new Error('不支持的外部工具类型')
}
