import { useState, useRef, useCallback, useEffect } from 'react';

export function useResizableSidebar(initialWidth = 440, minWidth = 150) {
  const [width, setWidth] = useState(initialWidth);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setMaxWidth] = useState(700); // 初始值，会在窗口大小变化时更新

  // 计算最大宽度：窗口宽度的80%
  const updateMaxWidth = useCallback(() => {
    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const maxAbsolutePosition = windowWidth * 0.8;
      // 相对于容器的最大宽度
      const newMaxWidth = maxAbsolutePosition - containerRect.left;
      setMaxWidth(newMaxWidth);
      // 如果当前宽度超过新的最大宽度，则调整到最大宽度
      setWidth(prevWidth => {
        if (prevWidth > newMaxWidth) {
          return newMaxWidth;
        }
        return prevWidth;
      });
    }
  }, []);

  // 监听窗口大小变化
  useEffect(() => {
    updateMaxWidth();
    window.addEventListener('resize', updateMaxWidth);
    return () => {
      window.removeEventListener('resize', updateMaxWidth);
    };
  }, [updateMaxWidth]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      // 计算分割线的绝对位置（相对于窗口左边）
      const absolutePosition = e.clientX;
      // 最大位置：窗口宽度的80%
      const maxAbsolutePosition = window.innerWidth * 0.8;
      // 相对于容器的最大宽度
      const maxWidthRelative = maxAbsolutePosition - containerRect.left;
      if (newWidth >= minWidth && newWidth <= maxWidthRelative && absolutePosition <= maxAbsolutePosition) {
        setWidth(newWidth);
      }
    },
    [isDragging, minWidth]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = '';
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return { width, isDragging, containerRef, handleMouseDown };
}