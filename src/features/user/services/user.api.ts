import { ipcRequest as request, ipcUpload } from '@/service/request/ipcRequest';

export type UserProfile = {
  id: number;
  username: string;
  nickname?: string;
  phone?: string;
  email?: string;
  ext?: string | null;
  avatar?: string | null;
};

function unwrapData<T>(body: any): T {
  return (body?.data ?? body) as T;
}

export async function fetchCurrentUserProfile(): Promise<UserProfile> {
  const body = await request('/v1/user/me', { method: 'GET' });
  return unwrapData<UserProfile>(body);
}

export async function updateCurrentUserProfile(payload: {
  nickname?: string;
  ext?: string | null;
}): Promise<UserProfile> {
  const body = await request('/v1/user/me', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return unwrapData<UserProfile>(body);
}

export async function updateCurrentUserPassword(payload: {
  oldPassword: string;
  newPassword: string;
}): Promise<void> {
  await request('/v1/user/me/password', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function uploadCurrentUserAvatar(file: File): Promise<UserProfile> {
  const filePath = (file as any).path;
  if (!filePath) {
    throw new Error('未获取到头像文件路径');
  }
  const body = await ipcUpload('/v1/user/me/avatar', filePath, {});
  return unwrapData<UserProfile>(body);
}

export function parseUserExt(ext: string | null | undefined): Record<string, unknown> {
  if (!ext || typeof ext !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(ext);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
