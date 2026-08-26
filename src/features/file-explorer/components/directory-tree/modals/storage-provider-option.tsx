import styled, { createGlobalStyle } from 'styled-components';
import type { ResourceMonitorProbeStatus } from '@/features/resource-monitor/services/resource-monitor.api';

export const StorageProviderDropdownStyle = createGlobalStyle`
  .directory-tree-storage-provider-dropdown.semi-select-option-list-wrapper {
    padding: 2px 0;
  }

  .directory-tree-storage-provider-dropdown .semi-select-option-list {
    padding: 0;
  }

  .directory-tree-storage-provider-dropdown .semi-select-option {
    height: 24px;
    min-height: 24px;
    margin: 0 3px;
    padding: 0 7px;
    border-radius: var(--app-radius-small, 5px);
    box-sizing: border-box;
    font-size: 12px;
    line-height: 24px;
  }
`;

export const StorageProviderOption = styled.div`
  display: flex;
  width: 100%;
  min-width: 0;
  height: 24px;
  min-height: 24px;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  padding: 0;
  color: var(--semi-color-text-0);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const HealthDot = styled.span<{ $status: ResourceMonitorProbeStatus }>`
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: ${({ $status }) => {
    if ($status === 'ok') return 'var(--semi-color-success)';
    if ($status === 'error') return 'var(--semi-color-danger)';
    return 'var(--semi-color-fill-2)';
  }};
`;

export function StorageProviderHealthDot({ status }: { status: ResourceMonitorProbeStatus }) {
  const label = status === 'ok' ? '连接正常' : status === 'error' ? '连接失败' : '等待探活';
  return <HealthDot $status={status} aria-label={label} title={label} />;
}
