import React, { useState, useEffect, ReactNode } from 'react';
import { auth } from '@/utils/auth';
import { loginService } from '@/service/authService';
import { AuthContext, type User } from './auth.context';

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const userInfo = auth.getUserInfo();
    const token = auth.getToken();
    if (token && userInfo) {
      setUser(userInfo);
    }
    setLoading(false);
  }, []);

  const login = async (username: string, password: string) => {
    const result = await loginService.login(username, password);
    if (result.success) {
      setUser(result.userInfo);
      return { success: true };
    }
    return { success: false, message: result.message };
  };

  const logout = () => {
    auth.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoggedIn: !!user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
