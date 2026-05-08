import React from 'react';
import UploadCenterBody from '@/views/upload-center/UploadCenterBody';

// 上传 tab：直接复用 upload-center 现有 body（分组树 + 进度条 + 速率/ETA）。
// 引擎、状态、嗅探链路均不动 —— 只是把外层容器换成传输中心 Tabs。
const UploadTab: React.FC = () => <UploadCenterBody />;

export default UploadTab;
