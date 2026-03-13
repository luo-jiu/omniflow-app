import AppMain from "@/components/business/app-main";
import { DirectorySidebar } from "@/features/file-explorer";
import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FileViewerProvider, useFileViewer } from "@/contexts/FileViewerContext";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, Popover } from "@douyinfe/semi-ui";
import { IconSetting, IconExit, IconChevronLeft } from "@douyinfe/semi-icons";
import ContextMenu from "@/components/ui/context-menu";
import styled from "styled-components";

const DetailWrapper = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
`;

const SidePanel = styled.div`
  width: 300px;
  min-width: 260px;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  background: var(--app-bg-sidebar);
  border-right: 1px solid var(--app-border);
  flex-shrink: 0;
  height: 100%;

  body[theme-mode="dark"] & {
    background: var(--app-bg-sidebar);
  }
`;

const SidePanelHeader = styled.div`
  padding: 14px 16px 10px;
  padding-left: 80px;
  -webkit-app-region: drag;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;

  .back-btn {
    -webkit-app-region: no-drag;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--app-text-muted);
    flex-shrink: 0;

    &:hover {
      background: rgba(0, 0, 0, 0.05);
      color: var(--app-text);
    }
  }

  .brand {
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  }

  .brand-mark {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--app-accent);
    flex-shrink: 0;
  }

  h1 {
    font-size: 16px;
    font-weight: 600;
    color: var(--app-text);
    margin: 0;
  }
`;

const SidePanelTree = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0 10px 6px;
`;

const SidePanelFooter = styled.div`
  padding: 10px 14px;
  border-top: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;

  .footer-left {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .footer-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    cursor: pointer;
    color: var(--app-text-muted);
    background: transparent;
    border: none;

    &:hover {
      background: rgba(0, 0, 0, 0.05);
      color: var(--app-text);
    }
  }

  .user-trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 4px;
    border-radius: 8px;
    cursor: pointer;

    &:hover {
      background: rgba(0, 0, 0, 0.05);
    }
  }

  .user-name {
    font-size: 13px;
    color: var(--app-text-secondary);
  }
`;

const ContentArea = styled.div`
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  -webkit-app-region: drag;

  & > * {
    -webkit-app-region: no-drag;
  }
`;

const LibraryDetailContent: React.FC<{ libraryId: number }> = ({ libraryId }) => {
  const { setFileUrl } = useFileViewer();
  const { user, isLoggedIn, logout } = useAuth();
  const navigate = useNavigate();
  const displayName = isLoggedIn ? user?.username || "User" : "未登录";

  const handleFileOpen = async (
    fileUrl: string,
    fileName: string,
    fileType: "image" | "video" | "audio" | "other"
  ) => {
    setFileUrl(fileUrl, fileName, fileType);
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const userContent = (
    <div
      className="user-trigger"
      onClick={() => !isLoggedIn && navigate("/login")}
    >
      <Avatar
        size="extra-small"
        src={user?.avatar}
        style={{
          backgroundColor: isLoggedIn
            ? "var(--app-accent)"
            : "var(--semi-color-fill-2)",
        }}
      >
        {isLoggedIn ? user?.username?.[0]?.toUpperCase() || "U" : "?"}
      </Avatar>
      <span className="user-name">{displayName}</span>
    </div>
  );

  return (
    <DetailWrapper>
      <SidePanel>
        <SidePanelHeader>
          <div className="back-btn" onClick={() => navigate("/libraries")} title="返回库列表">
            <IconChevronLeft size="large" />
          </div>
          <div className="brand" onClick={() => navigate("/")} title="首页">
            <span className="brand-mark" />
            <h1>Omniflow</h1>
          </div>
        </SidePanelHeader>

        <SidePanelTree>
          <DirectorySidebar libraryId={libraryId} onFileOpen={handleFileOpen} />
        </SidePanelTree>

        <SidePanelFooter>
          <div className="footer-left">
            <button
              className="footer-btn"
              onClick={() => navigate("/settings")}
              title="设置"
            >
              <IconSetting size="large" />
            </button>
          </div>

          {isLoggedIn ? (
            <Popover
              showArrow={false}
              spacing={8}
              style={{ padding: 0 }}
              position="topRight"
              content={
                <ContextMenu
                  title={user?.username}
                  style={{ border: "none", boxShadow: "none" }}
                  items={[
                    {
                      key: "logout",
                      label: "退出登录",
                      icon: <IconExit />,
                      danger: true,
                      onClick: handleLogout,
                    },
                  ]}
                />
              }
            >
              {userContent}
            </Popover>
          ) : (
            userContent
          )}
        </SidePanelFooter>
      </SidePanel>

      <ContentArea>
        <AppMain />
      </ContentArea>
    </DetailWrapper>
  );
};

const LibraryDetail: React.FC = () => {
  const { id = "" } = useParams<{ id: string }>();
  const libraryId = Number(id);

  return (
    <FileViewerProvider>
      <LibraryDetailContent libraryId={libraryId} />
    </FileViewerProvider>
  );
};

export default LibraryDetail;
