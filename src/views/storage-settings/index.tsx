import React from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import OpaquePageContainer from '@/components/OpaquePageContainer';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { IconChevronLeft, IconDelete, IconEdit, IconPlus, IconTick } from '@douyinfe/semi-icons';
import {
  addProvider,
  deleteProvider,
  fetchProviders,
  fetchRoutingRules,
  setDefault,
  testProvider,
  updateProvider,
  updateRoutingRules,
  type AddProviderPayload,
  type ProviderItem,
  type RoutingRule,
} from '@/features/storage-config/services/storage-config.api';
import { openCompactConfirm } from '@/components/ui/compact-confirm';

const PROVIDER_TYPE_OPTIONS = [
  { value: 'minio', label: 'MinIO' },
  { value: 's3', label: 'Amazon S3' },
  { value: 'oss', label: '阿里云 OSS' },
  { value: 'cos', label: '腾讯云 COS' },
];

interface ProviderFormState {
  alias: string;
  type: string;
  endpoint: string;
  publicEndpoint: string;
  accessKey: string;
  secretKey: string;
  useSSL: boolean;
  bucket: string;
  region: string;
  label: string;
}

const DEFAULT_PROVIDER_FORM: ProviderFormState = {
  alias: '',
  type: 'minio',
  endpoint: '',
  publicEndpoint: '',
  accessKey: '',
  secretKey: '',
  useSSL: false,
  bucket: '',
  region: '',
  label: '',
};

interface RuleFormState {
  name: string;
  targetProvider: string;
  minFileSizeBytes: number;
  maxFileSizeBytes: number;
  extensions: string;
  mimePrefixes: string;
}

const DEFAULT_RULE_FORM: RuleFormState = {
  name: '',
  targetProvider: '',
  minFileSizeBytes: 0,
  maxFileSizeBytes: 0,
  extensions: '',
  mimePrefixes: '',
};

const Wrapper = styled.div<{ $embedded?: boolean }>`
  padding: ${({ $embedded }) => ($embedded ? '0' : '28px 32px 24px')};
  max-width: ${({ $embedded }) => ($embedded ? 'none' : '900px')};
  margin: 0 auto;
  width: 100%;
  color: var(--semi-color-text-0);
  -webkit-app-region: ${({ $embedded }) => ($embedded ? 'no-drag' : 'drag')};

  & > * {
    -webkit-app-region: no-drag;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 11px;
    margin-bottom: 6px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 11px;
  }

  .page-back-button {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    min-width: 28px;
    padding: 0;
    border-radius: 7px;
  }

  .page-title {
    margin: 0;
    font-size: 23px;
    font-weight: 700;
    line-height: 1.15;
  }

  .subtitle {
    margin: 0 0 16px 39px;
    color: var(--semi-color-text-2);
    font-size: 11px;
    line-height: 1.55;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 11px;
  }

  .toolbar-btn {
    min-height: 30px;
    padding: 0 12px;
    font-size: 11px;
    font-weight: 600;
    border-radius: 6px;
    border: 1px solid var(--semi-color-border);
    color: var(--semi-color-text-0);
    background: var(--semi-color-bg-0);
  }

  .toolbar-btn:hover {
    background: var(--semi-color-bg-0);
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
  }

  .section {
    margin-top: 14px;
    padding: 10px 10px 4px;
    border: 1px solid var(--semi-color-border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--semi-color-bg-0) 96%, transparent);
  }

  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 9px;
  }

  .section-heading {
    margin: 0;
    font-size: 16px;
    line-height: 1.25;
    font-weight: 700;
  }

  .form-grid {
    display: grid;
    gap: 10px;
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .form-field {
    display: grid;
    gap: 5px;
  }

  .form-label {
    color: var(--semi-color-text-1);
    font-size: 11px;
    line-height: 15px;
  }

  .cell-ellipsis {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-actions {
    display: inline-flex;
    gap: 5px;
    flex-wrap: wrap;
  }

  .semi-table {
    font-size: 10px;
  }

  .semi-table-container {
    overflow: hidden;
  }

  .semi-table-thead > .semi-table-row > .semi-table-row-head,
  .semi-table-tbody > .semi-table-row > .semi-table-row-cell {
    padding: 8px 9px;
  }

  .semi-table-thead > .semi-table-row > .semi-table-row-head {
    font-size: 10px;
    font-weight: 600;
  }

  .semi-button {
    height: 25px;
    min-height: 25px;
    padding: 0 7px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 600;
  }

  .semi-button .semi-icon {
    font-size: 12px;
  }

  .semi-tag {
    font-size: 10px;
    line-height: 16px;
  }

  .semi-empty-description {
    font-size: 11px;
  }
`;

