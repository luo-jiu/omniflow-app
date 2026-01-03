import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { auth } from '@/utils/auth';
import { loginService } from '@/service/authService';

interface User {
  username: string;
  avatar?: string;
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  isLoggedIn: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

