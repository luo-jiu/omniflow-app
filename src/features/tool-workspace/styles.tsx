import styled from 'styled-components';

export const Wrapper = styled.div`
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--app-bg);
`;

export const ToolNav = styled.aside`
  border-right: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-sidebar-vibrancy) 88%, var(--app-bg) 12%);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;

  .title {
    font-size: 20px;
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
    padding: 16px 12px;
    border-radius: 12px;
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
    font-size: 17px;
    font-weight: 700;
    color: var(--semi-color-primary);
  }

  .semi-button {
    min-height: 42px;
    font-size: 15px;
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
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--app-border);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;

  .header-copy {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .header-title {
    font-size: clamp(30px, 2.2vw, 36px);
    font-weight: 700;
    color: var(--app-text);
    line-height: 1.2;
  }

  .header-desc {
    font-size: 16px;
    line-height: 1.75;
    color: var(--app-text-muted);
  }

  .header-tags {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
`;

export const WorkspaceBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 18px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

export const Panel = styled.section`
  border: 1px solid var(--app-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--app-bg-elevated) 92%, transparent);
  padding: 18px;

  .panel-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--app-text);
    margin-bottom: 12px;
  }

  .panel-desc {
    font-size: 16px;
    line-height: 1.75;
    color: var(--app-text-muted);
    margin-bottom: 14px;
  }
`;

export const ConfigGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .field.full {
    grid-column: 1 / -1;
  }

  .label {
    font-size: 14px;
    font-weight: 600;
    color: var(--app-text-muted);
  }

  .models-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .semi-input-wrapper,
  .semi-input,
  .semi-input-number,
  .semi-input-number-input {
    font-size: 15px;
  }

  .semi-input-wrapper,
  .semi-input-number {
    min-height: 42px;
  }
`;

export const ActionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;

  .semi-button {
    min-height: 42px;
    font-size: 15px;
  }

  .semi-tag {
    font-size: 14px;
  }

  .merge-status {
    font-size: 14px;
    line-height: 1.5;
    color: var(--app-text-muted);
  }

  .merge-status.ok {
    color: var(--app-text);
  }
`;
