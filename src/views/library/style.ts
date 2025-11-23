import styled from 'styled-components'

/** 页面根：保持 22px 字号； */
export const LibraryWrapper = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  padding: 16px 20px;
  background: var(--semi-color-bg-0);
  color: var(--semi-color-text-0);
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 22px;

  & * {
    font-size: 22px;
  }
`

/** 主体左右区域 */
export const ContentRow = styled.div`
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0; /* 允许子元素 overflow */
`

/** 左侧菜单（沾满左侧，列表样式） */
export const SideMenu = styled.aside`
  flex: 1 1 20%;
  max-width: 20%;
  min-width: 220px;
  background: var(--semi-color-bg-1);
  border: 1px solid var(--semi-color-border);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  min-height: 0;
`

export const SideMenuHeader = styled.div`
  font-weight: 700;
  color: var(--semi-color-text-0);
  margin-bottom: 12px;
`

export const SideMenuList = styled.div`
  flex: 1;            /* 填满剩余高度 */
  min-height: 0;
  overflow-y: auto;   /* 左侧内容超出时才滚动 */
  -ms-overflow-style: none;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`

export const SideMenuItem = styled.div`
  padding: 10px 12px;
  border-radius: 10px;
  color: var(--semi-color-text-0);
  background: var(--semi-color-bg-0);
  border: 1px dashed var(--semi-color-border);
  cursor: default;
  user-select: none;

  &:not(:last-child) { margin-bottom: 10px; }

  &:hover { background: var(--semi-color-fill-0); }
`

/** 左右分割线（竖线） */
export const VerticalDivider = styled.div`
  flex: 0 0 1px;
  align-self: stretch;
  background: var(--semi-color-border);
  opacity: 0.8;
`

/** 右侧区域 */
export const CardArea = styled.section`
  flex: 4 1 80%;
  min-width: 0;         /* 允许内部滚动 */
  display: flex;
  flex-direction: column;
  gap: 12px;
`

/** 右侧顶部：标题 + 右上角按钮 */
export const RightHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;

  /* 给最后一个子元素，也就是按钮，加个右边距 */
  & > :last-child {
    margin-right: 40px;
  }
`

export const RightHeaderTitle = styled.h3`
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 1;
`

/** 右侧（非占满宽度的）水平分割线 */
export const RightHeaderDivider = styled.div`
  height: 1px;
  background: var(--semi-color-border);
  opacity: 0.8;
  width: clamp(240px, 50%, 560px); /* 不占满；根据屏宽自适应 */
`

/**
 * 右侧滚动容器：只在内容超出时垂直滚动；隐藏滚动条
 */
export const CardScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;

  -ms-overflow-style: none;   /* IE/Edge */
  scrollbar-width: none;      /* Firefox */
  &::-webkit-scrollbar {      /* WebKit */
    width: 0;
    height: 0;
    display: none;
  }
`

/**
 * 卡片从左到右自动换行；窗口变化自动重排
 */
export const CardGrid = styled.div`
  display: flex;
  flex-wrap: wrap;            /* 自动换行 */
  gap: 18px;
  padding: 8px 2px;
  align-content: flex-start;  /* 多行从顶部堆叠 */
`

/** 单张卡片 */
export const CardItem = styled.div`
  position: relative;
  width: 240px;
  height: 190px;
  box-sizing: border-box;
  border-radius: 16px;
  background: var(--semi-color-bg-1);
  border: 1px solid var(--semi-color-border);
  box-shadow: var(--semi-shadow-elevated);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  cursor: pointer;
  transition: transform .16s ease, box-shadow .16s ease, background .16s ease;
  user-select: none;
  padding: 8px;

  &:hover {
    transform: translateY(-2px);
    box-shadow: var(--semi-shadow-hover);
    background: var(--semi-color-fill-0);
  }

  /** 悬浮时显示右上角动作区 */
  &:hover .card-actions {
    opacity: 1;
    pointer-events: auto;
  }
`

export const CardIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`

export const CardName = styled.div`
  max-width: 220px;
  text-align: center;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
`

/** 卡片上的就地编辑容器 */
export const CardNameEdit = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 220px;

  .semi-input-wrapper,
  input { height: 44px; }
`

/** 卡片右上角动作（收藏、更多） */
export const CardActions = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 8px;
  opacity: 0;                /* 默认隐藏 */
  pointer-events: none;      /* 隐藏时不接收事件 */
  transition: opacity .12s ease;
`

export const ActionIconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border-radius: 8px;
  border: 1px solid var(--semi-color-border);
  background: var(--semi-color-bg-1);
  color: var(--semi-color-text-0);
  cursor: pointer;

  &:hover { background: var(--semi-color-fill-0); }
`

/** 右键/更多 菜单（固定定位 + 竖直按钮） */
export const ContextMenu = styled.div`
  position: fixed;
  z-index: 1000;
  min-width: 300px;
  padding: 12px;
  border-radius: 12px;
  background: var(--semi-color-bg-1);
  border: 1px solid var(--semi-color-border);
  box-shadow: var(--semi-shadow-elevated);
`

export const ContextMenuTitle = styled.div`
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--semi-color-text-0);
`

export const ContextMenuActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;

  & > * { width: 100%; }
`

export const EmptyTip = styled.div`
  padding: 40px 0 20px;
  text-align: center;
  color: var(--semi-color-text-2);
`

export default LibraryWrapper
