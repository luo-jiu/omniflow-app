import React, { ReactNode, useEffect, useRef, useState } from 'react';
import {Modal, Tree, Toast, Descriptions} from '@douyinfe/semi-ui';
import { ContextMenu } from './style';
import {uploadAndCreateNode} from "@/service/directory-sidebar.api.ts";

interface DirectoryTreeProps {
  treeData: any[];
  expandedKeys: string[];
  onExpand: (keys: string[]) => void;
  onDoubleClick: (e: React.MouseEvent, node: any) => void;
  // 上传成功后，通知父组件刷新某个节点
  onUploadSuccess?: (parentNode: any, newNode: any) => void;
}

/**
 * 计算目录树内容所需的最小宽度：
 * - 以整棵树中已经渲染的节点为准（不局限于当前可视范围）
 * - 使用真实文字宽度（而非容器）来决定 custom wrapper 的 min-width
 * - 一旦文字被遮挡，立刻提供横向滚动条，拖到最右刚好露出全部文字
 * - 分割线继续左拖时，文字宽度保持不动，仅拖拽条范围加大
 */
export default function DirectoryTree({
  treeData,
  expandedKeys,
  onExpand,
  onDoubleClick,
  onUploadSuccess,
}: DirectoryTreeProps) {
  // 外部文件拖拽：悬停高亮 & 延迟展开
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const expandTimerRef = useRef<number | null>(null);

  // 自定义菜单状态
  type MenuState = {
    open: boolean;
    x: number;
    y: number;
    node: any | null;
    isFolder: boolean;
  };
  const [menu, setMenu] = useState<MenuState>({
    open: false,
    x: 0,
    y: 0,
    node: null,
    isFolder: false,
  });

  // ✨ 新增：上传 Modal 的状态
  const [uploadModal, setUploadModal] = useState<{
    visible: boolean;
    file: File | null;
    targetNode: any | null; // 目标文件夹节点
    loading: boolean;
  }>({
    visible: false,
    file: null,
    targetNode: null,
    loading: false
  });

  // Tree 内容容器（可滚动内容层在 wrapper 中）
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // 为每个“可见行”的 label 与其内部文字 span 保持引用
  type RowRefs = { label: HTMLElement | null; text: HTMLElement | null };
  const rowRefs = useRef<Map<string, RowRefs>>(new Map());

  // 记录上一次应用到 wrapper 的 minWidth，避免 1px 抖动
  const lastAppliedWidthRef = useRef<number>(0);

  // 记录上一次的 expandedKeys
  const prevExpandedKeysRef = useRef<string[]>(expandedKeys);

  const H_REDUNDANCY_PX = 3;        // 极小冗余，避免边界像素抖动
  const FLOAT_EPS = 0.5;            // 浮点比较误差容忍
  const MAX_TEXT_WIDTH_CAP = 40000; // 兜底，避免异常节点导致极大宽度
  const ICON_BUFFER_PX = 16;        // 行内图标缓冲

  /** rAF 合并调度 */
  const rafIdRef = useRef<number | null>(null);
  const scheduleRecompute = () => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      recomputeRequiredWidth();
    });
  };

  /** 基于当前已经渲染的所有节点，计算内容所需的最小宽度 */
  const recomputeRequiredWidth = () => {
    const wrapper = wrapperRef.current;
    const container = wrapper?.parentElement;
    if (!wrapper || !container) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    let maxRightEdge = 0;

    rowRefs.current.forEach(({ label, text }) => {
      if (!label || !text) return;
      if (!label.isConnected || !text.isConnected) return;

      const labelRect = label.getBoundingClientRect();
      const leftInWrapper = labelRect.left - wrapperRect.left;

      // 文字天然宽度（不受容器 100% 影响），设置一个极端上限保险
      const contentWidth = Math.min(Math.ceil(text.scrollWidth) + ICON_BUFFER_PX, MAX_TEXT_WIDTH_CAP);

      // 给一点 label 的右侧 padding 余量（避免 1px 抖动）
      let padRight = 0;
      try {
        padRight = parseFloat(getComputedStyle(label).paddingRight || '0') || 0;
      } catch { /* empty */ }

      const rightEdge = leftInWrapper + contentWidth + padRight;
      if (rightEdge > maxRightEdge) {
        maxRightEdge = rightEdge;
      }
    });

    const needsHorizontalScroll = maxRightEdge > container.clientWidth + FLOAT_EPS;
    const desiredWidth = needsHorizontalScroll
      ? Math.ceil(maxRightEdge + H_REDUNDANCY_PX)
      : container.clientWidth;

    applyMinWidth(desiredWidth, container);
  };

  // 处理文件放置逻辑
  const handleExternalDropOnFolder = (treeNode: any, e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;

    // 目前为了简单，这里只处理第一个文件
    // 如果需要批量上传，可以将 file 设为数组
    const file = files[0];

    // 打开确认弹框
    setUploadModal({
      visible: true,
      file: file,
      targetNode: treeNode,
      loading: false
    });
  };

  // const handleExternalDropOnFolder = (treeNode: any, e: React.DragEvent) => {
  //   const files = Array.from(e.dataTransfer.files || []);
  //   if (!files.length) return;
  //   const payload = files.map((f: File) => ({
  //     name: f.name,
  //     size: f.size,
  //     type: f.type,
  //     // @ts-ignore (Electron File.path)
  //     path: (f as any).path,
  //   }));
  //   console.log('parent_id:', treeNode.id)
  //   console.log('📦 [UPLOAD_FILE_TO_FOLDER]', {
  //     targetFolderKey: treeNode.key,
  //     targetFolderName: (treeNode.data?.rawName ?? treeNode.label) || treeNode.key,
  //     files: payload,
  //   });
  //   console.log('✅ 模拟上传完成，待刷新目录：', treeNode.key);
  // };

  // 外部文件拖拽
  const isExternalFileDrag = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types || []);
    return types.includes('Files');
  };

  // 执行上传逻辑
  const handleConfirmUpload = async () => {
    const { file, targetNode } = uploadModal;
    console.log('upload', targetNode);
    if (!file || !targetNode) return;
    setUploadModal(prev => ({ ...prev, loading: true }));
    try {
      const newNode = await uploadAndCreateNode(file, targetNode.id, targetNode.libraryId);
      Toast.success('上传成功');
      // 关闭弹窗
      setUploadModal({ visible: false, file: null, targetNode: null, loading: false });
      // 关键一步：通知父组件刷新该节点
      if (onUploadSuccess) {
        onUploadSuccess(targetNode, newNode);
      }
    } catch (error) {
      console.error(error);
      Toast.error('上传失败，请重试');
      setUploadModal(prev => ({ ...prev, loading: false }));
    }
  };

  // 取消上传
  const handleCancelUpload = () => {
    setUploadModal({ visible: false, file: null, targetNode: null, loading: false });
  };

  /** 应用 minWidth 并夹紧 scrollLeft */
  const applyMinWidth = (targetWidth: number, container: HTMLElement) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // 不小于容器宽，否则可能出现反向闪烁
    const target = Math.max(container.clientWidth, targetWidth);
    if (Math.abs(target - lastAppliedWidthRef.current) < 1) return;

    lastAppliedWidthRef.current = target;
    wrapper.style.minWidth = `${Math.ceil(target)}px`;

    // 夹紧 scrollLeft，防止宽度缩小后残留在越界位置
    const maxScroll = Math.max(0, wrapper.scrollWidth - container.clientWidth);
    if (container.scrollLeft > maxScroll) {
      container.scrollLeft = maxScroll;
    }
  };

  /** 绑定 label & text 的 ref */
  const bindLabelRef = (key: string) => (el: HTMLElement | null) => {
    if (!el) {
      const prev = rowRefs.current.get(key);
      if (prev?.text) rowRefs.current.set(key, { label: null, text: prev.text });
      else rowRefs.current.delete(key);
      return;
    }
    const prev = rowRefs.current.get(key) ?? { label: null, text: null };
    rowRefs.current.set(key, { ...prev, label: el });
    scheduleRecompute();
  };
  const bindTextRef = (key: string) => (el: HTMLElement | null) => {
    if (!el) {
      const prev = rowRefs.current.get(key);
      if (prev?.label) rowRefs.current.set(key, { label: prev.label, text: null });
      else rowRefs.current.delete(key);
      return;
    }
    const prev = rowRefs.current.get(key) ?? { label: null, text: null };
    rowRefs.current.set(key, { ...prev, text: el });
    scheduleRecompute();
  };

  /** 把一行内容横向滚动到“完全可见”（绝对目标 scrollLeft，不抖动） */
  const ensureRowIntoViewHorizontally = (labelEl: HTMLElement) => {
    const wrapper = wrapperRef.current;
    const container = wrapper?.parentElement;
    if (!wrapper || !container) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const labelRect = labelEl.getBoundingClientRect();

    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;

    const leftInWrapper = (labelRect.left - wrapperRect.left) + viewLeft;
    const rightInWrapper = leftInWrapper + labelEl.scrollWidth;

    let target = viewLeft;
    if (rightInWrapper > viewRight) {
      target = rightInWrapper - container.clientWidth;
    } else if (leftInWrapper < viewLeft) {
      target = leftInWrapper;
    } else {
      return; // 已可见
    }

    const maxScroll = Math.max(0, wrapper.scrollWidth - container.clientWidth);
    container.scrollLeft = Math.min(Math.max(0, Math.round(target)), maxScroll);
  };

  // 懒加载展开修复：先触发 onDoubleClick 再展开
  const ensureLazyLoadThenExpand = (treeNode: any) => {
    try {
      const native = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
      onDoubleClick(native as unknown as React.MouseEvent, treeNode);
    } catch (err) {
      console.warn('onDoubleClick 触发懒加载失败（已忽略）：', err);
    }
    if (!expandedKeys.includes(treeNode.key)) {
      onExpand(Array.from(new Set([...expandedKeys, treeNode.key])));
    }
  };

  // 包装后的 onExpand：触发父回调后，下一帧仅以视口重算
  const handleExpand = (keys: string[]) => {
    // const prev = prevExpandedKeysRef.current;
    onExpand(keys);

    requestAnimationFrame(() => {
      scheduleRecompute(); // 只看视口，不会被未见内容影响
    });

    prevExpandedKeysRef.current = keys;
  };

  // 菜单行为（模拟）
  const simulateAction = (action: string, node: any) => {
    console.log(`👉 [${action}]`, node);
    Toast.info({ content: `模拟：${action}`, duration: 2 });
    setMenu(m => ({ ...m, open: false }));

    // 重命名/新建后，触发一次尺寸重算
    if (action === '重命名' || action.startsWith('新建')) {
      scheduleRecompute();
    }
  };

  const askDelete = (node: any) => {
    setMenu(m => ({ ...m, open: false }));
    Modal.confirm({
      title: '确认删除？',
      content: `将删除「${node.data?.rawName ?? node.label ?? node.key}」（模拟）`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        console.log('🗑️ [删除]', node);
        Toast.success({ content: '模拟删除完成', duration: 2 });
        scheduleRecompute();
      },
    });
  };

  // 打开菜单：使用鼠标位置，并把该行滚到可见
  const MENU_WIDTH = 380;
  const MENU_HEIGHT_GUESS = 260;
  const openMenuAtPointer = (e: React.MouseEvent, node: any, isFolder: boolean) => {
    e.preventDefault();
    e.stopPropagation();

    const labelEl = (e.currentTarget as HTMLElement);
    ensureRowIntoViewHorizontally(labelEl);

    let x = e.clientX + 8;
    let y = e.clientY + 8;

    x = Math.min(x, window.innerWidth - MENU_WIDTH - 12);
    y = Math.min(y, window.innerHeight - MENU_HEIGHT_GUESS - 12);
    y = Math.max(8, y);

    setMenu({ open: true, x, y, node, isFolder });
  };

  // 行 label 渲染
  const renderLabel = (label?: ReactNode, treeNode?: any): ReactNode => {
    if (!treeNode) return label;
    const isFolder = treeNode.isLeaf !== true;

    // 外部文件拖拽进入：高亮并延时 500ms 自动展开（先懒加载，再展开）
    const onDragEnter = (e: React.DragEvent) => {
      if (!isExternalFileDrag(e) || !isFolder) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOverKey(treeNode.key);

      if (!expandedKeys.includes(treeNode.key)) {
        if (expandTimerRef.current) {
          window.clearTimeout(expandTimerRef.current);
          expandTimerRef.current = null;
        }
        expandTimerRef.current = window.setTimeout(() => {
          ensureLazyLoadThenExpand(treeNode);
        }, 500);
      }
    };
    const onDragOver = (e: React.DragEvent) => {
      if (!isExternalFileDrag(e) || !isFolder) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const clearHover = () => {
      setDragOverKey(prev => (prev === treeNode.key ? null : prev));
      if (expandTimerRef.current) {
        window.clearTimeout(expandTimerRef.current);
        expandTimerRef.current = null;
      }
    };
    const onDragLeave = (e: React.DragEvent) => {
      if (!isExternalFileDrag(e) || !isFolder) return;
      e.stopPropagation();
      clearHover();
    };
    const onDrop = (e: React.DragEvent) => {
      if (!isExternalFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      clearHover();
      if (!isFolder) {
        console.log('⚠️ 目标是文件，忽略上传：请投递到文件夹节点');
        return;
      }
      handleExternalDropOnFolder(treeNode, e);
    };

    // 右键打开菜单
    const onContextMenu = (e: React.MouseEvent) => {
      openMenuAtPointer(e, treeNode, isFolder);
    };

    return (
      <div
        className={`tree-node-label ${dragOverKey === treeNode.key ? 'drag-over' : ''}`}
        ref={bindLabelRef(treeNode.key)}
        onContextMenu={onContextMenu}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        title={typeof label === 'string' ? label : undefined}
      >
        <span
          className="tree-node-text"
          ref={bindTextRef(treeNode.key)}
        >
          {label}
        </span>
      </div>
    );
  };

  // 初次挂载：首屏重算
  useEffect(() => {
    scheduleRecompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听容器滚动（横/纵），合并重算
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const container = wrapper?.parentElement;
    if (!container) return;

    const onScroll = () => scheduleRecompute();
    container.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', onScroll as EventListener);
    };
  }, []);

  // ResizeObserver：容器/内容尺寸变化时重算
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const container = wrapper?.parentElement;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(() => scheduleRecompute());
    ro.observe(container);
    ro.observe(wrapper!); // 字体或缩放引起 wrapper 尺寸微调时也重算

    return () => ro.disconnect();
  }, []);

  // 全局关闭菜单事件
  useEffect(() => {
    const closeMenu = () => setMenu(m => ({ ...m, open: false }));
    const onDocMouseDown = () => closeMenu();
    const onScroll = () => closeMenu();
    const onResize = () => closeMenu();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };

    document.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className="tree-container">
      <div className="custom-tree-wrapper" ref={wrapperRef}>
        <Tree
          draggable
          onDragStart={(info) => console.log('开始拖拽', info)}
          onDragEnd={(info) => console.log('拖拽结束', info)}
          onDrop={(info) => {
            console.log('放下节点', info);
            // TODO: 根据 info.dropToGap / info.dropPosition 更新 treeData
          }}
          className="custom-tree"
          treeData={treeData}
          expandedKeys={expandedKeys}
          onExpand={handleExpand}
          onDoubleClick={onDoubleClick}
          directory
          renderLabel={renderLabel}
          style={{ padding: 8 }}
        />
      </div>

      {/* 自绘大卡片菜单（fixed） */}
      {menu.open && menu.node ? (
        menu.isFolder ? (
          <ContextMenu
            style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="menu-title">文件夹操作</div>
            <div className="menu-item" onClick={() => simulateAction('重命名', menu.node)}>重命名</div>
            <div className="menu-item" onClick={() => simulateAction('新建文件', menu.node)}>新建文件</div>
            <div className="menu-item" onClick={() => simulateAction('新建文件夹', menu.node)}>新建文件夹</div>
            <div className="menu-item danger" onClick={() => askDelete(menu.node)}>删除</div>
          </ContextMenu>
        ) : (
          <ContextMenu
            style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="menu-title">文件操作</div>
            <div className="menu-item" onClick={() => simulateAction('重命名', menu.node)}>重命名</div>
            <div className="menu-item" onClick={() => simulateAction('属性', menu.node)}>属性</div>
            <div className="menu-item danger" onClick={() => askDelete(menu.node)}>删除</div>
          </ContextMenu>
        )
      ) : null}
      <Modal
        title="文件上传确认"
        visible={uploadModal.visible}
        onOk={handleConfirmUpload}
        onCancel={handleCancelUpload}
        confirmLoading={uploadModal.loading}
        okText="确定上传"
        cancelText="取消"
        maskClosable={false} // 防止误触关闭
      >
        {uploadModal.file && uploadModal.targetNode && (
          <div style={{ padding: '10px 0' }}>
            <Descriptions align="center" size="small" row>
              <Descriptions.Item itemKey="文件名">
                <strong>{uploadModal.file.name}</strong>
              </Descriptions.Item>
              <Descriptions.Item itemKey="文件大小">
                {/* 简单的字节转换 */}
                {(uploadModal.file.size / 1024).toFixed(2)} KB
              </Descriptions.Item>
              <Descriptions.Item itemKey="上传位置">
                📂 {uploadModal.targetNode.label}
              </Descriptions.Item>
            </Descriptions>

            <div style={{ marginTop: 12, color: 'var(--semi-color-text-2)', fontSize: 12 }}>
              <p>即将上传文件到上述目录，是否继续？</p>
              {/* 这里可以展示后端接口需要的 path 预览 */}
              <code style={{ background: '#f5f5f5', padding: '2px 4px', borderRadius: 4 }}>
                Path: {uploadModal.targetNode.data?.rawName || 'root'}/{uploadModal.file.name}
              </code>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
