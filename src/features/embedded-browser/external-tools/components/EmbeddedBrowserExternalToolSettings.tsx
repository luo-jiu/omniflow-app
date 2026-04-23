import React from 'react'
import { Button, Input, Spin, Switch, TextArea, Toast } from '@douyinfe/semi-ui'
import { IconArrowLeft } from '@douyinfe/semi-icons'
import styled from 'styled-components'

import type { EmbeddedBrowserExternalToolSettings } from '../model/embedded-browser-external-tools'
import {
  fetchEmbeddedBrowserExternalToolSettings,
  resetEmbeddedBrowserExternalToolSettings,
  updateEmbeddedBrowserExternalToolSettings,
} from '../services/embedded-browser-external-tool.api'

type EmbeddedBrowserExternalToolSettingsProps = {
  onBack: () => void
}

function cloneSettings(settings: EmbeddedBrowserExternalToolSettings): EmbeddedBrowserExternalToolSettings {
  return {
    aria2: { ...settings.aria2 },
    command: { ...settings.command },
    protocol: { ...settings.protocol },
  }
}

function areSettingsEqual(
  left: EmbeddedBrowserExternalToolSettings | null,
  right: EmbeddedBrowserExternalToolSettings | null,
) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function normalizeDraft(settings: EmbeddedBrowserExternalToolSettings): EmbeddedBrowserExternalToolSettings {
  return {
    aria2: {
      ...settings.aria2,
      downloadDir: String(settings.aria2.downloadDir || '').trim(),
      label: String(settings.aria2.label || '').trim(),
      rpcUrl: String(settings.aria2.rpcUrl || '').trim(),
      secret: String(settings.aria2.secret || '').trim(),
    },
    command: {
      ...settings.command,
      label: String(settings.command.label || '').trim(),
      template: String(settings.command.template || '').trim(),
      workingDirectory: String(settings.command.workingDirectory || '').trim(),
    },
    protocol: {
      ...settings.protocol,
      label: String(settings.protocol.label || '').trim(),
      urlTemplate: String(settings.protocol.urlTemplate || '').trim(),
    },
  }
}

function validateSettings(settings: EmbeddedBrowserExternalToolSettings): string | null {
  if (settings.aria2.enabled && !settings.aria2.rpcUrl) {
    return '启用 aria2 RPC 前，先填写 RPC 地址'
  }
  if (settings.command.enabled && !settings.command.template) {
    return '启用本地命令前，先填写命令模板'
  }
  if (settings.protocol.enabled && !settings.protocol.urlTemplate) {
    return '启用 URL 协议前，先填写协议模板'
  }
  return null
}

