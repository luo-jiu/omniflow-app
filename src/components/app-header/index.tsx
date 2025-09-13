import { FC, useState, useEffect } from 'react';
import {HeaderWrapper, ThemeToggleButton} from './style';
import { Button } from '@douyinfe/semi-ui';
import {IconMoon, IconSun, IconMinus, IconStop, IconClose} from '@douyinfe/semi-icons';

declare global {
  interface Window {
    electronWindow: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
  }
}

const AppHeader: FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const saved = localStorage.getItem('app-theme') || 'light';
    setTheme(saved as 'light' | 'dark');
    document.body.setAttribute('theme-mode', saved);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.body.setAttribute('theme-mode', newTheme);
    localStorage.setItem('app-theme', newTheme);
  };

  return (
    <HeaderWrapper>
      <div className="content">
        <h1>顶部工具栏</h1>
        <div className="right-controls">
          <ThemeToggleButton onClick={toggleTheme} theme="borderless" icon={theme === 'light' ? <IconMoon /> : <IconSun />}>
            {theme === 'light' ? '暗色模式' : '浅色模式'}
          </ThemeToggleButton>
          <Button
            onClick={() => window.electronWindow.minimize()}
            theme="borderless"
            size="large" // 点击范围大
            icon={<IconMinus style={{ fontSize: 20 }} />} // 图标更大
          />
          <Button
            onClick={() => window.electronWindow.maximize()}
            theme="borderless"
            size="large"
            icon={<IconStop style={{ fontSize: 20 }} />}
          />
          <Button
            onClick={() => window.electronWindow.close()}
            theme="borderless"
            size="large"
            icon={<IconClose style={{ fontSize: 20 }} />}
          />
        </div>
      </div>
    </HeaderWrapper>
  );
};

export default AppHeader;