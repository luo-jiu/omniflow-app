import React from 'react';
import styled from 'styled-components';
import { Typography, Divider, Switch, Select, Button } from '@douyinfe/semi-ui';
import { IconChevronLeft } from '@douyinfe/semi-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useNavigate } from 'react-router-dom';

const SettingsWrapper = styled.div`
  padding: 80px 100px;
  max-width: 1300px;
  margin: 0 auto;
  width: 100%;
  color: var(--semi-color-text-0);

  .settings-header {
    display: flex;
    align-items: center;
    gap: 24px;
    margin-bottom: 40px;
  }

  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 36px 0;
  }

  .setting-title {
    font-size: 32px;
    font-weight: 600;
  }

  .setting-desc {
    font-size: 24px;
    margin-top: 8px;
    color: var(--semi-color-text-2);
  }

  /* 适配大尺寸的选择框和开关 */
  .semi-switch-large {
    transform: scale(1.5);
    margin-right: 20px;
  }
  
  .semi-select-large {
    transform: scale(1.3);
    transform-origin: right center;
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
          icon={<IconChevronLeft style={{ fontSize: 32 }} />} 
          theme="borderless" 
          onClick={() => navigate(-1)}
          style={{ padding: '12px', borderRadius: '50%' }}
        />
        <Title heading={1} style={{ fontSize: 60 }}>软件设置</Title>
      </div>
      
      <Text style={{ fontSize: 30, color: 'var(--semi-color-text-2)', marginLeft: '84px' }}>
        在这里调整你的 Omniflow 体验
      </Text>
      
      <Divider style={{ margin: '60px 0' }} />
      
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
        <Select defaultValue="zh-CN" style={{ width: 220 }} size="large">
          <Select.Option value="zh-CN">简体中文</Select.Option>
          <Select.Option value="en-US">English</Select.Option>
        </Select>
      </div>
      
      <Divider style={{ margin: '60px 0' }} />
      
      <div style={{ marginLeft: '4px' }}>
        <Title heading={2} style={{ fontSize: 40, marginBottom: 20 }}>关于</Title>
        <Text style={{ fontSize: 26 }}>Omniflow App v0.0.1</Text>
      </div>

      <div style={{ marginTop: 80, textAlign: 'center' }}>
        <Button 
          theme="solid" 
          type="tertiary" 
          size="large" 
          onClick={() => navigate(-1)}
          style={{ 
            fontSize: 24, 
            padding: '16px 48px', 
            height: 'auto',
            borderRadius: 12
          }}
        >
          退出设置
        </Button>
      </div>
    </SettingsWrapper>
  );
};

export default Settings;

