import AppSidebar from "@/components/app-sidebar";
import AppMain from "@/components/app-main";
import DirectorySidebar from "@/components/app-directory-sidebar";
import React from "react";
import {useParams} from "react-router-dom";

const LibraryDetail: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()
  const libraryId = Number(id)
  console.log("Library Detail", libraryId)

  return (
    <div className="content">
      <AppSidebar />
      <DirectorySidebar libraryId={libraryId} />
      <AppMain />
    </div>
  )
}

export default LibraryDetail;