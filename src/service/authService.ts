import { apiRequest } from './request/apiRequest';
import { auth } from '@/utils/auth';
import { runtimeLogger } from '@/utils/runtimeLogger';

/**
 * 临时登录服务
 * 用于硬编码账号密码自动请求获取 token 和 username
 */
export const loginService = {
  /**
   * 执行自动登录
   * 调用此方法即可完成登录并保存 token/username
   */
  async autoLogin() {
    // 硬编码的登录信息
    const loginData = {
      username: 'LJ',
      password: '123456'
    };

    try {
      runtimeLogger.info('开始自动登录...', loginData.username);
      const res = await apiRequest('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginData)
      });

      const token = res.token || res.data?.token;
      if (token) {
        // 保存 Token
        auth.setToken(token);
        
        // 保存 Username
        // 如果后端返回了 username 则使用后端的，否则使用请求时的
        const username = res.username || res.data?.username || loginData.username;
        auth.setUsername(username);
        
        // 如果有完整用户信息也可以保存
        if (res.userInfo || res.data?.userInfo) {
          auth.setUserInfo(res.userInfo || res.data?.userInfo);
        }

        runtimeLogger.info('✅ 自动登录成功');
        runtimeLogger.debug('Token:', token);
        runtimeLogger.debug('Username:', username);
        return true;
      } else {
        runtimeLogger.error('❌ 登录响应中未找到 Token', res);
        return false;
      }
    } catch (error) {
      runtimeLogger.error('❌ 自动登录请求失败:', error);
      return false;
    }
  },

  /**
   * 执行手动登录
   */
  async login(username: string, password: string) {
    try {
      const res = await apiRequest('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });

      const token = res.token || res.data?.token;
      if (token) {
        auth.setToken(token);
        const finalUsername = res.username || res.data?.username || username;
        auth.setUsername(finalUsername);
        
        const userInfo = res.userInfo || res.data?.userInfo || { username: finalUsername };
        auth.setUserInfo(userInfo);

        return { success: true, userInfo };
      }
      return { success: false, message: res.message || '登录失败' };
    } catch (error: any) {
      runtimeLogger.error('❌ 登录请求失败:', error);
      return { success: false, message: error.message || '服务器错误' };
    }
  },

  /**
   * 注册用户
   */
  async register(payload: {
    username: string;
    password: string;
    email?: string;
    phone?: string;
  }) {
    try {
      const res = await apiRequest('/v1/user', {
        method: 'POST',
        body: JSON.stringify({
          username: payload.username,
          password: payload.password,
          email: payload.email || '',
          phone: payload.phone || '',
        }),
      });

      if (res?.success === false) {
        return { success: false, message: res?.message || '注册失败' };
      }
      return { success: true };
    } catch (error: any) {
      runtimeLogger.error('❌ 注册请求失败:', error);
      return { success: false, message: error.message || '服务器错误' };
    }
  }
};
