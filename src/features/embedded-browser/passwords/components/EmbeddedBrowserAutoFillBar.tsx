import React from 'react'
import { Toast } from '@douyinfe/semi-ui'
import { IconClose } from '@douyinfe/semi-icons'
import styled from 'styled-components'
import { requestAutoFillPassword } from '../services/embedded-browser-password.api'

type EmbeddedBrowserAutoFillBarProps = {
  tabId: string
  filledUsername: string
  alternatives: Array<{ id: string; username: string }>
  onDismiss: () => void
  onUsernameFilled: (username: string) => void
}

const AUTO_DISMISS_MS = 5000

export default function EmbeddedBrowserAutoFillBar({
  tabId,
  filledUsername,
  alternatives,
  onDismiss,
  onUsernameFilled,
}: EmbeddedBrowserAutoFillBarProps) {
  const [switching, setSwitching] = React.useState(false)
  const autoDismissTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const interactedRef = React.useRef(false)

  React.useEffect(() => {
    if (interactedRef.current) {
      return
    }
    autoDismissTimerRef.current = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => {
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current)
      }
    }
  }, [onDismiss])

  const cancelAutoDismiss = React.useCallback(() => {
    interactedRef.current = true
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current)
      autoDismissTimerRef.current = null
    }
  }, [])

  const handleSwitch = React.useCallback(async (passwordId: string) => {
    cancelAutoDismiss()
    setSwitching(true)
    try {
      const result = await requestAutoFillPassword(tabId, passwordId)
      if (result) {
        onUsernameFilled(result.username)
      }
    } catch (err: any) {
      Toast.error(err?.message || '切换账号失败')
    } finally {
      setSwitching(false)
    }
  }, [tabId, cancelAutoDismiss, onUsernameFilled])

  const otherAccounts = alternatives.filter((a) => a.username !== filledUsername)

  return (
    <AutoFillBarContainer>
      <div className="autofill-bar-text">
        已自动填充 <strong>{filledUsername}</strong> 的密码
      </div>
      <div className="autofill-bar-actions">
        {otherAccounts.length > 0 ? (
          <select
            className="autofill-bar-select"
            value=""
            disabled={switching}
            onChange={(e) => {
              const passwordId = e.target.value
              if (passwordId) {
                void handleSwitch(passwordId)
              }
            }}
            onClick={cancelAutoDismiss}
          >
            <option value="" disabled>
              切换账号
            </option>
            {otherAccounts.map((alt) => (
              <option key={alt.id} value={alt.id}>
                {alt.username}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className="autofill-bar-btn-close"
          onClick={onDismiss}
          aria-label="关闭"
        >
          <IconClose size="small" />
        </button>
      </div>
    </AutoFillBarContainer>
  )
}

const AutoFillBarContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 48px;
  padding: 0 16px;
  background: var(--app-bg-elevated);
  border-bottom: 1px solid var(--app-border);
  flex-shrink: 0;

  .autofill-bar-text {
    font-size: 16px;
    color: var(--app-text);
    line-height: 1.4;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    strong {
      font-weight: 600;
    }
  }

  .autofill-bar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .autofill-bar-select {
    height: 32px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 16px;
    border: 1px solid var(--app-border);
    background: transparent;
    color: var(--app-text);
    cursor: pointer;
    outline: none;
    transition: border-color 0.15s;

    &:hover:not(:disabled) {
      border-color: var(--semi-color-primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .autofill-bar-btn-close {
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
    transition: background 0.15s, color 0.15s;

    &:hover {
      background: color-mix(in srgb, transparent 88%, var(--semi-color-fill-0) 12%);
      color: var(--app-text);
    }
  }
`
