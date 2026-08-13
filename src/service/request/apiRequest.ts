import { API_CONFIG } from '@/config/api';
import { auth } from '@/utils/auth';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { clearAuthSessionAndDisposeWorkspaces } from '@/service/auth-session-release';

/**
 * 渲染进程直接请求封装
 * @param path API 路径
 * @param options fetch 选项
 */
export async function apiRequest(path: string, options?: RequestInit) {
  try {
    const token = auth.getToken();
    const headers = new Headers(options?.headers);

    if (!headers.has('Content-Type') && !(options?.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const username = auth.getUsername();
    if (username && !headers.has('username')) {
      headers.set('username', username);
    }

    const url = `${API_CONFIG.BASE_URL}${path}`;
    
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      // 处理 401 等错误
      if (response.status === 401) {
        runtimeLogger.warn('Unauthorized access');
        await clearAuthSessionAndDisposeWorkspaces({
          reason: `api 401 ${path}`,
          redirectToLogin: true,
        });
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    runtimeLogger.debug("📦 Direct Renderer 收到数据:", data);
    return data;
  } catch (err) {
    runtimeLogger.error('❌ Direct Renderer 请求失败:', err);
    throw err;
  }
}
