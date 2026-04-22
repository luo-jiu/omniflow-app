import { getEmbeddedBrowserSession } from './embeddedBrowserService'

export type EmbeddedBrowserCookie = {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
  expirationDate?: number
  session: boolean
}

export type EmbeddedBrowserCookieFilter = {
  domain?: string
  name?: string
  url?: string
  path?: string
}

function buildCookieRemoveUrl(cookie: EmbeddedBrowserCookie): string {
  const domain = cookie.domain.replace(/^\./, '')
  const scheme = cookie.secure ? 'https' : 'http'
  return `${scheme}://${domain}${cookie.path}`
}

function mapElectronCookie(raw: Electron.Cookie): EmbeddedBrowserCookie {
  return {
    name: raw.name,
    value: raw.value,
    domain: raw.domain ?? '',
    path: raw.path ?? '/',
    secure: raw.secure ?? false,
    httpOnly: raw.httpOnly ?? false,
    sameSite: raw.sameSite ?? 'unspecified',
    expirationDate: raw.expirationDate,
    session: raw.session ?? false,
  }
}

export async function getEmbeddedBrowserCookies(
  filter?: EmbeddedBrowserCookieFilter,
): Promise<EmbeddedBrowserCookie[]> {
  const browserSession = getEmbeddedBrowserSession()
  const raw = await browserSession.cookies.get(filter ?? {})
  return raw.map(mapElectronCookie)
}

export async function removeEmbeddedBrowserCookie(url: string, name: string): Promise<void> {
  const browserSession = getEmbeddedBrowserSession()
  await browserSession.cookies.remove(url, name)
}

export async function removeEmbeddedBrowserCookiesByDomain(domain: string): Promise<void> {
  const normalizedDomain = String(domain || '').trim()
  if (!normalizedDomain) {
    return
  }
  const cookies = await getEmbeddedBrowserCookies({ domain: normalizedDomain })
  for (const cookie of cookies) {
    await removeEmbeddedBrowserCookie(buildCookieRemoveUrl(cookie), cookie.name)
  }
}

export async function removeAllEmbeddedBrowserCookies(): Promise<void> {
  const cookies = await getEmbeddedBrowserCookies()
  for (const cookie of cookies) {
    await removeEmbeddedBrowserCookie(buildCookieRemoveUrl(cookie), cookie.name)
  }
  await getEmbeddedBrowserSession().cookies.flushStore()
}
