import {
  IconApps,
  IconDelete,
  IconPulse,
  IconSetting,
  IconUpload,
  IconUser,
} from '@douyinfe/semi-icons';
import type { ComponentType } from 'react';
import type {
  SystemWorkspaceView,
  SystemWorkspaceViewMeta,
  SystemWorkspaceViewProps,
} from './types';
import OverviewWorkspace from './views/overview';
import SettingsWorkspace from './views/settings';
import UploadsWorkspace from './views/uploads';
import RecycleBinWorkspace from './views/recycle-bin';
import ProfileWorkspace from './views/profile';
import ResourceMonitorWorkspace from '@/features/resource-monitor/components/ResourceMonitorWorkspace';

export const systemWorkspaceMeta: Record<SystemWorkspaceView, SystemWorkspaceViewMeta> = {
  overview: {
    title: '系统工具',
    description: '当前资料库里的设置、传输和管理入口',
    icon: <IconApps />,
  },
  settings: {
    title: '设置',
    description: '调整当前客户端的常用偏好',
    icon: <IconSetting />,
  },
  uploads: {
    title: '上传中心',
    description: '查看后台上传队列和任务状态',
    icon: <IconUpload />,
  },
  'recycle-bin': {
    title: '回收站',
    description: '恢复或清理当前资料库的已删除文件',
    icon: <IconDelete />,
  },
  profile: {
    title: '主页',
    description: '管理头像、昵称和账号安全',
    icon: <IconUser />,
  },
  'resource-monitor': {
    title: '资源监测',
    description: '查看物理存储分布和资源占用快照',
    icon: <IconPulse />,
  },
};

export const systemWorkspaceViews: Record<SystemWorkspaceView, ComponentType<SystemWorkspaceViewProps>> = {
  overview: OverviewWorkspace,
  settings: SettingsWorkspace,
  uploads: UploadsWorkspace,
  'recycle-bin': RecycleBinWorkspace,
  profile: ProfileWorkspace,
  'resource-monitor': ResourceMonitorWorkspace,
};
