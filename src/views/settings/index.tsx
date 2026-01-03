import React from 'react';
import styled from 'styled-components';
import { Typography, Divider, Switch, Select } from '@douyinfe/semi-ui';

const SettingsWrapper = styled.div`
  padding: 40px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
  color: var(--semi-color-text-0);

  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 0;
  }
`;

const Settings: React.FC = () => {
  const { Title, Text } = Typography;

  return (
    <SettingsWrapper>
      <Title heading={2}>软件设置</Title>
      <Text style={{ color: 'var(--semi-color-text-2)' }}>在这里调整你的 Omniflow 体验</Text>
      
      <Divider style={{ margin: '24px 0' }} />
      
      <div className="setting-item">
        <div>
          <Text strong>深色模式</Text>
          <br />
          <Text size="small" style={{ color: 'var(--semi-color-text-2)' }}>开启或关闭深色界面主题</Text>
        </div>
        <Switch defaultChecked />
      </div>

      <div className="setting-item">
        <div>
          <Text strong>默认语言</Text>
          <br />
          <Text size="small" style={{ color: 'var(--semi-color-text-2)' }}>选择界面显示的语言</Text>
        </div>
        <Select defaultValue="zh-CN" style={{ width: 120 }}>
          <Select.Option value="zh-CN">简体中文</Select.Option>
          <Select.Option value="en-US">English</Select.Option>
        </Select>
      </div>
      
      <Divider style={{ margin: '24px 0' }} />
      
      <Title heading={4}>关于</Title>
      <Text size="small">Omniflow App v0.0.1</Text>
    </SettingsWrapper>
  );
};

export default Settings;

