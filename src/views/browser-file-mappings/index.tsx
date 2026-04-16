import React from 'react';
import styled from 'styled-components';
import OpaquePageContainer from '@/components/OpaquePageContainer';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, Input, Modal, Table, Toast, Typography } from '@douyinfe/semi-ui';
import { IconChevronLeft, IconDelete, IconEdit } from '@douyinfe/semi-icons';
import {
  createBrowserFileMapping,
  deleteBrowserFileMapping,
  fetchBrowserFileMappings,
  updateBrowserFileMapping,
  type BrowserFileMappingItem,
} from '@/features/browser-file-mappings/services/browser-file-mapping.api';

interface FormState {
  id?: number;
  fileExt: string;
  siteUrl: string;
}

const DEFAULT_FORM_STATE: FormState = {
  fileExt: '',
  siteUrl: '',
};

const Wrapper = styled.div`
  padding: 42px 56px;
  max-width: 1160px;
  margin: 0 auto;
  width: 100%;
  color: var(--semi-color-text-0);
  -webkit-app-region: drag;

  & > * {
    -webkit-app-region: no-drag;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 14px;
  }

  .subtitle {
    margin: 0 0 22px 48px;
    color: var(--semi-color-text-2);
    font-size: 14px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 18px;
  }

  .toolbar-btn {
    min-height: 38px;
    padding: 0 16px;
    font-size: 14px;
    border-radius: 8px;
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
    margin-top: 18px;
    padding: 14px 14px 4px;
    border: 1px solid var(--semi-color-border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--semi-color-bg-0) 96%, transparent);
  }

  .suffix-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 56px;
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    background: var(--semi-color-fill-0);
    color: var(--semi-color-text-0);
    font-size: 13px;
    font-weight: 600;
  }

  .site-link {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--semi-color-text-0);
    text-decoration: none;
  }

  .site-link:hover {
    color: var(--semi-color-primary);
  }

  .editor-field {
    display: grid;
    gap: 8px;
    margin-bottom: 16px;
  }

  .editor-label {
    font-size: 13px;
    color: var(--semi-color-text-1);
  }

  .editor-suffix-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .editor-suffix-prefix {
    width: 32px;
    height: 40px;
    border-radius: 8px;
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-fill-0);
    color: var(--semi-color-text-1);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    flex-shrink: 0;
  }
`;

function normalizeFileExt(raw: string): string {
  return String(raw || '').trim().replace(/^\.+/, '').toLowerCase();
}

function normalizeSiteUrl(raw: string): string {
  return String(raw || '').trim();
}

function validateForm(form: FormState): string | null {
  const fileExt = normalizeFileExt(form.fileExt);
  if (!fileExt) {
    return '后缀不能为空';
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(fileExt)) {
    return '后缀仅支持小写字母、数字、短横线和下划线';
  }

  const siteUrl = normalizeSiteUrl(form.siteUrl);
  if (!siteUrl) {
    return '网站地址不能为空';
  }
  try {
    const parsed = new URL(siteUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '网站地址必须以 http:// 或 https:// 开头';
    }
  } catch {
    return '网站地址格式不正确';
  }
  return null;
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', {
    hour12: false,
  });
}

const BrowserFileMappingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { Title } = Typography;

  const [loading, setLoading] = React.useState(false);
  const [searchKeyword, setSearchKeyword] = React.useState('');
  const [items, setItems] = React.useState<BrowserFileMappingItem[]>([]);
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [editorSubmitting, setEditorSubmitting] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(DEFAULT_FORM_STATE);

  const loadList = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchBrowserFileMappings();
      setItems(list);
    } catch (error: any) {
      Toast.error(error?.message || '加载浏览器映射失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadList();
  }, [loadList]);

  const filteredItems = React.useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) {
      return items;
    }
    return items.filter((item) => (
      String(item.fileExt || '').toLowerCase().includes(keyword)
      || String(item.siteUrl || '').toLowerCase().includes(keyword)
    ));
  }, [items, searchKeyword]);

  const openCreate = React.useCallback(() => {
    setForm(DEFAULT_FORM_STATE);
    setEditorVisible(true);
  }, []);

  const openEdit = React.useCallback((item: BrowserFileMappingItem) => {
    setForm({
      id: item.id,
      fileExt: item.fileExt,
      siteUrl: item.siteUrl,
    });
    setEditorVisible(true);
  }, []);

  const handleSubmit = React.useCallback(async () => {
    const errorMessage = validateForm(form);
    if (errorMessage) {
      Toast.warning(errorMessage);
      return;
    }

    const payload = {
      fileExt: normalizeFileExt(form.fileExt),
      siteUrl: normalizeSiteUrl(form.siteUrl),
    };

    setEditorSubmitting(true);
    try {
      if (form.id) {
        await updateBrowserFileMapping(form.id, payload);
        Toast.success('映射已更新');
      } else {
        await createBrowserFileMapping(payload);
        Toast.success('映射已创建');
      }
      setEditorVisible(false);
      await loadList();
    } catch (error: any) {
      Toast.error(error?.message || '保存映射失败');
    } finally {
      setEditorSubmitting(false);
    }
  }, [form, loadList]);

  const handleDelete = React.useCallback((item: BrowserFileMappingItem) => {
    Modal.confirm({
      title: '确认删除该映射？',
      content: `删除后，.${item.fileExt} 将不再支持“在浏览器打开”`,
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteBrowserFileMapping(item.id);
          Toast.success('映射已删除');
          await loadList();
        } catch (error: any) {
          Toast.error(error?.message || '删除映射失败');
        }
      },
    });
  }, [loadList]);

  return (
    <OpaquePageContainer>
    <Wrapper>
      <div className="header">
        <Button
          icon={<IconChevronLeft style={{ fontSize: 20 }} />}
          theme="borderless"
          onClick={() => navigate(-1)}
          style={{ padding: '6px', borderRadius: 8 }}
        />
        <Title heading={2} style={{ fontSize: 26, fontWeight: 600, margin: 0 }}>
          浏览器打开映射
        </Title>
      </div>

      <div className="subtitle">
        为文件后缀绑定默认网站。右键文件选择“在浏览器打开”时，会进入对应站点。
      </div>

      <div className="toolbar">
        <Input
          value={searchKeyword}
          onChange={setSearchKeyword}
          placeholder="搜索后缀或网站地址"
          showClear
          style={{ width: 340 }}
        />
        <Button theme="borderless" className="toolbar-btn" onClick={openCreate}>
          新建映射
        </Button>
      </div>

      <section className="section">
        <Table
          dataSource={filteredItems}
          rowKey="id"
          pagination={false}
          loading={loading}
          empty={<Empty description="还没有浏览器打开映射" />}
          columns={[
            {
              title: '后缀',
              dataIndex: 'fileExt',
              width: 120,
              render: (value: string) => <span className="suffix-chip">{`.${value}`}</span>,
            },
            {
              title: '网站',
              dataIndex: 'siteUrl',
              render: (value: string) => (
                <a
                  className="site-link"
                  href={value}
                  target="_blank"
                  rel="noreferrer"
                  title={value}
                >
                  {value}
                </a>
              ),
            },
            {
              title: '更新时间',
              dataIndex: 'updatedAt',
              width: 190,
              render: (value: string | null | undefined) => formatDateTime(value),
            },
            {
              title: '操作',
              width: 132,
              render: (_: unknown, record: BrowserFileMappingItem) => (
                <div style={{ display: 'inline-flex', gap: 8 }}>
                  <Button
                    theme="borderless"
                    icon={<IconEdit />}
                    onClick={() => openEdit(record)}
                  />
                  <Button
                    theme="borderless"
                    type="danger"
                    icon={<IconDelete />}
                    onClick={() => handleDelete(record)}
                  />
                </div>
              ),
            },
          ]}
        />
      </section>

      <Modal
        title={form.id ? '编辑映射' : '新建映射'}
        visible={editorVisible}
        onCancel={() => {
          if (editorSubmitting) {
            return;
          }
          setEditorVisible(false);
        }}
        onOk={() => {
          void handleSubmit();
        }}
        okText={form.id ? '保存' : '创建'}
        confirmLoading={editorSubmitting}
        style={{ width: 560, maxWidth: 'calc(100vw - 48px)' }}
      >
        <div className="editor-field">
          <div className="editor-label">文件后缀</div>
          <div className="editor-suffix-row">
            <span className="editor-suffix-prefix">.</span>
            <Input
              value={form.fileExt}
              onChange={(value) => setForm((prev) => ({ ...prev, fileExt: value }))}
              placeholder="例如 excalidraw"
              maxLength={64}
            />
          </div>
        </div>

        <div className="editor-field" style={{ marginBottom: 0 }}>
          <div className="editor-label">网站地址</div>
          <Input
            value={form.siteUrl}
            onChange={(value) => setForm((prev) => ({ ...prev, siteUrl: value }))}
            placeholder="https://example.com"
            maxLength={2048}
          />
        </div>
      </Modal>
    </Wrapper>
    </OpaquePageContainer>
  );
};

export default BrowserFileMappingsPage;
