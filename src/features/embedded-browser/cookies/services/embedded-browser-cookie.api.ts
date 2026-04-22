function assertDesktopSupport() {
  if (!window.electronEmbeddedBrowser) {
    throw new Error('当前环境不支持浏览器 Cookie 管理')
  }
}

export type EmbeddedBrowserCookieDomainGroup = {
  domain: string
  cookieCount: number
  cookies: EmbeddedBrowserCookie[]
}

export async function fetchEmbeddedBrowserCookies(
  filter?: EmbeddedBrowserCookieFilter,
): Promise<EmbeddedBrowserCookie[]> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.getCookies(filter)
}

export async function removeEmbeddedBrowserCookie(
  url: string,
  name: string,
): Promise<void> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.removeCookie(url, name)
}

export async function removeEmbeddedBrowserCookiesByDomain(
  domain: string,
): Promise<void> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.removeCookiesByDomain(domain)
}

export async function removeAllEmbeddedBrowserCookies(): Promise<void> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.removeAllCookies()
}

export function groupCookiesByDomain(
  cookies: EmbeddedBrowserCookie[],
): EmbeddedBrowserCookieDomainGroup[] {
  const map = new Map<string, EmbeddedBrowserCookie[]>()
  for (const cookie of cookies) {
    const domain = cookie.domain.replace(/^\./, '')
    const list = map.get(domain)
    if (list) {
      list.push(cookie)
    } else {
      map.set(domain, [cookie])
    }
  }
  const groups: EmbeddedBrowserCookieDomainGroup[] = []
  for (const [domain, domainCookies] of map) {
    domainCookies.sort((a, b) => a.name.localeCompare(b.name))
    groups.push({ domain, cookieCount: domainCookies.length, cookies: domainCookies })
  }
  groups.sort((a, b) => a.domain.localeCompare(b.domain))
  return groups
}
