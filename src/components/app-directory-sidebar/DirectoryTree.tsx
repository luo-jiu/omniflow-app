import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { Modal, Tree, Toast, Input, Popover, Popconfirm } from '@douyinfe/semi-ui';
import { MenuContent } from './style';
import { createNode, deleteNodeAndChildren, renameNode } from "@/service/directory-sidebar.api.ts";
import { uploadManager } from '@/utils/upload-manager';

interface DirectoryTreeProps {
  treeData: any[];
  expandedKeys: string[];
  onExpand: (keys: string[]) => void;
  onDoubleClick: (e: React.MouseEvent, node: any) => void;
  // 上传成功后，通知父组件刷新某个节点
  onUploadSuccess?: (parentNode: any, newNode: any) => void;
  // 删除成功后，通知父组件刷新（通常刷新父节点或整树）
  // deletedNodeKey 是节点的 key，格式为 `${parentId}:${id}`
  onDeleteSuccess?: (parentNode: any, deletedNodeKey: string) => void;
  // 重命名成功后的回调
  onRenameSuccess?: (nodeKey: string, newName: string) => void;
  libraryId: number; // 添加 libraryId prop
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
  onDeleteSuccess,
  onRenameSuccess,
  libraryId,
}: DirectoryTreeProps) {
  // 外部文件拖拽：悬停高亮 & 延迟展开
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const expandTimerRef = useRef<number | null>(null);

  // 菜单状态
  const [menuState, setMenuState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    node: any | null; // null 表示根目录
    isFolder: boolean;
  }>({
    visible: false,
    x: 0,
    y: 0,
    node: null,
    isFolder: false,
  });

  // 上传 Modal 的状态
  const [uploadModal, setUploadModal] = useState<{
    visible: boolean;
    files: File[]; // 支持多文件
    targetNode: any | null; // 目标文件夹节点
    loading: boolean;
  }>({
    visible: false,
    files: [],
    targetNode: null,
    loading: false
  });

  // 新建文件/文件夹 Modal 的状态
  const [createModal, setCreateModal] = useState<{
    visible: boolean;
    type: 'file' | 'dir' | null;
    parentNode: any | null; // 父节点，null 表示根目录
    name: string;
    loading: boolean;
  }>({
    visible: false,
    type: null,
    parentNode: null,
    name: '',
    loading: false,
  });

  // 内联编辑状态（重命名用）
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');

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

    // 打开确认弹框
    setUploadModal({
      visible: true,
      files: files,
      targetNode: treeNode,
      loading: false
    });
  };

  // 外部文件拖拽
  const isExternalFileDrag = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types || []);
    return types.includes('Files');
  };

  // 执行上传逻辑
  const handleConfirmUpload = async () => {
    const { files, targetNode } = uploadModal;
    if (!files.length || !targetNode) return;
    setUploadModal(prev => ({ ...prev, loading: true }));
    
    try {
      const tasks = files.map(file => ({
        file,
        parentId: targetNode.id,
        libraryId: targetNode.libraryId
      }));

      const results = await uploadManager.uploadFiles(tasks, (newNode) => {
        // 每个文件上传成功后，立即通知父组件刷新该节点（实时反馈）
        if (onUploadSuccess) {
          onUploadSuccess(targetNode, newNode);
        }
      });

      const failedCount = results.filter(r => r.status === 'rejected').length;
      if (failedCount === 0) {
        Toast.success(`成功上传 ${files.length} 个文件`);
      } else if (failedCount < files.length) {
        Toast.warning(`部分上传成功：成功 ${files.length - failedCount} 个，失败 ${failedCount} 个`);
      } else {
        Toast.error('全部文件上传失败');
      }

      // 关闭弹窗
      setUploadModal({ visible: false, files: [], targetNode: null, loading: false });
    } catch (error) {
      console.error(error);
      Toast.error('上传过程中出现未知错误');
      setUploadModal(prev => ({ ...prev, loading: false }));
    }
  };

  // 取消上传
  const handleCancelUpload = () => {
    setUploadModal({ visible: false, files: [], targetNode: null, loading: false });
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

  // 菜单行为
  const handleAction = async (action: string, node: any) => {
    // 关闭菜单
    setMenuState(prev => ({ ...prev, visible: false }));

    if (action === '新建文件') {
      setCreateModal({
        visible: true,
        type: 'file',
        parentNode: node,
        name: '',
        loading: false,
      });
    } else if (action === '新建文件夹') {
      setCreateModal({
        visible: true,
        type: 'dir',
        parentNode: node,
        name: '',
        loading: false,
      });
    } else if (action === '重命名') {
      setEditingKey(node.key);
      setEditingName(node.data?.rawName || node.label || '');
    } else if (action === 'delete') {
      try {
        console.log('🗑️ [删除]', node);
        // node.id 是 ancestorId
        await deleteNodeAndChildren(node.id, libraryId);
        Toast.success('删除成功');
        
        // 通知父组件从本地 treeData 中移除节点
        // 直接传递 node.key，这样父组件可以直接删除，不需要查找
        if (onDeleteSuccess) {
          // 构造成一个类 parent 结构，或者传 null
          const dummyParent = node.parentId ? { id: node.parentId } : { id: 1, key: 'root' }; 
          // 传递 node.key 而不是 node.id，这样父组件可以直接删除
          onDeleteSuccess(dummyParent, node.key);
        }
        
        scheduleRecompute();
      } catch (error) {
        console.error(error);
        Toast.error('删除失败');
      }
    } else {
      // 其他操作暂时模拟
      console.log(`👉 [${action}]`, node);
      Toast.info({ content: `模拟：${action}`, duration: 2 });
    }
  };

  // 确认创建文件/文件夹
  const handleConfirmCreate = async () => {
    const { type, parentNode, name } = createModal;
    if (!type || !name.trim()) {
      Toast.warning('请输入名称');
      return;
    }

    setCreateModal(prev => ({ ...prev, loading: true }));
    try {
      // 根目录的 parentId 为 1
      const parentId = parentNode ? parentNode.id : 1;
      const newNode = await createNode({
        name: name.trim(),
        parentId,
        libraryId,
        type,
      });
      
      Toast.success(`${type === 'dir' ? '文件夹' : '文件'}创建成功`);
      setCreateModal({ visible: false, type: null, parentNode: null, name: '', loading: false });
      
      // 通知父组件刷新
      if (onUploadSuccess) {
        onUploadSuccess(parentNode || { id: 1, key: 'root' }, newNode);
      }
      
      scheduleRecompute();
    } catch (error: any) {
      console.error(error);
      Toast.error(error.message || '创建失败，请重试');
      setCreateModal(prev => ({ ...prev, loading: false }));
    }
  };

  // 取消创建
  const handleCancelCreate = () => {
    setCreateModal({ visible: false, type: null, parentNode: null, name: '', loading: false });
  };

  // 确认重命名
  const handleRenameConfirm = async (node: any) => {
    const newName = editingName.trim();
    if (!newName) {
      Toast.warning('名称不能为空');
      setEditingKey(null);
      return;
    }
    
    // 如果名称没变，直接关闭
    if (newName === (node.data?.rawName || node.label)) {
      setEditingKey(null);
      return;
    }

    try {
      // 这里的 parentId 如果是 0 或 undefined，则传 1（根目录）
      await renameNode({
        id: node.id,
        name: newName,
      });
      
      Toast.success('重命名成功');
      if (onRenameSuccess) {
        onRenameSuccess(node.key, newName);
      }
      setEditingKey(null);
      scheduleRecompute();
    } catch (error: any) {
      console.error(error);
      Toast.error(error.message || '重命名失败');
      // 失败了也不一定要关闭，可以让用户继续改或者手动取消
    }
  };

  const handleRenameCancel = () => {
    setEditingKey(null);
    setEditingName('');
  };

  // 渲染菜单内容
  const renderNodeMenu = (node: any, isFolder: boolean) => {
    return (
      <MenuContent>
        <div className="menu-title">{isFolder ? '文件夹操作' : '文件操作'}</div>
        <div className="menu-item" onClick={() => handleAction('重命名', node)}>重命名</div>
        
        {isFolder ? (
          <>
            <div className="menu-item" onClick={() => handleAction('新建文件', node)}>新建文件</div>
            <div className="menu-item" onClick={() => handleAction('新建文件夹', node)}>新建文件夹</div>
          </>
        ) : (
          <div className="menu-item" onClick={() => handleAction('属性', node)}>属性</div>
        )}

        <Popconfirm
          title={<div style={{ fontSize: '16px', fontWeight: 600 }}>确认删除？</div>}
          content={
            <div style={{ fontSize: '14px', marginTop: '8px', width: '240px' }}>
              将删除「{node.data?.rawName ?? node.label ?? node.key}」及其所有子内容，此操作不可恢复。
            </div>
          }
          okType="danger"
          onConfirm={() => {
            handleAction('delete', node);
          }}
          position="rightBottom"
          style={{ width: 320 }} // 尝试调整 Popconfirm 容器宽度，如果不生效可能需要 overlayStyle
        >
          <div className="menu-item danger">删除</div>
        </Popconfirm>
      </MenuContent>
    );
  };

  const renderRootMenu = () => {
    return (
      <MenuContent>
        <div className="menu-title">根目录操作</div>
        <div className="menu-item" onClick={() => handleAction('新建文件', null)}>新建文件</div>
        <div className="menu-item" onClick={() => handleAction('新建文件夹', null)}>新建文件夹</div>
      </MenuContent>
    );
  };

  // 打开菜单：记录坐标和节点
  const openMenu = (e: React.MouseEvent, node: any, isFolder: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 获取鼠标位置
    const x = e.clientX;
    const y = e.clientY;
    
    setMenuState({
      visible: true,
      x,
      y,
      node,
      isFolder,
    });
  };

  // 行 label 渲染
  const renderLabel = (label?: ReactNode, treeNode?: any): ReactNode => {
    if (!treeNode) return label;
    const isFolder = treeNode.isLeaf !== true;

    // 外部文件拖拽进入：高亮并延时 500ms 自动展开
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

    if (editingKey === treeNode.key) {
      return (
        <div 
          className="tree-node-label editing" 
          ref={bindLabelRef(treeNode.key)}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          style={{ width: '100%', display: 'flex', alignItems: 'center' }}
        >
          <Input
            value={editingName}
            onChange={setEditingName}
            onBlur={() => handleRenameConfirm(treeNode)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === 'Escape') {
                handleRenameCancel();
              }
            }}
            autoFocus
            // style={{ width: '100%' }}
            style={{
              width: '100%',
              fontSize: '32px',
              height: '42px',
              // lineHeight: '32px',
              // padding: '0 4px',
              backgroundColor: 'var(--semi-color-bg-1)',
              border: '1px solid var(--semi-color-primary)',
              // borderRadius: '4px'
            }}
            onFocus={(e) => {
              const input = e.target as HTMLInputElement;
              const value = input.value;
              if (treeNode.isLeaf) {
                const dotIndex = value.lastIndexOf('.');
                // 如果有后缀且不是以点开头
                if (dotIndex > 0) {
                  input.setSelectionRange(0, dotIndex);
                } else {
                  input.select();
                }
              } else {
                input.select();
              }
            }}
          />
        </div>
      );
    }

    return (
      <div
        className={`tree-node-label ${dragOverKey === treeNode.key ? 'drag-over' : ''}`}
        ref={bindLabelRef(treeNode.key)}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        title={typeof label === 'string' ? label : undefined}
        onContextMenu={(e) => openMenu(e, treeNode, isFolder)}
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

  // 全局关闭菜单事件
  useEffect(() => {
    const closeMenu = () => setMenuState(prev => ({ ...prev, visible: false }));
    const onScroll = () => closeMenu();
    const onResize = () => closeMenu();

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div 
      className="tree-container" 
      style={{ height: '100%', width: '100%' }}
      onContextMenu={(e) => {
        // 空白区域右键：打开根目录菜单
        // 如果点在了 node 上，renderLabel 里的 onContextMenu 会 stopPropagation，所以这里不会触发
        openMenu(e, null, true);
      }}
    >
      <div className="custom-tree-wrapper" ref={wrapperRef}>
        {treeData.length === 0 ? (
          <div style={{ 
            padding: '40px 20px', 
            textAlign: 'center', 
            color: 'var(--semi-color-text-2)', 
            fontSize: '14px'
          }}>
            目录树为空，右键菜单可新建文件或文件夹
          </div>
        ) : (
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
        )}
      </div>

      {/* 
        单个 Popover 实例，通过 position anchor 模拟“跟随鼠标”
        Semi Popover 需要一个 trigger element。
        我们在鼠标位置渲染一个看不见的 div，作为 anchor。
      */}
      <Popover
        trigger="custom"
        visible={menuState.visible}
        onClickOutSide={() => setMenuState(prev => ({ ...prev, visible: false }))}
        position="rightTop" // 默认右下展开，靠近鼠标
        content={
          menuState.node === null 
            ? renderRootMenu() 
            : renderNodeMenu(menuState.node, menuState.isFolder)
        }
        // 关键：不显示箭头，紧贴鼠标
        showArrow={false}
        spacing={2} 
      >
        <div 
          style={{
            position: 'fixed',
            left: menuState.x,
            top: menuState.y,
            width: 0,
            height: 0,
          }} 
        />
      </Popover>

      {/* Modal 组件 - 居中显示 */}
      <Modal
        title="文件上传确认"
        visible={uploadModal.visible}
        onOk={handleConfirmUpload}
        onCancel={handleCancelUpload}
        confirmLoading={uploadModal.loading}
        okText="确定上传"
        cancelText="取消"
        maskClosable={false}
        centered // 居中
        width={600}
        bodyStyle={{
          fontSize: 15,
          lineHeight: '22px',
          padding: '20px 28px',
        }}
      >
        {uploadModal.files.length > 0 && uploadModal.targetNode && (
          <div style={{ padding: '10px 0' }}>
            <div style={{ marginBottom: 12 }}>
              <strong>上传位置:</strong> 📂 {uploadModal.targetNode.label}
            </div>

            <div style={{ 
              maxHeight: '200px', 
              overflowY: 'auto', 
              border: '1px solid var(--semi-color-border)',
              borderRadius: '4px',
              padding: '8px',
              backgroundColor: 'var(--semi-color-fill-0)'
            }}>
              {uploadModal.files.map((f, i) => (
                <div key={i} style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  padding: '4px 0',
                  fontSize: '13px',
                  borderBottom: i === uploadModal.files.length - 1 ? 'none' : '1px solid var(--semi-color-border-light)'
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '380px' }}>
                    {f.name}
                  </span>
                  <span style={{ color: 'var(--semi-color-text-2)', marginLeft: 8 }}>
                    {uploadManager.formatSize(f.size)}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16, color: 'var(--semi-color-text-2)', fontSize: 15 }}>
              <p>即将上传以上 {uploadModal.files.length} 个文件到目标目录，是否继续？</p>
            </div>
          </div>
        )}
      </Modal>

      {/* 新建文件/文件夹 Modal - 居中显示 */}
      <Modal
        title={createModal.type === 'dir' ? '新建文件夹' : '新建文件'}
        visible={createModal.visible}
        onOk={handleConfirmCreate}
        onCancel={handleCancelCreate}
        confirmLoading={createModal.loading}
        okText="确定"
        cancelText="取消"
        maskClosable={false}
        centered // 居中
      >
        <div style={{ padding: '10px 0' }}>
          <Input
            placeholder={createModal.type === 'dir' ? '请输入文件夹名称' : '请输入文件名称'}
            value={createModal.name}
            onChange={(value) => setCreateModal(prev => ({ ...prev, name: value }))}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleConfirmCreate();
              }
            }}
            autoFocus
          />
        </div>
      </Modal>
    </div>
  );
}
