import { FC, useState, useEffect } from 'react';
import { HeaderWrapper } from './style';
import { Button } from '@douyinfe/semi-ui';

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
        <Button onClick={toggleTheme} theme="borderless">
          {theme === 'light' ? '🌙 暗色模式' : '☀️ 浅色模式'}
        </Button>
      </div>
    </HeaderWrapper>
  );
};

export default AppHeader;