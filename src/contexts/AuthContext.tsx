import React, { useState, useEffect, ReactNode } from 'react';
import { auth } from '@/utils/auth';
import { loginService } from '@/service/authService';
import { AuthContext, type User } from './auth.context';
import { fetchCurrentUserProfile } from '@/features/user/services/user.api';
import { runtimeLogger } from '@/utils/runtimeLogger';

function mergeUserWithProfile(profile: {
  id?: number;
  username?: string;
  nickname?: string;
  avatar?: string | null;
  ext?: string | null;
  email?: string;
  phone?: string;
}, fallback?: User | null): User {
  const nextUser: User = {
    ...(fallback || {}),
    id: profile.id ?? fallback?.id,
    username: profile.username || fallback?.username || '',
    nickname: profile.nickname || fallback?.nickname,
    avatar: profile.avatar || fallback?.avatar,
    ext: profile.ext || fallback?.ext,
    email: profile.email ?? fallback?.email,
    phone: profile.phone ?? fallback?.phone,
  };
  if (!nextUser.username) {
    nextUser.username = auth.getUsername() || '';
  }
  return nextUser;
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;

    const bootstrapAuthState = async () => {
      const userInfo = auth.getUserInfo();
      const token = auth.getToken();

      if (!token) {
        if (!disposed) {
          setLoading(false);
        }
        return;
      }

      if (userInfo && !disposed) {
        setUser(userInfo);
      }

      try {
        const profile = await fetchCurrentUserProfile();
        if (disposed) {
          return;
        }
        const mergedUser = mergeUserWithProfile(profile, userInfo);
        auth.setUserInfo(mergedUser);
        setUser(mergedUser);
      } catch (error) {
        runtimeLogger.warn('refresh current user profile failed, fallback to local cache', error);
        if (!disposed && !userInfo) {
          const fallbackUsername = auth.getUsername();
          if (fallbackUsername) {
            const fallbackUser = { username: fallbackUsername } as User;
            auth.setUserInfo(fallbackUser);
            setUser(fallbackUser);
          }
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void bootstrapAuthState();
    return () => {
      disposed = true;
    };
  }, []);

  const login = async (username: string, password: string) => {
    const result = await loginService.login(username, password);
    if (result.success) {
      let nextUser = (result.userInfo || { username }) as User;
      try {
        const profile = await fetchCurrentUserProfile();
        nextUser = mergeUserWithProfile(profile, nextUser);
      } catch (error) {
        runtimeLogger.warn('fetch profile after login failed, fallback to login response', error);
      }
      auth.setUserInfo(nextUser);
      setUser(nextUser);
      return { success: true };
    }
    return { success: false, message: result.message };
  };

  const setUserInfo = (userInfo: User | null) => {
    if (userInfo) {
      auth.setUserInfo(userInfo);
      setUser(userInfo);
      return;
    }
    auth.removeUserInfo();
    setUser(null);
  };

  const register = async (payload: {
    username: string;
    password: string;
    email?: string;
    phone?: string;
  }) => {
    const result = await loginService.register(payload);
    if (result.success) {
      return { success: true };
    }
    return { success: false, message: result.message };
  };

  const logout = () => {
    auth.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoggedIn: !!user, login, register, setUserInfo, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
