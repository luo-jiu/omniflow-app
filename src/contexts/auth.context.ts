import { createContext } from 'react';

export interface User {
  username: string;
  nickname?: string;
  avatar?: string;
  ext?: string;
  [key: string]: any;
}

export interface AuthContextType {
  user: User | null;
  isLoggedIn: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
  register: (payload: {
    username: string;
    password: string;
    email?: string;
    phone?: string;
  }) => Promise<{ success: boolean; message?: string }>;
  setUserInfo: (userInfo: User | null) => void;
  logout: () => Promise<void>;
  loading: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
