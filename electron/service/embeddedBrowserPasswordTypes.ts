export type EmbeddedBrowserSavedPassword = {
  id: string
  domain: string
  username: string
  encryptedPassword: string
  pageUrl: string
  createdAt: number
  updatedAt: number
}

export type EmbeddedBrowserSavedPasswordEntry = {
  id: string
  domain: string
  username: string
  pageUrl: string
  createdAt: number
  updatedAt: number
}

export type EmbeddedBrowserPasswordStore = {
  passwords: EmbeddedBrowserSavedPassword[]
  blacklistedDomains: string[]
}

export type EmbeddedBrowserCapturedCredential = {
  domain: string
  username: string
  password: string
  pageUrl: string
  tabId: string
}

export type EmbeddedBrowserCapturedCredentialEvent = {
  credentialRequestId: string
  domain: string
  username: string
  pageUrl: string
  tabId: string
}
