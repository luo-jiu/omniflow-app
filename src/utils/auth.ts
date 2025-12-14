import { storage } from './storage';

const TOKEN_KEY = 'AUTH_TOKEN';
const USERNAME_KEY = 'AUTH_USERNAME';
const USER_INFO_KEY = 'USER_INFO';

/**
 * 认证相关工具函数
 */
export const auth = {
  // 获取 Token
  getToken(): string | null {
    return storage.get(TOKEN_KEY);
  },

  // 设置 Token
  setToken(token: string) {
    storage.set(TOKEN_KEY, token);
  },

  // 清除 Token
  removeToken() {
    storage.remove(TOKEN_KEY);
  },

  // 获取 Username
  getUsername(): string | null {
    return storage.get(USERNAME_KEY);
  },

  // 设置 Username
  setUsername(username: string) {
    storage.set(USERNAME_KEY, username);
  },

  // 清除 Username
  removeUsername() {
    storage.remove(USERNAME_KEY);
  },

  // 获取用户信息
  getUserInfo(): any {
    return storage.get(USER_INFO_KEY);
  },

  // 设置用户信息
  setUserInfo(userInfo: any) {
    storage.set(USER_INFO_KEY, userInfo);
    // 如果用户信息中有 username，也顺便设置一下
    if (userInfo?.username) {
      this.setUsername(userInfo.username);
    }
  },

  // 清除用户信息
  removeUserInfo() {
    storage.remove(USER_INFO_KEY);
  },

  // 清除所有认证信息
  clear() {
    this.removeToken();
    this.removeUsername();
    this.removeUserInfo();
  }
};


