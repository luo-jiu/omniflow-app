import React, { useState } from 'react';
import styled from 'styled-components';
import { Typography, Divider, Switch, Select, Button } from '@douyinfe/semi-ui';
import { IconChevronLeft, IconForward } from '@douyinfe/semi-icons';
import { useTheme } from '@/hooks/useTheme';
import { useNavigate } from 'react-router-dom';
import { getFileTreeShowSuffix, setFileTreeShowSuffix } from '@/utils/fileTreeSettings';

const SettingsWrapper = styled.div`
  padding: 48px 60px;
  padding-top: 56px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
  color: var(--semi-color-text-0);
  -webkit-app-region: drag;

  & > * {
    -webkit-app-region: no-drag;
  }

  .settings-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 8px;
  }

  .settings-subtitle {
    margin-left: 52px;
    margin-bottom: 28px;
    color: var(--semi-color-text-2);
    font-size: 15px;
  }

  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 0;
  }

  .setting-title {
    font-size: 16px;
    font-weight: 500;
  }

  .setting-desc {
    font-size: 14px;
    margin-top: 4px;
    color: var(--semi-color-text-2);
  }

  .settings-action-btn {
    min-height: 36px;
    min-width: 96px;
    padding: 0 16px;
    border-radius: 8px;
    font-size: 14px;
  }

  .settings-action-btn.manage {
    border: 1px solid color-mix(in srgb, var(--semi-color-success) 34%, var(--semi-color-border) 66%);
    color: color-mix(in srgb, var(--semi-color-success) 80%, var(--semi-color-text-0) 20%);
    background: color-mix(in srgb, var(--semi-color-success-light-default) 72%, var(--semi-color-bg-0) 28%);
  }

  .settings-action-btn.manage:hover {
    background: color-mix(in srgb, var(--semi-color-success-light-default) 82%, var(--semi-color-bg-0) 18%);
    border-color: color-mix(in srgb, var(--semi-color-success) 45%, var(--semi-color-border) 55%);
  }

  .settings-action-btn.manage:active {
    background: color-mix(in srgb, var(--semi-color-success-light-default) 90%, var(--semi-color-bg-0) 10%);
    border-color: color-mix(in srgb, var(--semi-color-success) 56%, var(--semi-color-border) 44%);
  }

  .settings-action-btn.exit {
    border: 1px solid var(--semi-color-border);
    color: var(--semi-color-text-0);
    background: var(--semi-color-fill-0);
  }

  .settings-action-btn.exit:hover {
    background: var(--semi-color-fill-1);
    border-color: color-mix(in srgb, var(--semi-color-border) 85%, var(--semi-color-text-2));
  }

  .settings-action-btn.exit:active {
    background: var(--semi-color-fill-2);
  }
`;

const Settings: React.FC = () => {
  const { Title, Text } = Typography;
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [showFileSuffix, setShowFileSuffix] = useState<boolean>(() => getFileTreeShowSuffix());

  return (
    <SettingsWrapper>
      <div className="settings-header">
        <Button
          icon={<IconChevronLeft style={{ fontSize: 20 }} />}
          theme="borderless"
          onClick={() => navigate(-1)}
          style={{ padding: '6px', borderRadius: '8px' }}
        />
        <Title heading={2} style={{ fontSize: 26, fontWeight: 600 }}>软件设置</Title>
      </div>

      <div className="settings-subtitle">
        在这里调整你的 Omniflow 体验
      </div>

      <Divider style={{ margin: '20px 0' }} />

      <div className="setting-item">
        <div>
          <div className="setting-title">深色模式</div>
          <div className="setting-desc">开启或关闭深色界面主题</div>
        </div>
        <Switch
          size="large"
          checked={theme === 'dark'}
          onChange={() => toggleTheme()}
        />
      </div>

      <div className="setting-item">
        <div>
          <div className="setting-title">默认语言</div>
          <div className="setting-desc">选择界面显示的语言</div>
        </div>
        <Select defaultValue="zh-CN" style={{ width: 160 }} size="large">
          <Select.Option value="zh-CN">简体中文</Select.Option>
          <Select.Option value="en-US">English</Select.Option>
        </Select>
      </div>

      <div className="setting-item">
        <div>
          <div className="setting-title">目录树显示文件后缀</div>
          <div className="setting-desc">开启后，文件节点会显示扩展名（如 .txt、.jpg）</div>
        </div>
        <Switch
          size="large"
          checked={showFileSuffix}
          onChange={(checked) => {
            setShowFileSuffix(checked);
            setFileTreeShowSuffix(checked);
          }}
        />
      </div>

      <div className="setting-item">
        <div>
          <div className="setting-title">标签管理</div>
          <div className="setting-desc">管理标签场景、颜色、排序和启用状态</div>
        </div>
        <Button
          icon={<IconForward />}
          theme="solid"
          type="primary"
          onClick={() => navigate('/settings/tags')}
          className="settings-action-btn manage"
        >
          管理
        </Button>
      </div>

      <Divider style={{ margin: '24px 0' }} />

      <div>
        <Title heading={3} style={{ fontSize: 18, marginBottom: 8 }}>关于</Title>
        <Text style={{ fontSize: 14, color: 'var(--semi-color-text-2)' }}>Omniflow App v0.0.1</Text>
      </div>

      <div style={{ marginTop: 48, textAlign: 'center' }}>
        <Button
          theme="light"
          type="secondary"
          size="default"
          onClick={() => navigate(-1)}
          className="settings-action-btn exit"
        >
          退出设置
        </Button>
      </div>
    </SettingsWrapper>
  );
};

export default Settings;
