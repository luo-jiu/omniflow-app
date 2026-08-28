export type EmbeddedBrowserCaptureRegexRule = {
  blacklist?: boolean
  builtIn: boolean
  enabled: boolean
  ext?: string
  flags: string
  id: string
  label: string
  pattern: string
}

export type EmbeddedBrowserCaptureRuleSet = {
  domainBlacklist: string[]
  domainWhitelist: string[]
  extensions: string[]
  mimeTypes: string[]
  regexRules: EmbeddedBrowserCaptureRegexRule[]
  version?: number
}
