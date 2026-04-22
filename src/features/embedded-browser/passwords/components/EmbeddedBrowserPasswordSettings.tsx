import React from 'react'
import { Input, Modal, Spin, Toast } from '@douyinfe/semi-ui'
import { IconArrowLeft, IconChevronDown, IconChevronRight, IconDelete, IconSearch } from '@douyinfe/semi-icons'
import styled from 'styled-components'
import {
  deleteAllSavedPasswords,
  deleteSavedPassword,
  fetchSavedPasswords,
  getDecryptedPassword,
  groupPasswordsByDomain,
  type EmbeddedBrowserPasswordDomainGroup,
} from '../services/embedded-browser-password.api'

type EmbeddedBrowserPasswordSettingsProps = {
  onBack: () => void
}

export default function EmbeddedBrowserPasswordSettings({ onBack }: EmbeddedBrowserPasswordSettingsProps) {
  const [groups, setGroups] = React.useState<EmbeddedBrowserPasswordDomainGroup[]>([])
  const [loading, setLoading] = React.useState(true)
  const [searchText, setSearchText] = React.useState('')
  const [expandedDomains, setExpandedDomains] = React.useState<Set<string>>(new Set())
  const [clearAllConfirmVisible, setClearAllConfirmVisible] = React.useState(false)
  const [operating, setOperating] = React.useState(false)
  const [revealedPasswords, setRevealedPasswords] = React.useState<Map<string, string>>(new Map())
  const revealTimersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

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

  React.useEffect(() => {
    const timers = revealTimersRef.current
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
    }
  }, [])

  const loadPasswords = React.useCallback(async () => {
    setLoading(true)
    try {
      const entries = await fetchSavedPasswords()
      setGroups(groupPasswordsByDomain(entries))
    } catch (err: any) {
      Toast.error(err?.message || '密码列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadPasswords()
  }, [loadPasswords])

  const filteredGroups = React.useMemo(() => {
    if (!debouncedSearch) {
      return groups
    }
    const result: EmbeddedBrowserPasswordDomainGroup[] = []
    for (const group of groups) {
      if (group.domain.toLowerCase().includes(debouncedSearch)) {
        result.push(group)
        continue
      }
      const matched = group.passwords.filter(
        (p) => p.username.toLowerCase().includes(debouncedSearch),
      )
      if (matched.length > 0) {
        result.push({
          domain: group.domain,
          passwordCount: matched.length,
          passwords: matched,
        })
      }
    }
    return result
  }, [groups, debouncedSearch])

  const totalCount = React.useMemo(
    () => groups.reduce((sum, g) => sum + g.passwordCount, 0),
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

  const handleDeletePassword = React.useCallback(async (id: string) => {
    setOperating(true)
    try {
      await deleteSavedPassword(id)
      Toast.success('已删除密码')
      setRevealedPasswords((prev) => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
      const timer = revealTimersRef.current.get(id)
      if (timer) {
        clearTimeout(timer)
        revealTimersRef.current.delete(id)
      }
      await loadPasswords()
    } catch (err: any) {
      Toast.error(err?.message || '删除失败')
    } finally {
      setOperating(false)
    }
  }, [loadPasswords])

  const handleDeleteDomain = React.useCallback(async (domain: string) => {
    const group = groups.find((g) => g.domain === domain)
    if (!group) return
    setOperating(true)
    try {
      for (const entry of group.passwords) {
        await deleteSavedPassword(entry.id)
      }
      Toast.success(`已删除 ${domain} 的所��密码`)
      await loadPasswords()
    } catch (err: any) {
      Toast.error(err?.message || '删除失败')
    } finally {
      setOperating(false)
    }
  }, [groups, loadPasswords])

  const handleClearAll = React.useCallback(async () => {
    setOperating(true)
    try {
      await deleteAllSavedPasswords()
      Toast.success('已清除所有密码')
      setClearAllConfirmVisible(false)
      setExpandedDomains(new Set())
      setRevealedPasswords(new Map())
      for (const timer of revealTimersRef.current.values()) {
        clearTimeout(timer)
      }
      revealTimersRef.current.clear()
      await loadPasswords()
    } catch (err: any) {
      Toast.error(err?.message || '清除失败')
    } finally {
      setOperating(false)
    }
  }, [loadPasswords])

  const handleRevealPassword = React.useCallback(async (id: string) => {
    if (revealedPasswords.has(id)) {
      setRevealedPasswords((prev) => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
      const timer = revealTimersRef.current.get(id)
      if (timer) {
        clearTimeout(timer)
        revealTimersRef.current.delete(id)
      }
      return
    }
    try {
      const plaintext = await getDecryptedPassword(id)
      setRevealedPasswords((prev) => new Map(prev).set(id, plaintext))
      const timer = setTimeout(() => {
        setRevealedPasswords((prev) => {
          const next = new Map(prev)
          next.delete(id)
          return next
        })
        revealTimersRef.current.delete(id)
      }, 10_000)
      revealTimersRef.current.set(id, timer)
    } catch (err: any) {
      const message = err?.message || '查看密码失败'
      if (message.includes('canceled') || message.includes('cancelled')) {
        return
      }
      Toast.error(message)
    }
  }, [revealedPasswords])

  return (
    <PasswordSettingsContainer>
      <div className="pwd-header">
        <div className="pwd-header-left">
          <button
            type="button"
            className="pwd-back-btn"
            onClick={onBack}
            aria-label="返回浏览器设置"
          >
            <IconArrowLeft size="large" />
          </button>
          <div className="pwd-header-title">密码管理</div>
          {!loading && (
            <span className="pwd-header-count">{totalCount} 个密码</span>
          )}
        </div>
        <button
          type="button"
          className="pwd-clear-all-btn"
          onClick={() => setClearAllConfirmVisible(true)}
          disabled={operating || totalCount === 0}
        >
          清除所有密码
        </button>
      </div>

      <div className="pwd-search">
        <Input
          prefix={<IconSearch />}
          placeholder="搜索域名或用户名"
          value={searchText}
          onChange={(v) => setSearchText(v)}
          showClear
          size="large"
        />
      </div>

      <div className="pwd-list">
        {loading ? (
          <div className="pwd-empty">
            <Spin size="large" />
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="pwd-empty">
            <div className="pwd-empty-text">
              {debouncedSearch ? '没有匹配的密码' : '暂无保存的密码'}
            </div>
          </div>
        ) : (
          filteredGroups.map((group) => {
            const isExpanded = expandedDomains.has(group.domain)
            return (
              <div key={group.domain} className="pwd-domain-group">
                <div
                  className="pwd-domain-row"
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
                  <span className="pwd-domain-chevron">
                    {isExpanded ? <IconChevronDown size="small" /> : <IconChevronRight size="small" />}
                  </span>
                  <span className="pwd-domain-name">{group.domain}</span>
                  <span className="pwd-domain-count">{group.passwordCount} 个</span>
                  <button
                    type="button"
                    className="pwd-domain-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDeleteDomain(group.domain)
                    }}
                    disabled={operating}
                    title={`删除 ${group.domain} 的所有密码`}
                    aria-label={`删除 ${group.domain} 的所有密码`}
                  >
                    <IconDelete size="small" />
                  </button>
                </div>
                {isExpanded && (
                  <div className="pwd-items">
                    {group.passwords.map((entry) => {
                      const revealed = revealedPasswords.get(entry.id)
                      return (
                        <div key={entry.id} className="pwd-item-row">
                          <span className="pwd-item-username">{entry.username}</span>
                          <span className="pwd-item-password">
                            {revealed != null ? revealed : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
                          </span>
                          <button
                            type="button"
                            className="pwd-item-reveal-btn"
                            onClick={() => handleRevealPassword(entry.id)}
                          >
                            {revealed != null ? '隐藏' : '查看'}
                          </button>
                          <button
                            type="button"
                            className="pwd-item-delete-btn"
                            onClick={() => handleDeletePassword(entry.id)}
                            disabled={operating}
                            title="删除此密码"
                            aria-label="删除此密码"
                          >
                            <IconDelete size="small" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <Modal
        title="清除所有密码"
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
          这将清除内置浏览器保存的所有密码。此操作无法撤销，确定继续？
        </p>
      </Modal>
    </PasswordSettingsContainer>
  )
}

const PasswordSettingsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;

  .pwd-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
  }

  .pwd-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .pwd-back-btn {
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

  .pwd-header-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--app-text);
    line-height: 1.3;
    white-space: nowrap;
  }

  .pwd-header-count {
    font-size: 16px;
    color: var(--app-text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .pwd-clear-all-btn {
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

  .pwd-search {
    flex-shrink: 0;

    .semi-input-wrapper {
      height: 40px;
      font-size: 16px;
      border-radius: 8px;
    }
  }

  .pwd-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    border: 1px solid var(--app-border);
    border-radius: 10px;
    background: var(--app-bg-elevated);
  }

  .pwd-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
  }

  .pwd-empty-text {
    font-size: 16px;
    color: var(--app-text-muted);
  }

  .pwd-domain-group {
    &:not(:last-child) {
      border-bottom: 1px solid var(--app-border);
    }
  }

  .pwd-domain-row {
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

  .pwd-domain-chevron {
    display: inline-flex;
    align-items: center;
    color: var(--app-text-muted);
    flex-shrink: 0;
  }

  .pwd-domain-name {
    font-size: 17px;
    font-weight: 600;
    color: var(--app-text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pwd-domain-count {
    font-size: 16px;
    color: var(--app-text-muted);
    flex-shrink: 0;
    margin-left: auto;
  }

  .pwd-domain-delete-btn {
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

    .pwd-domain-row:hover & {
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

  .pwd-items {
    border-top: 1px solid var(--app-border);
    background: var(--app-bg);
  }

  .pwd-item-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px 10px 44px;
    transition: background 0.1s;

    &:hover {
      background: color-mix(in srgb, var(--app-bg) 80%, var(--semi-color-fill-0) 20%);
    }

    &:not(:last-child) {
      border-bottom: 1px solid color-mix(in srgb, var(--app-border) 50%, transparent 50%);
    }
  }

  .pwd-item-username {
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

  .pwd-item-password {
    font-size: 16px;
    color: var(--app-text-muted);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
    user-select: text;
  }

  .pwd-item-reveal-btn {
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: transparent;
    color: var(--semi-color-primary);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
    transition: border-color 0.15s, background 0.15s;

    &:hover {
      border-color: var(--semi-color-primary);
      background: color-mix(in srgb, transparent 92%, var(--semi-color-primary) 8%);
    }
  }

  .pwd-item-delete-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, background 0.15s;

    .pwd-item-row:hover & {
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

  @media (max-width: 1040px) {
    .pwd-header-title {
      font-size: 20px;
    }

    .pwd-item-row {
      padding-left: 36px;
    }

    .pwd-item-username {
      max-width: 140px;
    }
  }
`
