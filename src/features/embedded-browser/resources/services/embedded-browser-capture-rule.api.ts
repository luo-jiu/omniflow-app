import type {
  EmbeddedBrowserCaptureRegexRule,
  EmbeddedBrowserCaptureRuleSet,
} from '../model/embedded-browser-capture-rules'

function assertDesktopSupport() {
  if (!window.electronEmbeddedBrowser) {
    throw new Error('当前环境不支持浏览器捕获规则管理')
  }
}

export function createDefaultCaptureRegexRule(): EmbeddedBrowserCaptureRegexRule {
  return {
    blacklist: false,
    builtIn: false,
    enabled: true,
    ext: '',
    flags: 'ig',
    id: crypto.randomUUID(),
    label: '',
    pattern: '',
  }
}

export async function fetchEmbeddedBrowserResourceCaptureRules(): Promise<EmbeddedBrowserCaptureRuleSet> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.getResourceCaptureRules()
}

export async function updateEmbeddedBrowserResourceCaptureRules(
  ruleSet: EmbeddedBrowserCaptureRuleSet,
): Promise<EmbeddedBrowserCaptureRuleSet> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.updateResourceCaptureRules(ruleSet)
}

export async function resetEmbeddedBrowserResourceCaptureRules(): Promise<EmbeddedBrowserCaptureRuleSet> {
  assertDesktopSupport()
  return window.electronEmbeddedBrowser.resetResourceCaptureRules()
}

export function normalizeMultilineRuleInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}
