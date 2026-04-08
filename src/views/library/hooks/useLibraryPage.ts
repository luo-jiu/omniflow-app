import { useState, useEffect, useCallback } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import {
  fetchRepositories,
  createLibrary,
  deleteLibrary,
  toggleLibraryStar
} from "@/features/file-explorer/services/file.api";
import type { Library } from "@/features/file-explorer/services/file.api";
import { runtimeLogger } from '@/utils/runtimeLogger';

export function useLibraryPage() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(false);

  const loadLibraries = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchRepositories();
      setLibraries(list);
    } catch (error) {
      runtimeLogger.error('Failed to fetch libraries:', error);
      Toast.error('获取库列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLibraries();
  }, [loadLibraries]);

  const handleCreateLibrary = async (name: string) => {
    try {
      await createLibrary({ userId: 0, name });
      await loadLibraries();
      Toast.success('已创建');
      return true;
    } catch (error) {
      runtimeLogger.error('Failed to create library:', error);
      Toast.error('创建库失败');
      return false;
    }
  };

  const handleDeleteLibrary = async (id: number) => {
    try {
      await deleteLibrary(id);
      setLibraries(list => list.filter(l => l.id !== id));
      Toast.success('删除成功');
      return true;
    } catch (error) {
      runtimeLogger.error('Failed to delete library:', error);
      Toast.error('删除失败');
      return false;
    }
  };

  const applyLocalLibraryEdit = (id: number, payload: { name: string; starred: boolean }) => {
    setLibraries(list =>
      list.map(l =>
        l.id === id
          ? { ...l, name: payload.name, starred: payload.starred, updatedAt: new Date().toISOString() }
          : l
      )
    );
  };

  const toggleStar = async (library: Library) => {
    const nextStarred = !library.starred;
    const previousStarred = library.starred;
    setLibraries(list => list.map(l => (l.id === library.id ? { ...l, starred: nextStarred } : l)));

    try {
      await toggleLibraryStar(library.id, nextStarred);
    } catch (error) {
      setLibraries(list => list.map(l => (l.id === library.id ? { ...l, starred: previousStarred } : l)));
      runtimeLogger.error('Failed to toggle library star:', error);
      Toast.error(nextStarred ? '收藏失败' : '取消收藏失败');
    }
  };

  return {
    libraries,
    loading,
    loadLibraries,
    handleCreateLibrary,
    handleDeleteLibrary,
    applyLocalLibraryEdit,
    toggleStar,
  };
}
