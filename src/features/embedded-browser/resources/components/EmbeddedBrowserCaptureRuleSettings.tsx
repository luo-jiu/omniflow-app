import React from 'react'
import { Button, Input, Modal, Spin, Switch, TextArea, Toast } from '@douyinfe/semi-ui'
import { IconArrowLeft, IconDelete, IconPlus } from '@douyinfe/semi-icons'
import styled from 'styled-components'

import type {
  EmbeddedBrowserCaptureRegexRule,
  EmbeddedBrowserCaptureRuleSet,
} from '../model/embedded-browser-capture-rules'
import {
  createDefaultCaptureRegexRule,
  fetchEmbeddedBrowserResourceCaptureRules,
  normalizeMultilineRuleInput,
  resetEmbeddedBrowserResourceCaptureRules,
  updateEmbeddedBrowserResourceCaptureRules,
} from '../services/embedded-browser-capture-rule.api'

type EmbeddedBrowserCaptureRuleSettingsProps = {
  onBack: () => void
}

function formatRuleList(values: string[]) {
  return values.join('\n')
}

function cloneRuleSet(ruleSet: EmbeddedBrowserCaptureRuleSet): EmbeddedBrowserCaptureRuleSet {
  return {
    domainBlacklist: [...ruleSet.domainBlacklist],
    domainWhitelist: [...ruleSet.domainWhitelist],
    extensions: [...ruleSet.extensions],
    mimeTypes: [...ruleSet.mimeTypes],
    regexRules: ruleSet.regexRules.map((rule) => ({ ...rule })),
  }
}

function areRuleSetsEqual(
  left: EmbeddedBrowserCaptureRuleSet | null,
  right: EmbeddedBrowserCaptureRuleSet | null,
) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateRuleSet(ruleSet: EmbeddedBrowserCaptureRuleSet): string | null {
  for (const rule of ruleSet.regexRules) {
    if (!String(rule.label || '').trim()) {
      return '规则名称不能为空'
    }
    if (!String(rule.pattern || '').trim()) {
      return `规则「${rule.label || '未命名规则'}」缺少匹配表达式`
    }
    try {
      new RegExp(rule.pattern, rule.flags || 'ig')
    } catch {
      return `规则「${rule.label || '未命名规则'}」的正则表达式无效`
    }
  }
  return null
}

function normalizeRuleSetDraft(ruleSet: EmbeddedBrowserCaptureRuleSet): EmbeddedBrowserCaptureRuleSet {
  return {
    domainBlacklist: normalizeMultilineRuleInput(formatRuleList(ruleSet.domainBlacklist)),
    domainWhitelist: normalizeMultilineRuleInput(formatRuleList(ruleSet.domainWhitelist)),
    extensions: normalizeMultilineRuleInput(formatRuleList(ruleSet.extensions)).map((item) =>
      item.replace(/^\./, '').toLowerCase(),
    ),
    mimeTypes: normalizeMultilineRuleInput(formatRuleList(ruleSet.mimeTypes)).map((item) =>
      item.toLowerCase(),
    ),
    regexRules: ruleSet.regexRules.map((rule) => ({
      ...rule,
      ext: String(rule.ext || '').trim().replace(/^\./, '').toLowerCase(),
      flags: String(rule.flags || '').trim() || 'ig',
      label: String(rule.label || '').trim(),
      pattern: String(rule.pattern || '').trim(),
    })),
  }
}

