import styled from 'styled-components';

/**
 * 全屏不透明页面容器。
 * 在 vibrancy 模式下 body 背景为 transparent，
 * 非侧边栏页面需要此容器恢复不透明背景。
 */
const OpaquePageContainer = styled.div`
  width: 100%;
  height: 100%;
  overflow: auto;
  background: var(--app-bg);
`;

export default OpaquePageContainer;
