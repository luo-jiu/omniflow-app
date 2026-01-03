import React from 'react';
import styled from 'styled-components';
import { Typography, Divider, Switch, Select, Button } from '@douyinfe/semi-ui';
import { IconChevronLeft } from '@douyinfe/semi-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useNavigate } from 'react-router-dom';

const SettingsWrapper = styled.div`
  padding: 60px 80px;
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
  color: var(--semi-color-text-0);

  .settings-header {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 32px;
  }

  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24px 0;
  }

  .setting-title {
    font-size: 24px;
    font-weight: 600;
  }

  .setting-desc {
    font-size: 18px;
    margin-top: 6px;
    color: var(--semi-color-text-2);
  }

  /* 适配大尺寸的选择框和开关 */
  .semi-switch-large, .semi-select-large {
    transform: none;
  }
`;

const Settings: React.FC = () => {
  const { Title, Text } = Typography;
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <SettingsWrapper>
      <div className="settings-header">
        <Button 
          icon={<IconChevronLeft style={{ fontSize: 28 }} />} 
          theme="borderless" 
          onClick={() => navigate(-1)}
          style={{ padding: '8px', borderRadius: '50%' }}
        />
        <Title heading={1} style={{ fontSize: 48 }}>软件设置</Title>
      </div>
      
      <Text style={{ fontSize: 22, color: 'var(--semi-color-text-2)', marginLeft: '72px' }}>
        在这里调整你的 Omniflow 体验
      </Text>
      
      <Divider style={{ margin: '40px 0' }} />
      
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
        <Select defaultValue="zh-CN" style={{ width: 180 }} size="large">
          <Select.Option value="zh-CN">简体中文</Select.Option>
          <Select.Option value="en-US">English</Select.Option>
        </Select>
      </div>
      
      <Divider style={{ margin: '40px 0' }} />
      
      <div style={{ marginLeft: '4px' }}>
        <Title heading={2} style={{ fontSize: 32, marginBottom: 16 }}>关于</Title>
        <Text style={{ fontSize: 20 }}>Omniflow App v0.0.1</Text>
      </div>

      <div style={{ marginTop: 60, textAlign: 'center' }}>
        <Button 
          theme="solid" 
          type="tertiary" 
          size="large" 
          onClick={() => navigate(-1)}
          style={{ 
            fontSize: 20, 
            padding: '12px 40px', 
            height: 'auto',
            borderRadius: 10
          }}
        >
          退出设置
        </Button>
      </div>
    </SettingsWrapper>
  );
};

export default Settings;

