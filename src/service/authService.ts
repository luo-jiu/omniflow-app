import { apiRequest } from './request/apiRequest';
import { auth } from '@/utils/auth';

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
      console.log('开始自动登录...', loginData.username);
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

        console.log('✅ 自动登录成功');
        console.log('Token:', token);
        console.log('Username:', username);
        return true;
      } else {
        console.error('❌ 登录响应中未找到 Token', res);
        return false;
      }
    } catch (error) {
      console.error('❌ 自动登录请求失败:', error);
      return false;
    }
  }
};
