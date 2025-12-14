import { API_CONFIG } from '@/config/api';
import { auth } from '@/utils/auth';

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
        // 可以触发登出逻辑，或者抛出特定错误
        console.warn('Unauthorized access');
        auth.removeToken();
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("📦 Direct Renderer 收到数据:", data);
    return data;
  } catch (err) {
    console.error('❌ Direct Renderer 请求失败:', err);
    throw err;
  }
}