const StorageSettingsCompactModalStyle = createGlobalStyle`
  .storage-settings-compact-modal {
    width: 420px !important;
  }

  .storage-settings-compact-modal .semi-modal-content {
    overflow: hidden;
    border: 1px solid var(--app-border-strong);
    border-radius: 8px;
    background: var(--app-bg-elevated);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), var(--app-shadow);
  }

  .storage-settings-compact-modal .semi-modal-header {
    margin: 0;
    padding: 13px 16px 8px !important;
  }

  .storage-settings-compact-modal .semi-modal-title {
    font-size: 14px;
    line-height: 1.35;
    font-weight: 700;
  }

  .storage-settings-compact-modal .semi-modal-body {
    padding: 0 16px 13px !important;
    font-size: 12px;
    line-height: 1.55;
    color: var(--semi-color-text-1);
  }

  .storage-settings-compact-modal .semi-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin: 0;
    padding: 0 16px 16px !important;
  }

  .storage-settings-compact-modal .semi-button {
    height: 28px;
    min-width: 56px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
  }

  .storage-settings-compact-modal .semi-input-wrapper,
  .storage-settings-compact-modal .semi-input,
  .storage-settings-compact-modal .semi-select,
  .storage-settings-compact-modal .semi-select-selection,
  .storage-settings-compact-modal .semi-input-number,
  .storage-settings-compact-modal textarea {
    font-size: 12px;
  }

  .storage-settings-compact-modal .semi-input-wrapper,
  .storage-settings-compact-modal .semi-select,
  .storage-settings-compact-modal .semi-input-number {
    height: 28px;
    min-height: 28px;
  }

  .storage-settings-compact-modal .semi-select {
    max-height: 28px !important;
    overflow: hidden !important;
  }

  .storage-settings-compact-modal .semi-select::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  .storage-settings-compact-modal .semi-select-selection {
    height: 28px;
    min-height: 28px;
    max-height: 28px;
    align-items: center;
    overflow: hidden !important;
    padding-top: 0;
    padding-bottom: 0;
  }

  .storage-settings-compact-modal .semi-select-selection-placeholder,
  .storage-settings-compact-modal .semi-select-selection-rendered,
  .storage-settings-compact-modal .semi-select-selection-text,
  .storage-settings-compact-modal .semi-select-selection span {
    overflow: hidden !important;
  }

  .storage-settings-compact-modal .semi-select-selection-text {
    max-height: none !important;
    line-height: 28px;
    white-space: nowrap;
  }

  .storage-settings-compact-modal .semi-select-selection-text::-webkit-scrollbar {
    display: none;
  }

  .storage-settings-compact-modal .semi-select-arrow {
    align-self: center;
  }
`;

function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function validateProviderForm(form: ProviderFormState, isEditing: boolean): string | null {
  if (!isEditing && !form.alias.trim()) return '别名不能为空';
  if (!form.type.trim()) return '类型不能为空';
  if (!form.endpoint.trim()) return '地址不能为空';
  if (!form.bucket.trim()) return '存储桶不能为空';
  return null;
}

function validateRuleForm(form: RuleFormState): string | null {
  if (!form.targetProvider.trim()) return '目标 Provider 不能为空';
  return null;
}

type StorageSettingsProps = {
  embedded?: boolean;
  onBack?: () => void;
};