export default function EmbeddedBrowserCaptureRuleSettings({
  onBack,
}: EmbeddedBrowserCaptureRuleSettingsProps) {
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)
  const [resetConfirmVisible, setResetConfirmVisible] = React.useState(false)
  const [initialRuleSet, setInitialRuleSet] = React.useState<EmbeddedBrowserCaptureRuleSet | null>(null)
  const [draftRuleSet, setDraftRuleSet] = React.useState<EmbeddedBrowserCaptureRuleSet | null>(null)

  const loadRuleSet = React.useCallback(async () => {
    setLoading(true)
    try {
      const ruleSet = await fetchEmbeddedBrowserResourceCaptureRules()
      const nextRuleSet = cloneRuleSet(ruleSet)
      setInitialRuleSet(nextRuleSet)
      setDraftRuleSet(cloneRuleSet(nextRuleSet))
    } catch (err: any) {
      Toast.error(err?.message || '捕获规则加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadRuleSet()
  }, [loadRuleSet])

  const builtInRules = React.useMemo(
    () => draftRuleSet?.regexRules.filter((rule) => rule.builtIn) || [],
    [draftRuleSet],
  )

  const customRules = React.useMemo(
    () => draftRuleSet?.regexRules.filter((rule) => !rule.builtIn) || [],
    [draftRuleSet],
  )

  const dirty = React.useMemo(
    () => !areRuleSetsEqual(initialRuleSet, draftRuleSet),
    [draftRuleSet, initialRuleSet],
  )

  const updateDraft = React.useCallback((updater: (current: EmbeddedBrowserCaptureRuleSet) => EmbeddedBrowserCaptureRuleSet) => {
    setDraftRuleSet((current) => {
      if (!current) {
        return current
      }
      return updater(current)
    })
  }, [])

  const handleRuleChange = React.useCallback((
    ruleId: string,
    patch: Partial<EmbeddedBrowserCaptureRegexRule>,
  ) => {
    updateDraft((current) => ({
      ...current,
      regexRules: current.regexRules.map((rule) => (
        rule.id === ruleId
          ? {
            ...rule,
            ...patch,
          }
          : rule
      )),
    }))
  }, [updateDraft])

  const handleDeleteRule = React.useCallback((ruleId: string) => {
    updateDraft((current) => ({
      ...current,
      regexRules: current.regexRules.filter((rule) => rule.id !== ruleId),
    }))
  }, [updateDraft])

  const handleAddRule = React.useCallback(() => {
    updateDraft((current) => ({
      ...current,
      regexRules: [
        ...current.regexRules,
        createDefaultCaptureRegexRule(),
      ],
    }))
  }, [updateDraft])

  const handleSave = React.useCallback(async () => {
    if (!draftRuleSet) {
      return
    }
    const normalizedDraft = normalizeRuleSetDraft(draftRuleSet)
    const validationError = validateRuleSet(normalizedDraft)
    if (validationError) {
      Toast.error(validationError)
      return
    }
    setSaving(true)
    try {
      const nextRuleSet = await updateEmbeddedBrowserResourceCaptureRules(normalizedDraft)
      const cloned = cloneRuleSet(nextRuleSet)
      setInitialRuleSet(cloned)
      setDraftRuleSet(cloneRuleSet(cloned))
      Toast.success('捕获规则已保存')
    } catch (err: any) {
      Toast.error(err?.message || '捕获规则保存失败')
    } finally {
      setSaving(false)
    }
  }, [draftRuleSet])

  const handleReset = React.useCallback(async () => {
    setResetting(true)
    try {
      const nextRuleSet = await resetEmbeddedBrowserResourceCaptureRules()
      const cloned = cloneRuleSet(nextRuleSet)
      setInitialRuleSet(cloned)
      setDraftRuleSet(cloneRuleSet(cloned))
      setResetConfirmVisible(false)
      Toast.success('已恢复默认捕获规则')
    } catch (err: any) {
      Toast.error(err?.message || '恢复默认失败')
    } finally {
      setResetting(false)
    }
  }, [])

  const extensionText = React.useMemo(
    () => formatRuleList(draftRuleSet?.extensions || []),
    [draftRuleSet],
  )

  const mimeTypeText = React.useMemo(
    () => formatRuleList(draftRuleSet?.mimeTypes || []),
    [draftRuleSet],
  )

  const domainBlacklistText = React.useMemo(
    () => formatRuleList(draftRuleSet?.domainBlacklist || []),
    [draftRuleSet],
  )

  const domainWhitelistText = React.useMemo(
    () => formatRuleList(draftRuleSet?.domainWhitelist || []),
    [draftRuleSet],
  )

  return (
    <CaptureRuleSettingsContainer>
      <div className="capture-header">
        <div className="capture-header-left">
          <button
            type="button"
            className="capture-back-btn"
            onClick={onBack}
            aria-label="返回浏览器设置"
          >
            <IconArrowLeft size="large" />
          </button>
          <div className="capture-header-title">捕获规则</div>
          {!loading && draftRuleSet ? (
            <span className="capture-header-count">
              {draftRuleSet.regexRules.length} 条规则
            </span>
          ) : null}
        </div>
        <div className="capture-header-actions">
          <Button
            size="large"
            type="tertiary"
            onClick={() => setResetConfirmVisible(true)}
            disabled={loading || resetting}
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
            保存规则
          </Button>
        </div>
      </div>

      <div className="capture-summary">
        规则只影响后续资源捕获，不会回头清理已经抓到的资源。这里先对齐 Cat Catch 常用能力：扩展名、MIME、正则规则，以及域名黑白名单。
      </div>

      {loading || !draftRuleSet ? (
        <div className="capture-empty">
          <Spin size="large" />
        </div>
      ) : (
        <div className="capture-sections">
          <section className="capture-card">
            <div className="capture-card-title">基础匹配</div>
            <div className="capture-card-description">
              这些列表用来定义“默认值得抓”的资源类型。每行一项，也支持用英文逗号分隔。
            </div>
            <div className="capture-grid">
              <label className="capture-field">
                <span className="capture-field-label">扩展名</span>
                <TextArea
                  autosize={{ minRows: 6, maxRows: 12 }}
                  value={extensionText}
                  onChange={(value) => updateDraft((current) => ({
                    ...current,
                    extensions: normalizeMultilineRuleInput(String(value || '')),
                  }))}
                  placeholder="mp4&#10;m3u8&#10;mpd"
                />
              </label>
              <label className="capture-field">
                <span className="capture-field-label">MIME 类型</span>
                <TextArea
                  autosize={{ minRows: 6, maxRows: 12 }}
                  value={mimeTypeText}
                  onChange={(value) => updateDraft((current) => ({
                    ...current,
                    mimeTypes: normalizeMultilineRuleInput(String(value || '')),
                  }))}
                  placeholder="video/*&#10;audio/*&#10;application/dash+xml"
                />
              </label>
            </div>
          </section>

          <section className="capture-card">
            <div className="capture-card-title">域名黑白名单</div>
            <div className="capture-card-description">
              黑名单命中后直接丢弃；白名单不为空时，只保留白名单域名及其子域名。
            </div>
            <div className="capture-grid">
              <label className="capture-field">
                <span className="capture-field-label">域名黑名单</span>
                <TextArea
                  autosize={{ minRows: 5, maxRows: 10 }}
                  value={domainBlacklistText}
                  onChange={(value) => updateDraft((current) => ({
                    ...current,
                    domainBlacklist: normalizeMultilineRuleInput(String(value || '')),
                  }))}
                  placeholder="ads.example.com"
                />
              </label>
              <label className="capture-field">
                <span className="capture-field-label">域名白名单</span>
                <TextArea
                  autosize={{ minRows: 5, maxRows: 10 }}
                  value={domainWhitelistText}
                  onChange={(value) => updateDraft((current) => ({
                    ...current,
                    domainWhitelist: normalizeMultilineRuleInput(String(value || '')),
                  }))}
                  placeholder="留空表示不过滤域名"
                />
              </label>
            </div>
          </section>

          <section className="capture-card">
            <div className="capture-rule-header">
              <div>
                <div className="capture-card-title">内置规则</div>
            <div className="capture-card-description">
                  内置规则不可删除，当前只保留启用和停用，不把默认站点规则改成另一套语义。
                </div>
              </div>
            </div>
            <div className="capture-rule-list">
              {builtInRules.map((rule) => (
                <CaptureRuleEditor
                  key={rule.id}
                  rule={rule}
                  onChange={handleRuleChange}
                />
              ))}
            </div>
          </section>

          <section className="capture-card">
            <div className="capture-rule-header">
              <div>
                <div className="capture-card-title">自定义规则</div>
                <div className="capture-card-description">
                  用来补站点特例。想屏蔽某类资源时，打开“黑名单规则”即可。
                </div>
              </div>
              <Button
                icon={<IconPlus />}
                size="large"
                type="primary"
                onClick={handleAddRule}
              >
                新增规则
              </Button>
            </div>
            {customRules.length === 0 ? (
              <div className="capture-empty-inline">
                还没有自定义规则。默认规则已经覆盖常见媒体格式和一部分站点特例。
              </div>
            ) : (
              <div className="capture-rule-list">
                {customRules.map((rule) => (
                  <CaptureRuleEditor
                    key={rule.id}
                    rule={rule}
                    onChange={handleRuleChange}
                    onDelete={handleDeleteRule}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <Modal
        title="恢复默认捕获规则"
        visible={resetConfirmVisible}
        onCancel={() => setResetConfirmVisible(false)}
        onOk={() => void handleReset()}
        okText="恢复默认"
        cancelText="取消"
        confirmLoading={resetting}
      >
        这会清空你当前的自定义规则和黑白名单，并恢复到默认捕获配置。
      </Modal>
    </CaptureRuleSettingsContainer>
  )
}

type CaptureRuleEditorProps = {
  onChange: (ruleId: string, patch: Partial<EmbeddedBrowserCaptureRegexRule>) => void
  onDelete?: (ruleId: string) => void
  rule: EmbeddedBrowserCaptureRegexRule
}

function CaptureRuleEditor({ onChange, onDelete, rule }: CaptureRuleEditorProps) {
  return (
    <div className="capture-rule-item">
      <div className="capture-rule-row capture-rule-row-top">
        <div className="capture-rule-switches">
          <div className="capture-switch-item">
            <span>启用</span>
            <Switch
              checked={rule.enabled}
              onChange={(checked) => onChange(rule.id, { enabled: checked })}
            />
          </div>
          <div className="capture-switch-item">
            <span>黑名单规则</span>
            <Switch
              checked={Boolean(rule.blacklist)}
              disabled={rule.builtIn}
              onChange={(checked) => onChange(rule.id, { blacklist: checked })}
            />
          </div>
        </div>
        <div className="capture-rule-actions">
          {rule.builtIn ? <span className="capture-built-in-badge">内置</span> : null}
          {!rule.builtIn && onDelete ? (
            <button
              type="button"
              className="capture-delete-btn"
              onClick={() => onDelete(rule.id)}
              aria-label={`删除规则 ${rule.label || '未命名规则'}`}
            >
              <IconDelete />
            </button>
          ) : null}
        </div>
      </div>
      <div className="capture-rule-grid">
        <label className="capture-field">
          <span className="capture-field-label">规则名称</span>
          <Input
            size="large"
            value={rule.label}
            disabled={rule.builtIn}
            onChange={(value) => onChange(rule.id, { label: String(value || '') })}
            placeholder="例如：B 站直播 m4s 屏蔽"
          />
        </label>
        <label className="capture-field">
          <span className="capture-field-label">匹配后改写扩展名</span>
          <Input
            size="large"
            value={rule.ext || ''}
            disabled={rule.builtIn}
            onChange={(value) => onChange(rule.id, { ext: String(value || '') })}
            placeholder="留空表示不改写"
          />
        </label>
        <label className="capture-field">
          <span className="capture-field-label">正则 flags</span>
          <Input
            size="large"
            value={rule.flags}
            disabled={rule.builtIn}
            onChange={(value) => onChange(rule.id, { flags: String(value || '') })}
            placeholder="ig"
          />
        </label>
      </div>
      <label className="capture-field">
        <span className="capture-field-label">URL 匹配表达式</span>
        <TextArea
          autosize={{ minRows: 3, maxRows: 8 }}
          value={rule.pattern}
          disabled={rule.builtIn}
          onChange={(value) => onChange(rule.id, { pattern: String(value || '') })}
          placeholder="https://example.com/.*"
        />
      </label>
    </div>
  )
}

const CaptureRuleSettingsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 22px;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 30px 32px 40px;
  overflow: auto;
  background: var(--app-bg);

  .capture-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .capture-header-left,
  .capture-header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .capture-back-btn,
  .capture-delete-btn {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    color: var(--app-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .capture-back-btn:hover,
  .capture-delete-btn:hover {
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
  }

  .capture-header-title {
    font-size: 28px;
    line-height: 1.2;
    font-weight: 700;
    color: var(--app-text);
  }

  .capture-header-count {
    font-size: 16px;
    line-height: 1.5;
    color: var(--app-text-muted);
  }

  .capture-summary {
    max-width: 860px;
    font-size: 17px;
    line-height: 1.65;
    color: var(--app-text-muted);
  }

  .capture-sections {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .capture-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
  }

  .capture-card-title {
    font-size: 20px;
    line-height: 1.3;
    font-weight: 700;
    color: var(--app-text);
  }

  .capture-card-description,
  .capture-empty-inline {
    font-size: 16px;
    line-height: 1.6;
    color: var(--app-text-muted);
  }

  .capture-grid,
  .capture-rule-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .capture-rule-grid {
    grid-template-columns: minmax(0, 1.4fr) minmax(180px, 0.9fr) minmax(120px, 0.5fr);
  }

  .capture-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .capture-field-label {
    font-size: 16px;
    line-height: 1.5;
    font-weight: 600;
    color: var(--app-text);
  }

  .capture-rule-header,
  .capture-rule-row,
  .capture-rule-actions,
  .capture-switch-item,
  .capture-rule-switches {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .capture-rule-header,
  .capture-rule-row-top {
    justify-content: space-between;
  }

  .capture-rule-switches {
    flex-wrap: wrap;
  }

  .capture-switch-item {
    min-height: 32px;
    padding: 4px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--app-bg-elevated) 75%, var(--semi-color-fill-0) 25%);
    font-size: 16px;
    line-height: 1.5;
    color: var(--app-text);
  }

  .capture-built-in-badge {
    min-height: 30px;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--app-border);
    font-size: 16px;
    line-height: 1.4;
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
  }

  .capture-rule-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .capture-rule-item {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: color-mix(in srgb, var(--app-bg-elevated) 84%, var(--semi-color-fill-0) 16%);
  }

  .capture-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 260px;
  }

  @media (max-width: 1100px) {
    padding: 24px 24px 32px;

    .capture-grid,
    .capture-rule-grid {
      grid-template-columns: 1fr;
    }

    .capture-header-title {
      font-size: 24px;
    }
  }
`
