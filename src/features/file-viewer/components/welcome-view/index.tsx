import React from 'react';
import { WelcomeWrapper } from './style';

/**
 * 默认欢迎页面组件
 * 展示工作区空状态
 */
const WelcomeView: React.FC = () => {
  return (
    <WelcomeWrapper>
      <div className="panel">
        <span className="eyebrow">Workspace</span>
        <h1>选择左侧文件开始预览</h1>
        <p>
          目录树负责组织内容，右侧区域用于预览图片、音频和视频。
          先选一个库，再双击文件进入查看。
        </p>
        <div className="tips">
          <div className="tip">
            <span className="tip-label">双击</span>
            <span className="tip-text">展开目录或打开文件</span>
          </div>
          <div className="tip">
            <span className="tip-label">右键</span>
            <span className="tip-text">新建、重命名、删除节点</span>
          </div>
          <div className="tip">
            <span className="tip-label">拖拽</span>
            <span className="tip-text">把文件直接拖到目录里上传</span>
          </div>
        </div>
      </div>
    </WelcomeWrapper>
  );
};

export default WelcomeView;
