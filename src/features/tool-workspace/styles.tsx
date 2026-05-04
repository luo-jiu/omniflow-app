import styled from 'styled-components';

export const Wrapper = styled.div`
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--app-bg);
`;

export const ToolNav = styled.aside`
  border-right: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-sidebar-vibrancy) 88%, var(--app-bg) 12%);
  padding: 13px 11px;
  display: flex;
  flex-direction: column;
  gap: 9px;

  .title {
    font-size: 14px;
    font-weight: 700;
    color: var(--app-text);
  }

  .tool-card {
    appearance: none;
    display: flex;
    flex-direction: column;
    gap: 0;
    width: 100%;
    text-align: left;
    padding: 10px 8px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: color-mix(in srgb, var(--app-bg-elevated) 88%, transparent);
    cursor: pointer;
  }

  .tool-card.is-active {
    border-color: var(--semi-color-primary);
    background: var(--semi-color-primary-light-default);
  }

  .tool-card:disabled {
    cursor: default;
  }

  .tool-card-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--semi-color-primary);
  }

  .semi-button {
    min-height: 30px;
    font-size: 11px;
  }
`;

export const WorkspaceMain = styled.div`
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

export const WorkspaceSection = styled.div<{ $active: boolean }>`
  display: ${({ $active }) => ($active ? 'flex' : 'none')};
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
`;

export const WorkspaceHeader = styled.div`
  padding: 12px 14px 8px;
  border-bottom: 1px solid var(--app-border);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;

  .header-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .header-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--app-text);
    line-height: 1.2;
  }

  .header-desc {
    font-size: 11px;
    line-height: 1.55;
    color: var(--app-text-muted);
  }

  .header-tags {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
`;

export const WorkspaceBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

export const Panel = styled.section`
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--app-bg-elevated) 92%, transparent);
  padding: 12px;

  .panel-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--app-text);
    margin-bottom: 8px;
  }

  .panel-desc {
    font-size: 11px;
    line-height: 1.55;
    color: var(--app-text-muted);
    margin-bottom: 9px;
  }
`;

export const ConfigGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .field.full {
    grid-column: 1 / -1;
  }

  .label {
    font-size: 11px;
    font-weight: 600;
    color: var(--app-text-muted);
  }

  .models-row {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .semi-input-wrapper,
  .semi-input,
  .semi-input-number,
  .semi-input-number-input {
    font-size: 11px;
  }

  .semi-input-wrapper,
  .semi-input-number {
    min-height: 30px;
    border-radius: 6px;
  }
`;

export const ActionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;

  .semi-button {
    min-height: 30px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 11px;
  }

  .semi-tag {
    font-size: 10px;
  }

  .merge-status {
    font-size: 11px;
    line-height: 1.5;
    color: var(--app-text-muted);
  }

  .merge-status.ok {
    color: var(--app-text);
  }
`;
