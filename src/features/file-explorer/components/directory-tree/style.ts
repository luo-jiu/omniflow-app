import styled from 'styled-components'

export const DirectorySidebarWrapper = styled.aside<{ $isDragging?: boolean }>`
  position: relative;
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 0;
  background: transparent;
  border: none;

  .sidebar-container {
    background: transparent;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .repository-selector {
    padding: 7px 8px;
    border-bottom: 1px solid var(--app-border);
    flex-shrink: 0;
  }

  .tree-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: auto;
    position: relative;
    padding: 3px 1px 7px 1px;
    overscroll-behavior: contain;
    font-size: 13px;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }

  .tree-container::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .tree-container::-webkit-scrollbar-track {
    background: var(--app-scrollbar-track);
  }

  .tree-container::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
  }

  .tree-container:hover,
  .tree-container:focus-within,
  .tree-container:active {
    scrollbar-color: var(--app-scrollbar-thumb) var(--app-scrollbar-track);
  }

  .tree-container:hover::-webkit-scrollbar-thumb,
  .tree-container:focus-within::-webkit-scrollbar-thumb,
  .tree-container:active::-webkit-scrollbar-thumb {
    background: var(--app-scrollbar-thumb);
  }

  .tree-container::-webkit-scrollbar-thumb:hover {
    background: var(--app-scrollbar-thumb-hover);
  }

  .tree-container::-webkit-scrollbar-corner {
    background: var(--app-scrollbar-track);
  }

  .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    background: transparent;
    z-index: 12;
  }
  .resize-handle::after {
    content: "";
    position: absolute;
    left: -4px;
    right: -4px;
    top: 0;
    bottom: 0;
    cursor: col-resize;
  }
  .resize-handle:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  .custom-tree-wrapper {
    display: block;
    min-width: max-content;
    width: auto;
    font-size: 13px;
  }

  /* 全局覆盖 Semi Tree 的字体大小 */
  .custom-tree,
  .custom-tree * {
    font-size: 13px !important;
  }

  .custom-tree {
    user-select: none;

    .semi-tree-option-list .semi-tree-option {
      box-sizing: border-box;
      min-height: 20px;
      padding: 1px 3px;
      border-radius: 6px;
      font-size: 13px !important;
      line-height: 17px !important;
      color: var(--app-text-secondary);
    }
  }

  /* 压缩 Semi Tree 内部左侧间距 */
  .custom-tree .semi-tree-option-list {
    padding-left: 0 !important;
  }

  .custom-tree .semi-tree-option {
    padding-left: 2px !important;
    transition:
      background-color 120ms ease,
      color 120ms ease,
      border-radius 120ms ease;
  }

    .semi-tree-option:hover {
      background: rgba(0, 0, 0, 0.04);
      color: var(--app-text);
    }

    .semi-tree-option.tree-row-selected,
    .semi-tree-option.tree-row-selected:hover {
      background: color-mix(in srgb, var(--semi-color-primary-light-default) 92%, transparent);
      color: var(--app-text);
    }

    .semi-tree-option.tree-row-selected-single {
      border-radius: 6px;
    }

    .semi-tree-option.tree-row-selected-start {
      border-radius: 6px 6px 2px 2px;
    }

    .semi-tree-option.tree-row-selected-middle {
      border-radius: 2px;
    }

    .semi-tree-option.tree-row-selected-end {
      border-radius: 2px 2px 6px 6px;
    }

    .semi-tree-option-selected,
    .semi-tree-option-selected:hover {
      background: transparent;
      color: inherit;
    }

    .semi-tree-option-label,
    .semi-tree-option-label-text {
      font-size: 13px !important;
    }

    .semi-tree-option-label {
      width: 100%;
      min-width: 0;
      flex: 1;
    }

    .semi-tree-option-label .semi-icon,
    .semi-tree-option-icon {
      font-size: 14px !important;
      margin-right: 3px;
      color: var(--app-text-muted);
    }

    /* loadData 期间 Semi 会把 expand-icon 整个替换成 spin-icon。
       Semi 默认 expand-icon 用 box-sizing: content-box + 内 svg 14px + 我们的 padding 4px，
       但折叠态的 transform: rotate(270deg) 会让 boundingClientRect 出现亚像素差异，
       展开态 width 又比折叠态少 1px，再加 spin-icon 默认 footprint 不一致，
       三者宽度依次跳变 21 → 22 → 20，标签起点跟着右移再左回造成"加载闪烁"。
       这里把两种插槽都锁成 border-box 22x22，从根上消除宽度跳变。 */
    .semi-tree-option-expand-icon,
    .semi-tree-option-spin-icon {
      box-sizing: border-box !important;
      width: 22px !important;
      height: 22px !important;
      padding: 4px !important;
      margin: -4px 0 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
    }

    .semi-tree-option-expand-icon {
      font-size: 13px !important;
      color: var(--app-text-muted);
      border-radius: 4px;
      cursor: pointer;
    }

    .semi-tree-option-expand-icon:hover {
      background: rgba(0, 0, 0, 0.06);
    }
  }

  .custom-tree .semi-input {
    font-size: 13px;
    line-height: 17px;
  }

  .custom-tree .semi-input-wrapper {
    height: 24px;
    border-radius: 6px;
    background: var(--app-bg-elevated);
    border: 1px solid var(--app-border);
  }

  /* 编辑态行高必须和普通态严格一致（实测普通态 .semi-tree-option-label 自然高 25px，
     来自 Semi draggable Tree 的 .option-label padding 2px + 字体行高）。
     如果让编辑态 label 走自然高度，Input 20px + Semi padding 会撑成 ~28px，反向变高。
     这里直接把编辑态 label 锁成 25px border-box，padding 清零让 Input 自己在 25px 槽位
     里通过 align-items:center 垂直居中，从结构上消除任何上下抽动。 */
  .custom-tree .tree-node-label.editing {
    display: inline-flex;
    align-items: center;
    padding-right: 0;
  }

  .custom-tree .semi-tree-option-label:has(.tree-node-rename-input),
  .custom-tree .semi-tree-option-label-text:has(.tree-node-rename-input) {
    display: flex;
    align-items: center;
    min-width: 0;
    height: 25px;
    min-height: 25px;
    max-height: 25px;
    box-sizing: border-box;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }

  .custom-tree .tree-node-rename-input.semi-input-wrapper {
    height: 20px;
    line-height: 18px !important;
    vertical-align: middle;
    border-color: var(--semi-color-primary);
    border-radius: 6px;
    background: var(--semi-color-bg-1);
  }

  .custom-tree .tree-node-rename-input .semi-input {
    display: block;
    height: 18px;
    line-height: 18px;
    padding-top: 0;
    padding-bottom: 0;
  }

  .tree-node-label {
    display: inline-flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    gap: 5px;
    padding-right: 4px;
  }

  .tree-node-label.drag-over {
    background: rgba(52, 88, 71, 0.06);
    outline: 1px dashed var(--app-accent);
    border-radius: 4px;
  }

  .tree-node-text {
    display: inline-block;
    flex: 0 0 auto;
    white-space: nowrap;
    overflow: visible;
    text-overflow: initial;
    color: inherit;
    font-size: 13px !important;
    line-height: 17px;
  }

  .tree-node-text-archive {
    color: color-mix(in srgb, var(--semi-color-success) 78%, var(--app-text) 22%);
    font-weight: 600;
  }

  .tree-file-type-icon {
    width: 15px;
    height: 15px;
    display: block;
    object-fit: contain;
    margin-right: 2px;
    box-sizing: border-box;
    flex: 0 0 15px;
  }

  .tree-file-type-icon-default-folder,
  .tree-file-type-icon-comic-folder,
  .tree-file-type-icon-asmr-folder,
  .tree-file-type-icon-audio-folder,
  .tree-file-type-icon-video-folder {
    width: 15px;
    height: 15px;
    flex-basis: 15px;
    object-fit: contain;
  }

  .tree-file-type-icon-audio-subtitles {
    margin-right: 2px;
    flex: 0 0 15px;
    overflow: visible;
    transform: scale(0.75);
    transform-origin: center;
  }

  /* Normalize perceptual size for directory icons (built-in + default).
     四类内置 SVG 与 folder-base 共享同一 folder body 几何，
     视觉差异仅来自装饰图案是否突破 folder body 边界，统一 0.5px 即可。
     超出范围的单类（如 audio 麦克风外延）后续靠单独 class 增加 padding 校准。 */
  .tree-file-type-icon-default-folder,
  .tree-file-type-icon-comic-folder,
  .tree-file-type-icon-asmr-folder,
  .tree-file-type-icon-audio-folder,
  .tree-file-type-icon-video-folder {
    padding: 0.5px;
  }

  .tree-built-in-type-icon {
    width: 13px;
    height: 13px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 8px;
    font-weight: 600;
    line-height: 1;
  }

  .tree-built-in-type-icon-comic {
    color: #8a4b00;
    background: #ffe9c4;
    border: 1px solid #ffcf8b;
  }

  .tree-built-in-type-icon-unknown {
    color: #8b1f1f;
    background: #ffd8d8;
    border: 1px solid #ffb7b7;
  }

`;

export default DirectorySidebarWrapper;
