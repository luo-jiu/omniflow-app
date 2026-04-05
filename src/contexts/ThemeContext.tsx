import React, { useState, useEffect, ReactNode } from 'react';
import { ThemeContext, type ThemeMode } from './theme.context';

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>('light');

  // 初始化主题
  useEffect(() => {
    const savedTheme = localStorage.getItem('app-theme') as ThemeMode || 'light';
    applyTheme(savedTheme);
  }, []);

  const applyTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    document.body.setAttribute('theme-mode', mode);
    localStorage.setItem('app-theme', mode);
  };

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
  };

  const setTheme = (mode: ThemeMode) => {
    applyTheme(mode);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
