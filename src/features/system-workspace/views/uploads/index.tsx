import styled from 'styled-components';
import UploadCenterBody from '@/views/upload-center/UploadCenterBody';

const UploadsWorkspaceWrapper = styled.div`
  width: 100%;
`;

const UploadsWorkspace = () => (
  <UploadsWorkspaceWrapper>
    <UploadCenterBody />
  </UploadsWorkspaceWrapper>
);

export default UploadsWorkspace;
