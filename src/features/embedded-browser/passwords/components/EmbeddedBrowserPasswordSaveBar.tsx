import React from 'react'
import { Toast } from '@douyinfe/semi-ui'
import { IconClose } from '@douyinfe/semi-icons'
import styled from 'styled-components'
import {
  blacklistPasswordDomain,
  saveCapturedCredential,
} from '../services/embedded-browser-password.api'

type EmbeddedBrowserPasswordSaveBarProps = {
  credentialRequestId: string
  domain: string
  username: string
  onDismiss: () => void
}

export default function EmbeddedBrowserPasswordSaveBar({
  credentialRequestId,
  domain,
  username,
  onDismiss,
}: EmbeddedBrowserPasswordSaveBarProps) {
  const [saving, setSaving] = React.useState(false)

  const handleSave = React.useCallback(async () => {
    setSaving(true)
    try {
      await saveCapturedCredential(credentialRequestId)
      Toast.success('密码已保存')
      onDismiss()
    } catch (err: any) {
      Toast.error(err?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }, [credentialRequestId, onDismiss])

  const handleBlacklist = React.useCallback(async () => {
    try {
      await blacklistPasswordDomain(domain)
      Toast.info(`不再提示保存 ${domain} 的密码`)
      onDismiss()
    } catch (err: any) {
      Toast.error(err?.message || '操作失败')
    }
  }, [domain, onDismiss])

  return (
    <SaveBarContainer>
      <div className="save-bar-text">
        要保存 <strong>{domain}</strong> 的密码吗？用户名：<strong>{username}</strong>
      </div>
      <div className="save-bar-actions">
        <button
          type="button"
          className="save-bar-btn save-bar-btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          保存
        </button>
        <button
          type="button"
          className="save-bar-btn save-bar-btn-secondary"
          onClick={handleBlacklist}
          disabled={saving}
        >
          不再提示
        </button>
        <button
          type="button"
          className="save-bar-btn-close"
          onClick={onDismiss}
          aria-label="关闭"
        >
          <IconClose size="small" />
        </button>
      </div>
    </SaveBarContainer>
  )
}

const SaveBarContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 48px;
  padding: 0 16px;
  background: var(--app-bg-elevated);
  border-bottom: 1px solid var(--app-border);
  flex-shrink: 0;

  .save-bar-text {
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

  .save-bar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .save-bar-btn {
    height: 32px;
    padding: 0 14px;
    border-radius: 6px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: background 0.15s, opacity 0.15s;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .save-bar-btn-primary {
    background: var(--semi-color-primary);
    color: #fff;

    &:hover:not(:disabled) {
      opacity: 0.85;
    }
  }

  .save-bar-btn-secondary {
    background: transparent;
    color: var(--app-text-muted);
    border: 1px solid var(--app-border);

    &:hover:not(:disabled) {
      border-color: var(--semi-color-primary);
      color: var(--semi-color-primary);
    }
  }

  .save-bar-btn-close {
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
