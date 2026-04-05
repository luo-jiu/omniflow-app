import { useState, useEffect, useCallback } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import {
  fetchRepositories,
  createLibrary,
  deleteLibrary,
  renameLibrary
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

  const handleRenameLibrary = async (id: number, newName: string) => {
    try {
      await renameLibrary(id, newName);
      setLibraries(list =>
        list.map(l =>
          l.id === id
            ? { ...l, name: newName, updatedAt: new Date().toISOString() }
            : l
        )
      );
      Toast.success('重命名成功');
      return true;
    } catch (error) {
      runtimeLogger.error('Failed to rename library:', error);
      Toast.error('重命名失败');
      return false;
    }
  };

  const toggleStar = (library: Library) => {
    setLibraries(list => list.map(l => (l.id === library.id ? { ...l, starred: !l.starred } : l)));
  };

  return {
    libraries,
    loading,
    loadLibraries,
    handleCreateLibrary,
    handleDeleteLibrary,
    handleRenameLibrary,
    toggleStar,
  };
}
