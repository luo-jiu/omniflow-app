import { useCallback, useEffect, useRef, useState } from 'react';
import { queryLibraryTags, type LibraryTagPage } from '../services/tag.api';

export function useDebouncedTagKeyword(value: string): string {
  const [keyword, setKeyword] = useState(value.trim());
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);
  return keyword;
}

const EMPTY_PAGE: LibraryTagPage = { entries: [], hasMore: false };

/** A bounded page and cursor history; never materializes the complete library catalog. */
export function useLibraryTagPage(input: {
  libraryId?: number; keyword?: string; dimension?: string; enabled?: boolean; active?: boolean;
}) {
  const { libraryId, keyword, dimension, enabled, active = true } = input;
  const key = JSON.stringify([libraryId, keyword, dimension, enabled, active]);
  const [navigation, setNavigation] = useState({ key, cursors: [''], index: 0 });
  useEffect(() => {
    setNavigation(current => current.key === key ? current : { key, cursors: [''], index: 0 });
  }, [key]);
  const cursors = navigation.key === key ? navigation.cursors : [''];
  const pageIndex = navigation.key === key ? navigation.index : 0;
  const cursor = cursors[pageIndex];
  const [revision, setRevision] = useState(0);
  const requestKey = JSON.stringify([key, cursor, revision]);
  const currentKey = useRef(requestKey);
  currentKey.current = requestKey;
  const [state, setState] = useState({ key: '', page: EMPTY_PAGE, loading: false, error: '' });

  useEffect(() => {
    if (!libraryId || !active) return;
    let disposed = false;
    setState({ key: requestKey, page: EMPTY_PAGE, loading: true, error: '' });
    queryLibraryTags({ libraryId, keyword, dimension, enabled, limit: 50, cursor: cursor || undefined })
      .then(page => {
        if (!disposed && currentKey.current === requestKey) {
          setState({ key: requestKey, page, loading: false, error: '' });
        }
      })
      .catch((error: unknown) => {
        if (!disposed && currentKey.current === requestKey) {
          setState({ key: requestKey, page: EMPTY_PAGE, loading: false,
            error: error instanceof Error ? error.message : '加载标签失败' });
        }
      });
    return () => { disposed = true; };
  }, [libraryId, keyword, dimension, enabled, active, cursor, requestKey]);

  const current = state.key === requestKey ? state : { page: EMPTY_PAGE, loading: Boolean(libraryId && active), error: '' };
  const next = () => {
    if (current.loading || !current.page.hasMore || !current.page.nextCursor) return;
    setNavigation({ key, cursors: [...cursors.slice(0, pageIndex + 1), current.page.nextCursor], index: pageIndex + 1 });
  };
  const previous = () => {
    if (!current.loading && pageIndex > 0) setNavigation({ key, cursors, index: pageIndex - 1 });
  };
  const reload = useCallback(() => {
    setNavigation({ key, cursors: [''], index: 0 });
    setRevision(value => value + 1);
  }, [key]);
  return { ...current.page, loading: current.loading, error: current.error, pageIndex, next, previous, reload };
}