const StorageSettings: React.FC<StorageSettingsProps> = ({
  embedded = false,
  onBack,
}) => {
  const navigate = useNavigate();
  const { Title } = Typography;
  const modalStyle = React.useMemo(
    () => ({ WebkitAppRegion: 'no-drag' } as unknown as React.CSSProperties),
    [],
  );

  const [loading, setLoading] = React.useState(false);
  const [providers, setProviders] = React.useState<ProviderItem[]>([]);
  const [defaultProvider, setDefaultProvider] = React.useState('');
  const [rules, setRules] = React.useState<RoutingRule[]>([]);
  const [testingAlias, setTestingAlias] = React.useState<string | null>(null);

  // Provider 编辑弹窗
  const [providerEditorVisible, setProviderEditorVisible] = React.useState(false);
  const [providerEditorSubmitting, setProviderEditorSubmitting] = React.useState(false);
  const [editingProviderAlias, setEditingProviderAlias] = React.useState<string | null>(null);
  const [providerForm, setProviderForm] = React.useState<ProviderFormState>(DEFAULT_PROVIDER_FORM);

  // 路由规则编辑弹窗
  const [ruleEditorVisible, setRuleEditorVisible] = React.useState(false);
  const [ruleEditorSubmitting, setRuleEditorSubmitting] = React.useState(false);
  const [editingRuleIndex, setEditingRuleIndex] = React.useState<number | null>(null);
  const [ruleForm, setRuleForm] = React.useState<RuleFormState>(DEFAULT_RULE_FORM);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [providerData, rulesData] = await Promise.all([
        fetchProviders(),
        fetchRoutingRules(),
      ]);
      setProviders(providerData.providers || []);
      setDefaultProvider(providerData.defaultProvider || '');
      setRules(rulesData || []);
    } catch (error: any) {
      Toast.error(error?.message || '加载存储配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  // --- Provider 操作 ---

  const openAddProvider = () => {
    setProviderForm(DEFAULT_PROVIDER_FORM);
    setEditingProviderAlias(null);
    setProviderEditorVisible(true);
  };

  const openEditProvider = (item: ProviderItem) => {
    setProviderForm({
      alias: item.alias,
      type: item.type,
      endpoint: item.endpoint,
      publicEndpoint: item.publicEndpoint || '',
      accessKey: '',
      secretKey: '',
      useSSL: item.useSSL,
      bucket: item.bucket,
      region: item.region,
      label: item.label,
    });
    setEditingProviderAlias(item.alias);
    setProviderEditorVisible(true);
  };

  const handleProviderSubmit = async () => {
    const isEditing = editingProviderAlias !== null;
    const error = validateProviderForm(providerForm, isEditing);
    if (error) {
      Toast.warning(error);
      return;
    }

    setProviderEditorSubmitting(true);
    try {
      if (isEditing) {
        await updateProvider(editingProviderAlias, {
          type: providerForm.type.trim(),
          endpoint: providerForm.endpoint.trim(),
          publicEndpoint: providerForm.publicEndpoint.trim(),
          accessKey: providerForm.accessKey.trim(),
          secretKey: providerForm.secretKey.trim(),
          useSSL: providerForm.useSSL,
          bucket: providerForm.bucket.trim(),
          region: providerForm.region.trim(),
          label: providerForm.label.trim(),
        });
        Toast.success('Provider 已更新');
      } else {
        const payload: AddProviderPayload = {
          alias: providerForm.alias.trim(),
          type: providerForm.type.trim(),
          endpoint: providerForm.endpoint.trim(),
          publicEndpoint: providerForm.publicEndpoint.trim(),
          accessKey: providerForm.accessKey.trim(),
          secretKey: providerForm.secretKey.trim(),
          useSSL: providerForm.useSSL,
          bucket: providerForm.bucket.trim(),
          region: providerForm.region.trim(),
          label: providerForm.label.trim(),
        };
        await addProvider(payload);
        Toast.success('Provider 已添加');
      }
      setProviderEditorVisible(false);
      await loadData();
    } catch (error: any) {
      Toast.error(error?.message || '保存 Provider 失败');
    } finally {
      setProviderEditorSubmitting(false);
    }
  };

  const handleDeleteProvider = (item: ProviderItem) => {
    if (item.alias === defaultProvider) {
      Toast.warning('不能删除默认 Provider');
      return;
    }
    openCompactConfirm({
      title: '确认删除此 Provider？',
      content: `删除后引用「${item.alias}」的文件将无法访问`,
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteProvider(item.alias);
          Toast.success('Provider 已删除');
          await loadData();
        } catch (error: any) {
          Toast.error(error?.message || '删除 Provider 失败');
        }
      },
    });
  };

  const handleSetDefault = async (alias: string) => {
    try {
      await setDefault(alias);
      setDefaultProvider(alias);
      Toast.success(`已设为默认 Provider: ${alias}`);
    } catch (error: any) {
      Toast.error(error?.message || '设置默认 Provider 失败');
    }
  };

  const handleTestProvider = async (alias: string) => {
    setTestingAlias(alias);
    try {
      const result = await testProvider(alias);
      if (result.success) {
        Toast.success(`${alias}: 连接成功`);
      } else {
        Toast.warning(`${alias}: ${result.message}`);
      }
    } catch (error: any) {
      Toast.error(error?.message || '测试连接失败');
    } finally {
      setTestingAlias(null);
    }
  };

  // --- 路由规则操作 ---

  const openAddRule = () => {
    setRuleForm(DEFAULT_RULE_FORM);
    setEditingRuleIndex(null);
    setRuleEditorVisible(true);
  };

  const openEditRule = (index: number, rule: RoutingRule) => {
    setRuleForm({
      name: rule.name,
      targetProvider: rule.targetProvider,
      minFileSizeBytes: rule.conditions.minFileSizeBytes || 0,
      maxFileSizeBytes: rule.conditions.maxFileSizeBytes || 0,
      extensions: (rule.conditions.extensions || []).join(', '),
      mimePrefixes: (rule.conditions.mimePrefixes || []).join(', '),
    });
    setEditingRuleIndex(index);
    setRuleEditorVisible(true);
  };

  const handleRuleSubmit = async () => {
    const error = validateRuleForm(ruleForm);
    if (error) {
      Toast.warning(error);
      return;
    }

    const newRule: RoutingRule = {
      name: ruleForm.name.trim(),
      targetProvider: ruleForm.targetProvider.trim(),
      conditions: {
        minFileSizeBytes: ruleForm.minFileSizeBytes || 0,
        maxFileSizeBytes: ruleForm.maxFileSizeBytes || 0,
        extensions: ruleForm.extensions
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
        mimePrefixes: ruleForm.mimePrefixes
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
      },
    };

    const nextRules = [...rules];
    if (editingRuleIndex !== null) {
      nextRules[editingRuleIndex] = newRule;
    } else {
      nextRules.push(newRule);
    }

    setRuleEditorSubmitting(true);
    try {
      await updateRoutingRules(nextRules);
      Toast.success(editingRuleIndex !== null ? '规则已更新' : '规则已添加');
      setRuleEditorVisible(false);
      setRules(nextRules);
    } catch (error: any) {
      Toast.error(error?.message || '保存规则失败');
    } finally {
      setRuleEditorSubmitting(false);
    }
  };

  const handleDeleteRule = async (index: number) => {
    const nextRules = rules.filter((_, i) => i !== index);
    try {
      await updateRoutingRules(nextRules);
      Toast.success('规则已删除');
      setRules(nextRules);
    } catch (error: any) {
      Toast.error(error?.message || '删除规则失败');
    }
  };

  const providerAliases = React.useMemo(
    () => providers.map(p => p.alias),
    [providers],
  );

  const modalBtnProps = React.useMemo(() => ({
    style: { minWidth: 56, height: 28, fontSize: 12, borderRadius: 6 },
  }), []);

  const content = (
    <>
      <StorageSettingsCompactModalStyle />
      <Wrapper $embedded={embedded}>
        <div className="header">
          <div className="header-left">
            <Button
              icon={<IconChevronLeft style={{ fontSize: 14 }} />}
              theme="borderless"
              onClick={() => {
                if (onBack) {
                  onBack();
                  return;
                }
                navigate(-1);
              }}
              className="page-back-button"
            />
            <Title heading={2} className="page-title">
              存储管理
            </Title>
          </div>
        </div>

        <div className="subtitle">
          管理多个存储 Provider（MinIO / S3 / OSS 等），配置文件分流规则。
        </div>

        {/* Provider 管理 */}
        <section className="section">
          <div className="section-title">
            <Title heading={5} className="section-heading">存储 Provider</Title>
            <Button
              theme="borderless"
              icon={<IconPlus />}
              className="toolbar-btn"
              onClick={openAddProvider}
            >
              添加 Provider
            </Button>
          </div>
          <Table
            loading={loading}
            dataSource={providers}
            rowKey="alias"
            pagination={false}
            empty={<Empty description="暂无 Provider" />}
            columns={[
              {
                title: '别名',
                dataIndex: 'alias',
                width: 112,
                render: (value: string) => (
                  <span className="cell-ellipsis">
                    <span>{value}</span>
                    {value === defaultProvider && (
                      <Tag color="blue" style={{ marginLeft: 6 }}>默认</Tag>
                    )}
                  </span>
                ),
              },
              {
                title: '类型',
                dataIndex: 'type',
                width: 82,
                render: (value: string) => (
                  <Tag>{(PROVIDER_TYPE_OPTIONS.find(o => o.value === value)?.label) || value}</Tag>
                ),
              },
              {
                title: '地址',
                dataIndex: 'endpoint',
                width: 150,
                render: (v: string) => <span className="cell-ellipsis">{v || '-'}</span>,
              },
              {
                title: '公开地址',
                dataIndex: 'publicEndpoint',
                width: 150,
                render: (v: string) => <span className="cell-ellipsis">{v || '-'}</span>,
              },
              {
                title: '存储桶',
                dataIndex: 'bucket',
                width: 100,
                render: (v: string) => <span className="cell-ellipsis">{v || '-'}</span>,
              },
              {
                title: '标签',
                dataIndex: 'label',
                width: 92,
                render: (v: string) => <span className="cell-ellipsis">{v || '-'}</span>,
              },
              {
                title: '操作',
                width: 220,
                render: (_: unknown, record: ProviderItem) => (
                  <div className="row-actions">
                    <Button
                      theme="borderless"
                      icon={<IconEdit />}
                      onClick={() => openEditProvider(record)}
                    >
                      编辑
                    </Button>
                    <Button
                      theme="borderless"
                      loading={testingAlias === record.alias}
                      onClick={() => { void handleTestProvider(record.alias); }}
                    >
                      测试
                    </Button>
                    {record.alias !== defaultProvider && (
                      <Button
                        theme="borderless"
                        icon={<IconTick />}
                        onClick={() => { void handleSetDefault(record.alias); }}
                      >
                        设为默认
                      </Button>
                    )}
                    {record.alias !== defaultProvider && (
                      <Button
                        theme="borderless"
                        type="danger"
                        icon={<IconDelete />}
                        onClick={() => handleDeleteProvider(record)}
                      >
                        删除
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </section>

        {/* 路由规则 */}
        <section className="section">
          <div className="section-title">
            <Title heading={5} className="section-heading">分流规则</Title>
            <Button
              theme="borderless"
              icon={<IconPlus />}
              className="toolbar-btn"
              onClick={openAddRule}
            >
              添加规则
            </Button>
          </div>
          <Table
            dataSource={rules.map((rule, index) => ({ ...rule, _index: index }))}
            rowKey="_index"
            pagination={false}
            empty={<Empty description="暂无分流规则，所有文件将上传至默认 Provider" />}
            columns={[
              { title: '优先级', dataIndex: '_index', width: 58, render: (v: number) => v + 1 },
              {
                title: '名称',
                dataIndex: 'name',
                width: 120,
                render: (v: string) => <span className="cell-ellipsis">{v || '-'}</span>,
              },
              {
                title: '目标 Provider',
                dataIndex: 'targetProvider',
                width: 118,
                render: (v: string) => <span className="cell-ellipsis">{v || '-'}</span>,
              },
              {
                title: '文件大小范围',
                width: 150,
                render: (_: unknown, record: RoutingRule) => {
                  const min = record.conditions.minFileSizeBytes;
                  const max = record.conditions.maxFileSizeBytes;
                  if (!min && !max) return '-';
                  return <span className="cell-ellipsis">{`${formatFileSize(min)} ~ ${max ? formatFileSize(max) : '不限'}`}</span>;
                },
              },
              {
                title: '扩展名',
                width: 118,
                render: (_: unknown, record: RoutingRule) =>
                  <span className="cell-ellipsis">{(record.conditions.extensions || []).join(', ') || '-'}</span>,
              },
              {
                title: 'MIME 前缀',
                width: 118,
                render: (_: unknown, record: RoutingRule) =>
                  <span className="cell-ellipsis">{(record.conditions.mimePrefixes || []).join(', ') || '-'}</span>,
              },
              {
                title: '操作',
                width: 132,
                render: (_: unknown, record: any) => (
                  <div className="row-actions">
                    <Button
                      theme="borderless"
                      icon={<IconEdit />}
                      onClick={() => openEditRule(record._index, record)}
                    >
                      编辑
                    </Button>
                    <Button
                      theme="borderless"
                      type="danger"
                      icon={<IconDelete />}
                      onClick={() => { void handleDeleteRule(record._index); }}
                    >
                      删除
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </section>

        {/* Provider 编辑弹窗 */}
        <Modal
          title={editingProviderAlias ? '编辑 Provider' : '添加 Provider'}
          visible={providerEditorVisible}
          okText={editingProviderAlias ? '保存' : '添加'}
          onCancel={() => setProviderEditorVisible(false)}
          onOk={handleProviderSubmit}
          confirmLoading={providerEditorSubmitting}
          width={420}
          className="storage-settings-compact-modal"
          style={modalStyle}
          okButtonProps={modalBtnProps}
          cancelButtonProps={modalBtnProps}
        >
          <div className="form-grid">
            {!editingProviderAlias && (
              <div className="form-field">
                <span className="form-label">别名（唯一标识）</span>
                <Input
                  value={providerForm.alias}
                  onChange={(v) => setProviderForm(prev => ({ ...prev, alias: v }))}
                  placeholder="如 local-minio"
                />
              </div>
            )}
            <div className="form-row">
              <div className="form-field">
                <span className="form-label">类型</span>
                <Select
                  value={providerForm.type}
                  onChange={(v) => setProviderForm(prev => ({ ...prev, type: String(v) }))}
                >
                  {PROVIDER_TYPE_OPTIONS.map(o => (
                    <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>
                  ))}
                </Select>
              </div>
              <div className="form-field">
                <span className="form-label">显示标签</span>
                <Input
                  value={providerForm.label}
                  onChange={(v) => setProviderForm(prev => ({ ...prev, label: v }))}
                  placeholder="如 本地 MinIO"
                />
              </div>
            </div>
            <div className="form-field">
              <span className="form-label">地址（Endpoint）</span>
              <Input
                value={providerForm.endpoint}
                onChange={(v) => setProviderForm(prev => ({ ...prev, endpoint: v }))}
                placeholder="如 192.168.1.10:9000"
              />
            </div>
            <div className="form-field">
              <span className="form-label">公开地址（Public Endpoint）</span>
              <Input
                value={providerForm.publicEndpoint}
                onChange={(v) => setProviderForm(prev => ({ ...prev, publicEndpoint: v }))}
                placeholder="如 localhost:9000"
              />
            </div>
            <div className="form-row">
              <div className="form-field">
                <span className="form-label">Access Key</span>
                <Input
                  value={providerForm.accessKey}
                  onChange={(v) => setProviderForm(prev => ({ ...prev, accessKey: v }))}
                  placeholder={editingProviderAlias ? '留空则不更新' : ''}
                />
              </div>
              <div className="form-field">
                <span className="form-label">Secret Key</span>
                <Input
                  type="password"
                  value={providerForm.secretKey}
                  onChange={(v) => setProviderForm(prev => ({ ...prev, secretKey: v }))}
                  placeholder={editingProviderAlias ? '留空则不更新' : ''}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-field">
                <span className="form-label">存储桶（Bucket）</span>
                <Input
                  value={providerForm.bucket}
                  onChange={(v) => setProviderForm(prev => ({ ...prev, bucket: v }))}
                  placeholder="如 my-bucket"
                />
              </div>
              <div className="form-field">
                <span className="form-label">区域（Region）</span>
                <Input
                  value={providerForm.region}
                  onChange={(v) => setProviderForm(prev => ({ ...prev, region: v }))}
                  placeholder="可选"
                />
              </div>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span>使用 SSL</span>
              <Switch
                checked={providerForm.useSSL}
                onChange={(checked) => setProviderForm(prev => ({ ...prev, useSSL: checked }))}
              />
            </div>
          </div>
        </Modal>

        {/* 路由规则编辑弹窗 */}
        <Modal
          title={editingRuleIndex !== null ? '编辑规则' : '添加规则'}
          visible={ruleEditorVisible}
          okText={editingRuleIndex !== null ? '保存' : '添加'}
          onCancel={() => setRuleEditorVisible(false)}
          onOk={handleRuleSubmit}
          confirmLoading={ruleEditorSubmitting}
          width={420}
          className="storage-settings-compact-modal"
          style={modalStyle}
          okButtonProps={modalBtnProps}
          cancelButtonProps={modalBtnProps}
        >
          <div className="form-grid">
            <div className="form-field">
              <span className="form-label">规则名称</span>
              <Input
                value={ruleForm.name}
                onChange={(v) => setRuleForm(prev => ({ ...prev, name: v }))}
                placeholder="如 大文件走远端"
              />
            </div>
            <div className="form-field">
              <span className="form-label">目标 Provider</span>
              <Select
                value={ruleForm.targetProvider}
                onChange={(v) => setRuleForm(prev => ({ ...prev, targetProvider: String(v) }))}
                placeholder="选择目标 Provider"
              >
                {providerAliases.map(alias => (
                  <Select.Option key={alias} value={alias}>{alias}</Select.Option>
                ))}
              </Select>
            </div>
            <div className="form-row">
              <div className="form-field">
                <span className="form-label">最小文件大小（字节）</span>
                <InputNumber
                  value={ruleForm.minFileSizeBytes}
                  onNumberChange={(v) => setRuleForm(prev => ({ ...prev, minFileSizeBytes: Number(v || 0) }))}
                  min={0}
                  placeholder="0 表示不限"
                />
              </div>
              <div className="form-field">
                <span className="form-label">最大文件大小（字节）</span>
                <InputNumber
                  value={ruleForm.maxFileSizeBytes}
                  onNumberChange={(v) => setRuleForm(prev => ({ ...prev, maxFileSizeBytes: Number(v || 0) }))}
                  min={0}
                  placeholder="0 表示不限"
                />
              </div>
            </div>
            <div className="form-field">
              <span className="form-label">扩展名（逗号分隔，无点号）</span>
              <Input
                value={ruleForm.extensions}
                onChange={(v) => setRuleForm(prev => ({ ...prev, extensions: v }))}
                placeholder="如 mp4, mkv, avi"
              />
            </div>
            <div className="form-field">
              <span className="form-label">MIME 前缀（逗号分隔）</span>
              <Input
                value={ruleForm.mimePrefixes}
                onChange={(v) => setRuleForm(prev => ({ ...prev, mimePrefixes: v }))}
                placeholder="如 video/, image/"
              />
            </div>
          </div>
        </Modal>
      </Wrapper>
    </>
  );

  return embedded ? content : <OpaquePageContainer>{content}</OpaquePageContainer>;
};

export default StorageSettings;