export default function EmbeddedBrowserExternalToolSettings({
  onBack,
}: EmbeddedBrowserExternalToolSettingsProps) {
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)
  const [initialSettings, setInitialSettings] = React.useState<EmbeddedBrowserExternalToolSettings | null>(null)
  const [draftSettings, setDraftSettings] = React.useState<EmbeddedBrowserExternalToolSettings | null>(null)

  const loadSettings = React.useCallback(async () => {
    setLoading(true)
    try {
      const settings = await fetchEmbeddedBrowserExternalToolSettings()
      const cloned = cloneSettings(settings)
      setInitialSettings(cloned)
      setDraftSettings(cloneSettings(cloned))
    } catch (err: any) {
      Toast.error(err?.message || '外部工具配置加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const updateDraft = React.useCallback(
    (updater: (current: EmbeddedBrowserExternalToolSettings) => EmbeddedBrowserExternalToolSettings) => {
      setDraftSettings((current) => {
        if (!current) {
          return current
        }
        return updater(current)
      })
    },
    [],
  )

  const dirty = React.useMemo(
    () => !areSettingsEqual(initialSettings, draftSettings),
    [draftSettings, initialSettings],
  )

  const handleSave = React.useCallback(async () => {
    if (!draftSettings) {
      return
    }
    const normalizedDraft = normalizeDraft(draftSettings)
    const validationError = validateSettings(normalizedDraft)
    if (validationError) {
      Toast.error(validationError)
      return
    }
    setSaving(true)
    try {
      const nextSettings = await updateEmbeddedBrowserExternalToolSettings(normalizedDraft)
      const cloned = cloneSettings(nextSettings)
      setInitialSettings(cloned)
      setDraftSettings(cloneSettings(cloned))
      Toast.success('外部工具配置已保存')
    } catch (err: any) {
      Toast.error(err?.message || '外部工具配置保存失败')
    } finally {
      setSaving(false)
    }
  }, [draftSettings])

  const handleReset = React.useCallback(async () => {
    setResetting(true)
    try {
      const nextSettings = await resetEmbeddedBrowserExternalToolSettings()
      const cloned = cloneSettings(nextSettings)
      setInitialSettings(cloned)
      setDraftSettings(cloneSettings(cloned))
      Toast.success('已恢复默认外部工具配置')
    } catch (err: any) {
      Toast.error(err?.message || '恢复默认失败')
    } finally {
      setResetting(false)
    }
  }, [])

  return (
    <ExternalToolSettingsContainer>
      <div className="external-tool-header">
        <div className="external-tool-header-left">
          <button
            type="button"
            className="external-tool-back-btn"
            onClick={onBack}
            aria-label="返回浏览器设置"
          >
            <IconArrowLeft size="large" />
          </button>
          <div className="external-tool-header-title">外部工具</div>
          {!loading && draftSettings ? (
            <span className="external-tool-header-count">
              {[draftSettings.aria2, draftSettings.command, draftSettings.protocol].filter((item) => item.enabled).length} 个已启用
            </span>
          ) : null}
        </div>
        <div className="external-tool-header-actions">
          <Button
            size="large"
            type="tertiary"
            onClick={() => void handleReset()}
            disabled={loading || resetting}
            loading={resetting}
          >
            恢复默认
          </Button>
          <Button
            size="large"
            theme="solid"
            onClick={() => void handleSave()}
            loading={saving}
            disabled={loading || !dirty}
          >
            保存配置
          </Button>
        </div>
      </div>
      <div className="external-tool-description">
        这里先按猫抓的主出口收第一版：aria2 RPC、本地命令、URL 协议。资源卡里只展示已启用的工具。
      </div>
      {loading || !draftSettings ? (
        <div className="external-tool-loading">
          <Spin />
        </div>
      ) : (
        <div className="external-tool-sections">
          <section className="external-tool-section">
            <div className="external-tool-section-head">
              <div>
                <div className="external-tool-section-title">aria2 RPC</div>
                <div className="external-tool-section-subtitle">
                  把当前资源地址和请求头通过 JSON-RPC 发给本地 aria2。
                </div>
              </div>
              <Switch
                checked={draftSettings.aria2.enabled}
                onChange={(checked) => {
                  updateDraft((current) => ({
                    ...current,
                    aria2: {
                      ...current.aria2,
                      enabled: checked,
                    },
                  }))
                }}
              />
            </div>
            <div className="external-tool-grid">
              <div className="external-tool-field">
                <div className="external-tool-label">显示名称</div>
                <Input
                  size="large"
                  value={draftSettings.aria2.label}
                  onChange={(value) => {
                    updateDraft((current) => ({
                      ...current,
                      aria2: { ...current.aria2, label: value },
                    }))
                  }}
                />
              </div>
              <div className="external-tool-field">
                <div className="external-tool-label">RPC 地址</div>
                <Input
                  size="large"
                  value={draftSettings.aria2.rpcUrl}
                  onChange={(value) => {
                    updateDraft((current) => ({
                      ...current,
                      aria2: { ...current.aria2, rpcUrl: value },
                    }))
                  }}
                  placeholder="http://localhost:6800/jsonrpc"
                />
              </div>
              <div className="external-tool-field">
                <div className="external-tool-label">RPC 密钥</div>
                <Input
                  size="large"
                  value={draftSettings.aria2.secret}
                  onChange={(value) => {
                    updateDraft((current) => ({
                      ...current,
                      aria2: { ...current.aria2, secret: value },
                    }))
                  }}
                  placeholder="没有就留空"
                />
              </div>
              <div className="external-tool-field">
                <div className="external-tool-label">默认下载目录</div>
                <Input
                  size="large"
                  value={draftSettings.aria2.downloadDir}
                  onChange={(value) => {
                    updateDraft((current) => ({
                      ...current,
                      aria2: { ...current.aria2, downloadDir: value },
                    }))
                  }}
                  placeholder="不填则用系统 Downloads"
                />
              </div>
            </div>
          </section>

          <section className="external-tool-section">
            <div className="external-tool-section-head">
              <div>
                <div className="external-tool-section-title">本地命令</div>
                <div className="external-tool-section-subtitle">
                  用命令模板启动本地下载器或脚本，适合 N_m3u8DL-RE 这类命令行工具。
                </div>
              </div>
              <Switch
                checked={draftSettings.command.enabled}
                onChange={(checked) => {
                  updateDraft((current) => ({
                    ...current,
                    command: {
                      ...current.command,
                      enabled: checked,
                    },
                  }))
                }}
              />
            </div>
            <div className="external-tool-grid">
              <div className="external-tool-field">
                <div className="external-tool-label">显示名称</div>
                <Input
                  size="large"
                  value={draftSettings.command.label}
                  onChange={(value) => {
                    updateDraft((current) => ({
                      ...current,
                      command: { ...current.command, label: value },
                    }))
                  }}
                />
              </div>
              <div className="external-tool-field">
                <div className="external-tool-label">工作目录</div>
                <Input
                  size="large"
                  value={draftSettings.command.workingDirectory}
                  onChange={(value) => {
                    updateDraft((current) => ({
                      ...current,
                      command: { ...current.command, workingDirectory: value },
                    }))
                  }}
                  placeholder="不填则沿用应用当前目录"
                />
              </div>
            </div>
            <div className="external-tool-field">
              <div className="external-tool-label">命令模板</div>
              <TextArea
                autosize={{ minRows: 4 }}
                value={draftSettings.command.template}
                onChange={(value) => {
                  updateDraft((current) => ({
                    ...current,
                    command: { ...current.command, template: value },
                  }))
                }}
              />
              <div className="external-tool-hint">
                可用变量：{'{url}'}、{'{encodedUrl}'}、{'{fileName}'}、{'{downloadDir}'}、{'{referer}'}、{'{cookie}'}、{'{userAgent}'}、{'{headerArgs}'}、{'{headersJson}'}。
              </div>
            </div>
          </section>

          <section className="external-tool-section">
            <div className="external-tool-section-head">
              <div>
                <div className="external-tool-section-title">URL 协议</div>
                <div className="external-tool-section-subtitle">
                  把资源拼成自定义协议后交给系统，适合 m3u8dl 这类协议拉起。
                </div>
              </div>
              <Switch
                checked={draftSettings.protocol.enabled}
                onChange={(checked) => {
                  updateDraft((current) => ({
                    ...current,
                    protocol: {
                      ...current.protocol,
                      enabled: checked,
                    },
                  }))
                }}
              />
            </div>
            <div className="external-tool-grid">
              <div className="external-tool-field">
                <div className="external-tool-label">显示名称</div>
                <Input
                  size="large"
                  value={draftSettings.protocol.label}
                  onChange={(value) => {
                    updateDraft((current) => ({
                      ...current,
                      protocol: { ...current.protocol, label: value },
                    }))
                  }}
                />
              </div>
            </div>
            <div className="external-tool-field">
              <div className="external-tool-label">协议模板</div>
              <TextArea
                autosize={{ minRows: 3 }}
                value={draftSettings.protocol.urlTemplate}
                onChange={(value) => {
                  updateDraft((current) => ({
                    ...current,
                    protocol: { ...current.protocol, urlTemplate: value },
                  }))
                }}
              />
              <div className="external-tool-hint">
                可用变量和命令模板一致，默认形态类似：m3u8dl:{'{url}'}。
              </div>
            </div>
          </section>
        </div>
      )}
    </ExternalToolSettingsContainer>
  )
}

const ExternalToolSettingsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 32px 36px 40px;

  .external-tool-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .external-tool-header-left {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }

  .external-tool-back-btn {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-bg-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--semi-color-text-0);
  }

  .external-tool-header-title {
    font-size: 24px;
    font-weight: 700;
    color: var(--semi-color-text-0);
  }

  .external-tool-header-count {
    font-size: 16px;
    line-height: 1.6;
    color: var(--semi-color-text-2);
  }

  .external-tool-header-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .external-tool-description {
    font-size: 16px;
    line-height: 1.6;
    color: var(--semi-color-text-1);
  }

  .external-tool-loading {
    min-height: 240px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .external-tool-sections {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .external-tool-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    border-radius: 8px;
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-bg-1);
  }

  .external-tool-section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .external-tool-section-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--semi-color-text-0);
  }

  .external-tool-section-subtitle {
    margin-top: 6px;
    font-size: 16px;
    line-height: 1.6;
    color: var(--semi-color-text-2);
  }

  .external-tool-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
  }

  .external-tool-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .external-tool-label {
    font-size: 16px;
    font-weight: 600;
    color: var(--semi-color-text-1);
  }

  .external-tool-hint {
    font-size: 16px;
    line-height: 1.6;
    color: var(--semi-color-text-2);
  }
`
