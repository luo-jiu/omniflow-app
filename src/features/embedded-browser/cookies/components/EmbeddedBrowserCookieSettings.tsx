import React from 'react'
import { Input, Modal, Spin, Toast } from '@douyinfe/semi-ui'
import { IconArrowLeft, IconChevronDown, IconChevronRight, IconDelete, IconSearch } from '@douyinfe/semi-icons'
import styled from 'styled-components'
import {
  fetchEmbeddedBrowserCookies,
  groupCookiesByDomain,
  removeAllEmbeddedBrowserCookies,
  removeEmbeddedBrowserCookie,
  removeEmbeddedBrowserCookiesByDomain,
  type EmbeddedBrowserCookieDomainGroup,
} from '../services/embedded-browser-cookie.api'

type EmbeddedBrowserCookieSettingsProps = {
  onBack: () => void
}

function buildCookieRemoveUrl(cookie: EmbeddedBrowserCookie): string {
  const domain = cookie.domain.replace(/^\./, '')
  const scheme = cookie.secure ? 'https' : 'http'
  return `${scheme}://${domain}${cookie.path}`
}

function formatExpiration(cookie: EmbeddedBrowserCookie): string {
  if (cookie.session) {
    return '会话'
  }
  if (cookie.expirationDate == null) {
    return '会话'
  }
  const date = new Date(cookie.expirationDate * 1000)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function truncateValue(value: string, maxLength = 40): string {
  if (value.length <= maxLength) {
    return value
  }
  return value.slice(0, maxLength) + '…'
}

export default function EmbeddedBrowserCookieSettings({ onBack }: EmbeddedBrowserCookieSettingsProps) {
  const [groups, setGroups] = React.useState<EmbeddedBrowserCookieDomainGroup[]>([])
  const [loading, setLoading] = React.useState(true)
  const [searchText, setSearchText] = React.useState('')
  const [expandedDomains, setExpandedDomains] = React.useState<Set<string>>(new Set())
  const [detailCookie, setDetailCookie] = React.useState<EmbeddedBrowserCookie | null>(null)
  const [clearAllConfirmVisible, setClearAllConfirmVisible] = React.useState(false)
  const [operating, setOperating] = React.useState(false)

  const searchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = React.useState('')

  React.useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchText.trim().toLowerCase())
    }, 300)
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current)
      }
    }
  }, [searchText])

  const loadCookies = React.useCallback(async () => {
    setLoading(true)
    try {
      const cookies = await fetchEmbeddedBrowserCookies()
      setGroups(groupCookiesByDomain(cookies))
    } catch (err: any) {
      Toast.error(err?.message || 'Cookie 加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadCookies()
  }, [loadCookies])

  const filteredGroups = React.useMemo(() => {
    if (!debouncedSearch) {
      return groups
    }
    const result: EmbeddedBrowserCookieDomainGroup[] = []
    for (const group of groups) {
      if (group.domain.toLowerCase().includes(debouncedSearch)) {
        result.push(group)
        continue
      }
      const matchedCookies = group.cookies.filter(
        (c) => c.name.toLowerCase().includes(debouncedSearch),
      )
      if (matchedCookies.length > 0) {
        result.push({
          domain: group.domain,
          cookieCount: matchedCookies.length,
          cookies: matchedCookies,
        })
      }
    }
    return result
  }, [groups, debouncedSearch])

  const totalCookieCount = React.useMemo(
    () => groups.reduce((sum, g) => sum + g.cookieCount, 0),
    [groups],
  )

  const toggleDomain = React.useCallback((domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) {
        next.delete(domain)
      } else {
        next.add(domain)
      }
      return next
    })
  }, [])

  const handleRemoveDomain = React.useCallback(async (domain: string) => {
    setOperating(true)
    try {
      await removeEmbeddedBrowserCookiesByDomain(domain)
      Toast.success(`已清除 ${domain} 的所有 Cookie`)
      await loadCookies()
    } catch (err: any) {
      Toast.error(err?.message || '删除失败')
    } finally {
      setOperating(false)
    }
  }, [loadCookies])

  const handleRemoveSingleCookie = React.useCallback(async (cookie: EmbeddedBrowserCookie) => {
    setOperating(true)
    try {
      await removeEmbeddedBrowserCookie(buildCookieRemoveUrl(cookie), cookie.name)
      Toast.success(`已删除 Cookie: ${cookie.name}`)
      setDetailCookie(null)
      await loadCookies()
    } catch (err: any) {
      Toast.error(err?.message || '删除失败')
    } finally {
      setOperating(false)
    }
  }, [loadCookies])

  const handleClearAll = React.useCallback(async () => {
    setOperating(true)
    try {
      await removeAllEmbeddedBrowserCookies()
      Toast.success('已清除所有 Cookie')
      setClearAllConfirmVisible(false)
      setExpandedDomains(new Set())
      await loadCookies()
    } catch (err: any) {
      Toast.error(err?.message || '清除失败')
    } finally {
      setOperating(false)
    }
  }, [loadCookies])

  return (
    <CookieSettingsContainer>
      <div className="cookie-header">
        <div className="cookie-header-left">
          <button
            type="button"
            className="cookie-back-btn"
            onClick={onBack}
            aria-label="返回浏览器设置"
          >
            <IconArrowLeft size="large" />
          </button>
          <div className="cookie-header-title">Cookie 与站点数据</div>
          {!loading && (
            <span className="cookie-header-count">{totalCookieCount} 个 Cookie</span>
          )}
        </div>
        <button
          type="button"
          className="cookie-clear-all-btn"
          onClick={() => setClearAllConfirmVisible(true)}
          disabled={operating || totalCookieCount === 0}
        >
          清除所有 Cookie
        </button>
      </div>

      <div className="cookie-search">
        <Input
          prefix={<IconSearch />}
          placeholder="搜索域名或 Cookie 名称"
          value={searchText}
          onChange={(v) => setSearchText(v)}
          showClear
          size="large"
        />
      </div>

      <div className="cookie-list">
        {loading ? (
          <div className="cookie-empty">
            <Spin size="large" />
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="cookie-empty">
            <div className="cookie-empty-text">
              {debouncedSearch ? '没有匹配的 Cookie' : '暂无 Cookie 数据'}
            </div>
          </div>
        ) : (
          filteredGroups.map((group) => {
            const isExpanded = expandedDomains.has(group.domain)
            return (
              <div key={group.domain} className="cookie-domain-group">
                <div
                  className="cookie-domain-row"
                  onClick={() => toggleDomain(group.domain)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleDomain(group.domain)
                    }
                  }}
                >
                  <span className="cookie-domain-chevron">
                    {isExpanded ? <IconChevronDown size="small" /> : <IconChevronRight size="small" />}
                  </span>
                  <span className="cookie-domain-name">{group.domain}</span>
                  <span className="cookie-domain-count">{group.cookieCount} 个</span>
                  <button
                    type="button"
                    className="cookie-domain-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleRemoveDomain(group.domain)
                    }}
                    disabled={operating}
                    title={`清除 ${group.domain} 的所有 Cookie`}
                    aria-label={`清除 ${group.domain} 的所有 Cookie`}
                  >
                    <IconDelete size="small" />
                  </button>
                </div>
                {isExpanded && (
                  <div className="cookie-items">
                    {group.cookies.map((cookie, idx) => (
                      <div
                        key={`${cookie.name}-${cookie.path}-${idx}`}
                        className="cookie-item-row"
                        onClick={() => setDetailCookie(cookie)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setDetailCookie(cookie)
                          }
                        }}
                      >
                        <span className="cookie-item-name">{cookie.name}</span>
                        <span className="cookie-item-value">{truncateValue(cookie.value)}</span>
                        <span className="cookie-item-expires">{formatExpiration(cookie)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <Modal
        title="清除所有 Cookie"
        visible={clearAllConfirmVisible}
        onOk={handleClearAll}
        onCancel={() => setClearAllConfirmVisible(false)}
        confirmLoading={operating}
        okText="确定清除"
        okButtonProps={{ type: 'danger' } as any}
        cancelText="取消"
        maskClosable={false}
        centered
        width={480}
      >
        <p style={{ fontSize: 16, lineHeight: 1.6, margin: 0 }}>
          这将清除内置浏览器的所有 Cookie，可能导致已登录的站点需要重新登录。确定继续？
        </p>
      </Modal>

      <Modal
        title="Cookie 详情"
        visible={detailCookie !== null}
        onCancel={() => setDetailCookie(null)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="cookie-detail-delete-btn"
              onClick={() => detailCookie && handleRemoveSingleCookie(detailCookie)}
              disabled={operating}
            >
              删除此 Cookie
            </button>
          </div>
        }
        maskClosable
        centered
        width={560}
      >
        {detailCookie && (
          <div className="cookie-detail-grid">
            <DetailRow label="名称" value={detailCookie.name} />
            <DetailRow label="值" value={detailCookie.value} scrollable />
            <DetailRow label="域名" value={detailCookie.domain} />
            <DetailRow label="路径" value={detailCookie.path} />
            <DetailRow label="过期时间" value={formatExpiration(detailCookie)} />
            <DetailRow label="HttpOnly" value={detailCookie.httpOnly ? '是' : '否'} />
            <DetailRow label="Secure" value={detailCookie.secure ? '是' : '否'} />
            <DetailRow label="SameSite" value={detailCookie.sameSite} />
          </div>
        )}
      </Modal>
    </CookieSettingsContainer>
  )
}

function DetailRow({ label, value, scrollable }: { label: string; value: string; scrollable?: boolean }) {
  return (
    <div className="cookie-detail-row">
      <div className="cookie-detail-label">{label}</div>
      <div className={`cookie-detail-value${scrollable ? ' scrollable' : ''}`}>{value}</div>
    </div>
  )
}

const CookieSettingsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;

  .cookie-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
  }

  .cookie-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .cookie-back-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    color: var(--app-text);
    cursor: pointer;
    flex-shrink: 0;
    transition: border-color 0.15s;

    &:hover {
      border-color: var(--semi-color-primary);
    }
  }

  .cookie-header-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--app-text);
    line-height: 1.3;
    white-space: nowrap;
  }

  .cookie-header-count {
    font-size: 16px;
    color: var(--app-text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .cookie-clear-all-btn {
    height: 40px;
    padding: 0 18px;
    border-radius: 8px;
    border: 1px solid var(--semi-color-danger);
    background: transparent;
    color: var(--semi-color-danger);
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;

    &:hover:not(:disabled) {
      background: var(--semi-color-danger);
      color: #fff;
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  .cookie-search {
    flex-shrink: 0;

    .semi-input-wrapper {
      height: 40px;
      font-size: 16px;
      border-radius: 8px;
    }
  }

  .cookie-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    border: 1px solid var(--app-border);
    border-radius: 10px;
    background: var(--app-bg-elevated);
  }

  .cookie-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
  }

  .cookie-empty-text {
    font-size: 16px;
    color: var(--app-text-muted);
  }

  .cookie-domain-group {
    &:not(:last-child) {
      border-bottom: 1px solid var(--app-border);
    }
  }

  .cookie-domain-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    cursor: pointer;
    user-select: none;
    transition: background 0.1s;

    &:hover {
      background: color-mix(in srgb, var(--app-bg-elevated) 80%, var(--semi-color-fill-0) 20%);
    }
  }

  .cookie-domain-chevron {
    display: inline-flex;
    align-items: center;
    color: var(--app-text-muted);
    flex-shrink: 0;
  }

  .cookie-domain-name {
    font-size: 17px;
    font-weight: 600;
    color: var(--app-text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cookie-domain-count {
    font-size: 16px;
    color: var(--app-text-muted);
    flex-shrink: 0;
    margin-left: auto;
  }

  .cookie-domain-delete-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, background 0.15s;

    .cookie-domain-row:hover & {
      opacity: 1;
    }

    &:hover {
      color: var(--semi-color-danger);
      background: color-mix(in srgb, transparent 88%, var(--semi-color-danger) 12%);
    }

    &:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
  }

  .cookie-items {
    border-top: 1px solid var(--app-border);
    background: var(--app-bg);
  }

  .cookie-item-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px 10px 44px;
    cursor: pointer;
    transition: background 0.1s;

    &:hover {
      background: color-mix(in srgb, var(--app-bg) 80%, var(--semi-color-fill-0) 20%);
    }

    &:not(:last-child) {
      border-bottom: 1px solid color-mix(in srgb, var(--app-border) 50%, transparent 50%);
    }
  }

  .cookie-item-name {
    font-size: 16px;
    font-weight: 600;
    color: var(--app-text);
    min-width: 100px;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .cookie-item-value {
    font-size: 16px;
    color: var(--app-text-muted);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
  }

  .cookie-item-expires {
    font-size: 16px;
    color: var(--app-text-muted);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .cookie-detail-grid {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .cookie-detail-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .cookie-detail-label {
    font-size: 16px;
    font-weight: 600;
    color: var(--app-text-muted);
  }

  .cookie-detail-value {
    font-size: 16px;
    line-height: 1.5;
    color: var(--app-text);
    word-break: break-all;
    user-select: text;

    &.scrollable {
      max-height: 120px;
      overflow-y: auto;
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--app-bg);
      border: 1px solid var(--app-border);
      font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
      font-size: 15px;
    }
  }

  .cookie-detail-delete-btn {
    height: 40px;
    padding: 0 18px;
    border-radius: 8px;
    border: 1px solid var(--semi-color-danger);
    background: transparent;
    color: var(--semi-color-danger);
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;

    &:hover:not(:disabled) {
      background: var(--semi-color-danger);
      color: #fff;
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  @media (max-width: 1040px) {
    .cookie-header-title {
      font-size: 20px;
    }

    .cookie-item-row {
      padding-left: 36px;
    }

    .cookie-item-name {
      max-width: 140px;
    }
  }
`
