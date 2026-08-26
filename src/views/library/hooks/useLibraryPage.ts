import { useState, useEffect, useCallback, useRef } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import {
  fetchRepositories,
  createLibrary,
  deleteLibrary,
  renameLibrary,
  toggleLibraryStar
} from "@/features/file-explorer/services/file.api";
import type { Library } from "@/features/file-explorer/services/file.api";
import { runtimeLogger } from '@/utils/runtimeLogger';

export function useLibraryPage() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(false);
  const listRequestSequenceRef = useRef(0);
  const libraryMutationVersionRef = useRef(0);
  const pendingStarMutationCountRef = useRef(0);
  const starMutationSequenceRef = useRef(new Map<number, number>());

  const loadLibraries = useCallback(async () => {
    const requestSequence = ++listRequestSequenceRef.current;
    const mutationVersion = libraryMutationVersionRef.current;
    setLoading(true);
    try {
      const list = await fetchRepositories();
      if (
        requestSequence !== listRequestSequenceRef.current
        || mutationVersion !== libraryMutationVersionRef.current
        || pendingStarMutationCountRef.current > 0
      ) return;
      setLibraries(list);
    } catch (error) {
      if (
        requestSequence !== listRequestSequenceRef.current
        || mutationVersion !== libraryMutationVersionRef.current
        || pendingStarMutationCountRef.current > 0
      ) return;
      runtimeLogger.error('Failed to fetch libraries:', error);
      Toast.error('获取库列表失败');
    } finally {
      if (requestSequence === listRequestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadLibraries();
  }, [loadLibraries]);

  const handleCreateLibrary = async (name: string) => {
    try {
      await createLibrary({ userId: 0, name });
      libraryMutationVersionRef.current += 1;
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
      libraryMutationVersionRef.current += 1;
      setLibraries(list => list.filter(l => l.id !== id));
      Toast.success('删除成功');
      return true;
    } catch (error) {
      runtimeLogger.error('Failed to delete library:', error);
      Toast.error('删除失败');
      return false;
    }
  };

  const handleRenameLibrary = async (id: number, name: string) => {
    try {
      await renameLibrary(id, name);
      libraryMutationVersionRef.current += 1;
      setLibraries(list =>
        list.map(l =>
          l.id === id
            ? { ...l, name, updatedAt: new Date().toISOString() }
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

  const toggleStar = async (library: Library) => {
    const nextStarred = !library.starred;
    const previousStarred = library.starred;
    const mutationSequence = (starMutationSequenceRef.current.get(library.id) || 0) + 1;
    starMutationSequenceRef.current.set(library.id, mutationSequence);
    pendingStarMutationCountRef.current += 1;
    libraryMutationVersionRef.current += 1;
    setLibraries(list => list.map(l => (l.id === library.id ? { ...l, starred: nextStarred } : l)));

    try {
      await toggleLibraryStar(library.id, nextStarred);
      libraryMutationVersionRef.current += 1;
      if (starMutationSequenceRef.current.get(library.id) !== mutationSequence) return;
      setLibraries(list => list.map(l => (
        l.id === library.id ? { ...l, starred: nextStarred } : l
      )));
      starMutationSequenceRef.current.delete(library.id);
    } catch (error) {
      libraryMutationVersionRef.current += 1;
      if (starMutationSequenceRef.current.get(library.id) !== mutationSequence) return;
      setLibraries(list => list.map(l => (l.id === library.id ? { ...l, starred: previousStarred } : l)));
      starMutationSequenceRef.current.delete(library.id);
      runtimeLogger.error('Failed to toggle library star:', error);
      Toast.error(nextStarred ? '收藏失败' : '取消收藏失败');
    } finally {
      pendingStarMutationCountRef.current = Math.max(0, pendingStarMutationCountRef.current - 1);
    }
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
