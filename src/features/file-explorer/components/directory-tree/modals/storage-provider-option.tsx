import styled, { createGlobalStyle } from 'styled-components';

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
  overflow: hidden;
  padding: 0;
  color: var(--semi-color-text-0);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
