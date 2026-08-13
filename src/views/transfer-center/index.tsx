import React, { useMemo } from 'react';
import styled from 'styled-components';
import { Button, TabPane, Tabs, Typography } from '@douyinfe/semi-ui';
import { IconChevronLeft } from '@douyinfe/semi-icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import OpaquePageContainer from '@/components/OpaquePageContainer';
import UploadTab from './tabs/UploadTab';
import MigrationTab from './tabs/MigrationTab';
import ProcessingTab from './tabs/ProcessingTab';

// 传输中心：上传 / 存储迁移 / 处理任务三 tab 容器。
// Page 包含拖动区、最大宽度、内边距等页面级样式 —— 沿用旧"上传中心"的 box 节奏。
const Page = styled.div`
  --page-heading-indent: 38px;

  width: 100%;
  height: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 38px 32px 27px;
  overflow: auto;
  -webkit-app-region: drag;

  & > * {
    -webkit-app-region: no-drag;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 11px;
    margin-bottom: 13px;
  }

  .page-back-button {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    min-width: 28px;
    padding: 0;
    border-radius: 7px;
  }

  .page-title {
    margin: 0;
    font-size: 23px;
    font-weight: 700;
    line-height: 1.15;
  }

  .semi-tabs-bar {
    margin-left: var(--page-heading-indent);
    margin-bottom: 12px;
  }

  @media (max-width: 760px) {
    padding: 29px 13px 16px;

    .semi-tabs-bar {
      margin-left: 0;
    }
  }
`;

type TabKey = 'upload' | 'migration' | 'processing';

const TAB_KEYS: TabKey[] = ['upload', 'migration', 'processing'];

function normalizeTabKey(value: string | null): TabKey {
  return TAB_KEYS.includes(value as TabKey) ? (value as TabKey) : 'upload';
}

const TransferCenter: React.FC = () => {
  const navigate = useNavigate();
  const { Title } = Typography;
  const [searchParams, setSearchParams] = useSearchParams();

  const activeKey = useMemo(() => normalizeTabKey(searchParams.get('tab')), [searchParams]);

  const handleTabChange = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next, { replace: true });
  };

  return (
    <OpaquePageContainer>
      <Page>
        <div className="header">
          <Button
            icon={<IconChevronLeft style={{ fontSize: 14 }} />}
            theme="borderless"
            onClick={() => navigate(-1)}
            className="page-back-button"
          />
          <Title heading={2} className="page-title">
            传输中心
          </Title>
        </div>

        <Tabs type="line" size="small" activeKey={activeKey} onChange={handleTabChange}>
          <TabPane tab="上传" itemKey="upload">
            <UploadTab />
          </TabPane>
          <TabPane tab="存储迁移" itemKey="migration">
            <MigrationTab />
          </TabPane>
          <TabPane tab="处理任务" itemKey="processing">
            <ProcessingTab />
          </TabPane>
        </Tabs>
      </Page>
    </OpaquePageContainer>
  );
};

export default TransferCenter;
