function assertDesktopSupport() {
  if (!window.electronEmbeddedBrowser) {
    throw new Error('当前环境不支持浏览器密码管理')
  }
}

export type EmbeddedBrowserPasswordDomainGroup = {
  domain: string
  passwordCount: number
  passwords: EmbeddedBrowserSavedPasswordEntry[]
}

export async function fetchSavedPasswords(): Promise<EmbeddedBrowserSavedPasswordEntry[]> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.listPasswords()
}

export async function getDecryptedPassword(id: string): Promise<string> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.getDecryptedPassword(id)
}

export async function saveCapturedCredential(
  credentialRequestId: string,
): Promise<EmbeddedBrowserSavedPasswordEntry> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.saveCapturedCredential(credentialRequestId)
}

export async function deleteSavedPassword(id: string): Promise<boolean> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.deletePassword(id)
}

export async function deleteAllSavedPasswords(): Promise<void> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.deleteAllPasswords()
}

export async function blacklistPasswordDomain(domain: string): Promise<void> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.blacklistDomain(domain)
}

export function subscribeCredentialCaptured(
  listener: (payload: EmbeddedBrowserCapturedCredentialEvent) => void,
): () => void {
  if (!window.electronEmbeddedBrowser) {
    return () => {}
  }
  return window.electronEmbeddedBrowser.onCredentialCaptured(listener)
}

export function groupPasswordsByDomain(
  entries: EmbeddedBrowserSavedPasswordEntry[],
): EmbeddedBrowserPasswordDomainGroup[] {
  const map = new Map<string, EmbeddedBrowserSavedPasswordEntry[]>()
  for (const entry of entries) {
    const domain = entry.domain
    const list = map.get(domain)
    if (list) {
      list.push(entry)
    } else {
      map.set(domain, [entry])
    }
  }
  const groups: EmbeddedBrowserPasswordDomainGroup[] = []
  for (const [domain, domainPasswords] of map) {
    domainPasswords.sort((a, b) => a.username.localeCompare(b.username))
    groups.push({ domain, passwordCount: domainPasswords.length, passwords: domainPasswords })
  }
  groups.sort((a, b) => a.domain.localeCompare(b.domain))
  return groups
}
