import React from 'react';
import { Navigate } from 'react-router-dom';

// /upload-center 旧路径保留兼容（书签 / 嗅探链路里硬编码的导航），
// 实际渲染由 /transfer-center?tab=upload 承接。
const UploadCenterRedirect: React.FC = () => (
  <Navigate to="/transfer-center?tab=upload" replace />
);

export default UploadCenterRedirect;
