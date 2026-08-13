import React from 'react';
import { Empty } from '@douyinfe/semi-ui';

// 处理任务 tab：转码、归档等批量异步任务的统一入口。本期仅占位，等后续 executor 真正落地再接入。
const ProcessingTab: React.FC = () => (
  <div style={{ padding: '32px 16px' }}>
    <Empty
      description={
        <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, lineHeight: 1.6 }}>
          暂无处理任务<br />
          后续将承载转码 / 归档 / 索引等批量任务
        </div>
      }
    />
  </div>
);

export default ProcessingTab;
