import AppSidebar from "@/components/business/app-sidebar";
import AppMain from "@/components/business/app-main";
import { DirectorySidebar } from "@/features/file-explorer";
import React from "react";
import {useParams} from "react-router-dom";
import { FileViewerProvider, useFileViewer } from "@/contexts/FileViewerContext";

const LibraryDetailContent: React.FC<{ libraryId: number }> = ({ libraryId }) => {
  const { setFileUrl } = useFileViewer();

  const handleFileOpen = async (fileUrl: string, fileName: string, fileType: 'image' | 'video' | 'other') => {
    setFileUrl(fileUrl, fileName, fileType);
  };

  return (
    <div className="content">
      <AppSidebar />
      <DirectorySidebar libraryId={libraryId} onFileOpen={handleFileOpen} />
      <AppMain />
    </div>
  );
};

const LibraryDetail: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()
  const libraryId = Number(id)
  console.log("Library Detail", libraryId)

  return (
    <FileViewerProvider>
      <LibraryDetailContent libraryId={libraryId} />
    </FileViewerProvider>
  )
}

export default LibraryDetail;