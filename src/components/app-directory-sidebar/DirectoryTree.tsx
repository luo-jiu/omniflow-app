import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { Modal, Tree } from '@douyinfe/semi-ui';
import { IconPlus } from '@douyinfe/semi-icons';

interface DirectoryTreeProps {
  treeData: any[];
  expandedKeys: string[];
  onExpand: (keys: string[]) => void;
  onDoubleClick: (e: React.MouseEvent, node: any) => void;
}

/**
 * DirectoryTree:
 * - 使用 .custom-tree-wrapper 的宽度测量办法，保证横向滚动条宽度足够可拖拽
 * - 文本默认 ellipsis + title 提示（不使用 hover 展开以免遮挡滚动条）
 */
export default function DirectoryTree({
  treeData,
  expandedKeys,
  onExpand,
  onDoubleClick,
}: DirectoryTreeProps) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  // wrapper 用来测量每行的 scrollWidth，从而设置合适的 minWidth
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const measureTimeoutRef = useRef<number | null>(null);

  // 点击 + 的回调
  const handleAdd = (node: any) => {
    Modal.confirm({
      title: `在「${(node && (node.data?.rawName ?? node.label)) || '节点'}」下新增节点`,
      content: '这里你可以放输入框或其他逻辑',
      okText: '确认',
      cancelText: '取消',
      onOk: () => {
        console.log('✅ 确认新增', node);
      },
    });
  };

  // 计算并设置wrapper的minWidth，使其至少等于最长行的所需宽度
  const measure = () => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // 选择所有渲染的 label 文本元素
    const txts = wrapper.querySelectorAll<HTMLElement>('.tree-node-text');
    let max = 0;
    txts.forEach(el => {
      const textW = el.scrollWidth;
      const option = el.closest('.semi-tree-option');
      if (!option) return;

      const style = window.getComputedStyle(option);
      const pl = parseFloat(style.paddingLeft);
      const pr = parseFloat(style.paddingRight);

      const label = el.closest('.tree-node-label');
      if (!label) return;
      const labelStyle = window.getComputedStyle(label);
      const lpl = parseFloat(labelStyle.paddingLeft);
      const lpr = parseFloat(labelStyle.paddingRight);

      // 图标宽度（如果存在）
      let iconW = 0;
      const icon = option.querySelector('.semi-icon');
      if (icon) {
        const iconStyle = window.getComputedStyle(icon);
        iconW = icon.offsetWidth + parseFloat(iconStyle.marginLeft) + parseFloat(iconStyle.marginRight);
      }

      // 加号宽度（包含 margin）
      const plusW = 18 + 6;

      // 计算本行所需总宽度
      const w = pl + pr + lpl + lpr + iconW + textW + plusW;
      if (w > max) max = w;
    });
    // 小缓冲以防计算误差
    const buffer = 4;
    const desired = max + buffer;
    // 设置 minWidth（无需 Math.max 与 clientWidth，因为 CSS 会自动处理）
    wrapper.style.minWidth = `${desired}px`;
  };

  useEffect(() => {
    // 初始测量
    measure();

    // debounce measurement
    const scheduleMeasure = () => {
      if (measureTimeoutRef.current) {
        window.clearTimeout(measureTimeoutRef.current);
        measureTimeoutRef.current = null;
      }
      measureTimeoutRef.current = window.setTimeout(measure, 16); // 更短延迟，提升实时性
    };

    // 窗口 resize
    window.addEventListener('resize', scheduleMeasure);

    // MutationObserver：内容变化时测量
    let mo: MutationObserver | null = null;
    const wrapper = wrapperRef.current;
    if (wrapper) {
      mo = new MutationObserver(scheduleMeasure);
      mo.observe(wrapper, { childList: true, subtree: true, characterData: true, attributes: true });
    }

    // ResizeObserver：容器宽度变化时测量（关键：处理拖拽）
    let ro: ResizeObserver | null = null;
    const container = wrapper?.parentElement;
    if (container) {
      ro = new ResizeObserver(scheduleMeasure);
      ro.observe(container);
    }

    return () => {
      window.removeEventListener('resize', scheduleMeasure);
      if (mo) mo.disconnect();
      if (ro) ro.disconnect();
      if (measureTimeoutRef.current) {
        window.clearTimeout(measureTimeoutRef.current);
        measureTimeoutRef.current = null;
      }
    };
  }, [treeData, expandedKeys]); // 依赖数据和展开状态

  // renderLabel 按 semi 的签名 (label, treeNode) => ReactNode
  const renderLabel = (label?: ReactNode, treeNode?: any): ReactNode => {
    if (!treeNode) return label;

    return (
      <div
        className="tree-node-label"
        onMouseEnter={() => setHoverKey(treeNode.key)}
        onMouseLeave={() => setHoverKey(null)}
      >
        <span
          className="tree-node-text"
          title={typeof label === 'string' ? label : undefined}
        >
          {label}
        </span>

        {hoverKey === treeNode.key && (
          <IconPlus
            className="tree-node-plus"
            onClick={(e) => {
              e.stopPropagation();
              handleAdd(treeNode);
            }}
          />
        )}
      </div>
    );
  };

  return (
    <div className="tree-container">
      <div className="custom-tree-wrapper" ref={wrapperRef}>
        <Tree
          className="custom-tree"
          treeData={treeData}
          expandedKeys={expandedKeys}
          onExpand={onExpand}
          onDoubleClick={onDoubleClick}
          directory
          renderLabel={renderLabel}
          style={{ padding: 8 }}
        />
      </div>
    </div>
  );
}