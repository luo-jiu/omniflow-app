import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, Avatar, Popover, Toast } from '@douyinfe/semi-ui'
import { IconMusic, IconRefresh } from '@douyinfe/semi-icons'

import LibraryWrapper, {
  ContentRow,
  VerticalDivider,
  CardArea,
  RightHeaderTitle,
  RightHeaderDivider,
  CardScroll,
  CardGrid,
  EmptyTip,
  LibrarySystemFrame,
  LibrarySystemScroll,
  LibraryMainToolbar,
} from './style'

import { useLibraryPage } from './hooks/useLibraryPage.ts'
import { useAuth } from '@/hooks/useAuth'
import QuickAccessSidebar from './components/quick-access-sidebar'
import type { QuickAccessMode } from './components/quick-access-sidebar'
import LibraryCard from './components/library-card'
import LibraryContextMenu from './components/library-context-menu'
import LibraryCreateModal from './components/library-create-modal'
import LibraryEditModal from './components/library-edit-modal'
import type { Library } from "@/features/file-explorer/services/file.api"
import { useMediaEntries } from '@/hooks/useMediaRegistry'
import { mediaRegistry } from '@/contexts/media-registry.singleton'
import MediaHubPopover from '@/components/business/media-hub-popover'
import { setPendingActivation } from '@/contexts/file-viewer-pending-activation'
import { getAppPopupContainer } from '@/utils/popup-container'
import { systemWorkspaceMeta, systemWorkspaceViews } from '@/features/system-workspace/registry'
import type {
  SettingsWorkspaceSection,
  SystemWorkspaceView,
} from '@/features/system-workspace'
import { disposeLibraryWorkspace } from '@/features/workspace-resource-release'

type MenuState = {
  visible: boolean
  x: number
  y: number
  mode: 'library' | 'blank'
  library: Library | null
}

const MENU_WIDTH = 300
const MENU_HEIGHT = 200
const PADDING = 10
type LibrarySystemView = Extract<SystemWorkspaceView, 'settings' | 'profile' | 'resource-monitor'>

const LibraryPage: React.FC = () => {
  const navigate = useNavigate()
  const { user, isLoggedIn } = useAuth()
  const displayName = isLoggedIn ? user?.nickname || user?.username || 'User' : '未登录'
  const mediaEntries = useMediaEntries()
  const {
    libraries,
    loading,
    loadLibraries,
    handleCreateLibrary,
    handleDeleteLibrary,
    applyLocalLibraryEdit,
    toggleStar
  } = useLibraryPage()

  const [createVisible, setCreateVisible] = useState(false)
  const [createName, setCreateName] = useState('')
  const [menu, setMenu] = useState<MenuState>({
    visible: false,
    x: 0,
    y: 0,
    mode: 'blank',
    library: null,
  })
  const [editVisible, setEditVisible] = useState(false)
  const [editingLibrary, setEditingLibrary] = useState<Library | null>(null)
  const [editName, setEditName] = useState('')
  const [editStarred, setEditStarred] = useState(false)
  const [quickAccessMode, setQuickAccessMode] = useState<QuickAccessMode>('all')
  const [librarySystemView, setLibrarySystemView] = useState<LibrarySystemView | null>(null)
  const [librarySettingsSection, setLibrarySettingsSection] = useState<SettingsWorkspaceSection>('home')

  const wrapperRef = useRef<HTMLDivElement>(null)

  const userContent = (
    <div
      className="user-trigger"
      onClick={(event) => {
        event.stopPropagation()
        if (!isLoggedIn) {
          navigate('/login')
          return
        }
        setLibrarySystemView('profile')
      }}
      title={isLoggedIn ? displayName : '登录'}
    >
      <Avatar
        size="extra-extra-small"
        src={user?.avatar}
        style={{
          backgroundColor: isLoggedIn ? 'var(--app-accent)' : 'var(--semi-color-fill-2)',
        }}
      >
        {isLoggedIn ? (displayName?.[0]?.toUpperCase() || 'U') : '未'}
      </Avatar>
    </div>
  )

  const handleMediaActivate = (tabId: string) => {
    const entry = mediaEntries.find(item => item.tabId === tabId)
    if (!entry || entry.libraryId == null) return
    setPendingActivation(entry.libraryId, tabId)
    navigate(`/libraries/${entry.libraryId}`)
  }

  const handleMediaRefresh = () => {
    void loadLibraries()
  }

  const closeLibrarySystemView = () => {
    setLibrarySystemView(null)
    setLibrarySettingsSection('home')
  }

  const openLibrarySettingsView = () => {
    setLibrarySystemView('settings')
    setLibrarySettingsSection('home')
  }

  const openLibraryResourceMonitorView = () => {
    setLibrarySystemView('resource-monitor')
    setLibrarySettingsSection('home')
  }

  // 关闭右键菜单：点击空白或 ESC
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const menuEl = document.getElementById('library-context-menu')
      if (menuEl && !menuEl.contains(e.target as Node)) {
        setMenu(m => ({ ...m, visible: false, mode: 'blank', library: null }))
      }
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(m => ({ ...m, visible: false, mode: 'blank', library: null }))
      }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [])

  const preventSystemMenu = (e: React.MouseEvent) => e.preventDefault()

  const clampToViewport = (x: number, y: number) => {
    const maxX = window.innerWidth - MENU_WIDTH - PADDING
    const maxY = window.innerHeight - MENU_HEIGHT - PADDING
    return { x: Math.min(x, maxX), y: Math.min(y, maxY) }
  }

  const handleContextMenu = (e: React.MouseEvent, library: Library) => {
    e.preventDefault()
    e.stopPropagation()
    const { x, y } = clampToViewport(e.clientX, e.clientY)

    if (menu.visible) {
      setMenu(m => ({ ...m, visible: false }));
      setTimeout(() => {
        setMenu({ visible: true, x, y, mode: 'library', library });
      }, 0);
    } else {
      setMenu({ visible: true, x, y, mode: 'library', library });
    }
  }

  const handleBlankContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const { x, y } = clampToViewport(e.clientX, e.clientY)
    setMenu({ visible: true, x, y, mode: 'blank', library: null })
  }

  const handleMoreClick = (e: React.MouseEvent, library: Library) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const { x, y } = clampToViewport(rect.right, rect.bottom)
    setMenu({ visible: true, x, y, mode: 'library', library })
  }

  const handleCreate = async () => {
    const success = await handleCreateLibrary(createName)
    if (success) {
      setCreateVisible(false)
      setCreateName('')
    }
  }

  const openEditModal = () => {
    if (menu.mode !== 'library' || !menu.library) return
    setEditingLibrary(menu.library)
    setEditName(menu.library.name)
    setEditStarred(!!menu.library.starred)
    setEditVisible(true)
    setMenu(m => ({ ...m, visible: false, mode: 'blank', library: null }))
  }

  const submitEdit = () => {
    if (!editingLibrary) return
    const nextName = editName.trim()
    if (!nextName) {
      Toast.warning('仓库名称不能为空')
      return
    }
    applyLocalLibraryEdit(editingLibrary.id, {
      name: nextName,
      starred: editStarred,
    })
    setEditVisible(false)
    setEditingLibrary(null)
  }

  const doDelete = () => {
    const library = menu.library;
    if (!library) return;
    Modal.confirm({
      title: '确认删除？',
      content: `确定要删除库「${library.name}」吗？`,
      okText: '删除',
      cancelText: '取消',
      okType: 'danger',
      async onOk() {
        const success = await handleDeleteLibrary(library.id)
        if (success) {
          await releaseLibraryWorkspace(library)
          setMenu(m => ({ ...m, visible: false, mode: 'blank', library: null }))
        }
      },
    });
  };

  const releaseLibraryWorkspace = React.useCallback(async (
    library: Pick<Library, 'id' | 'name'>,
    options?: { showToast?: boolean },
  ) => {
    const result = await disposeLibraryWorkspace(library.id)
    if (options?.showToast) {
      if (result.failedBrowserTabIds.length > 0) {
        Toast.warning(`已清空「${library.name}」的工作区状态，但有 ${result.failedBrowserTabIds.length} 个浏览器视图未确认关闭`)
        return
      }
      Toast.success(`已释放「${library.name}」的工作区资源`)
    }
  }, [])

  const doReleaseWorkspace = () => {
    const library = menu.library
    if (!library) return
    setMenu(m => ({ ...m, visible: false, mode: 'blank', library: null }))
    Modal.confirm({
      title: '释放仓库工作区？',
      content: `会清空「${library.name}」的文件页签、浏览器页签和搜索工作区状态，下次进入将从默认状态开始。`,
      okText: '释放',
      cancelText: '取消',
      okType: 'danger',
      async onOk() {
        await releaseLibraryWorkspace(library, { showToast: true })
      },
    })
  }

  const openCreateModalFromMenu = () => {
    setMenu(m => ({ ...m, visible: false, mode: 'blank', library: null }))
    setCreateVisible(true)
  }

  const visibleLibraries = useMemo(() => {
    if (quickAccessMode === 'favorites') {
      return libraries.filter(library => library.starred)
    }
    if (quickAccessMode === 'recent') {
      return libraries
    }
    return libraries
  }, [libraries, quickAccessMode])

  const emptyTip = useMemo(() => {
    if (quickAccessMode === 'favorites') {
      return '暂无收藏库，点击库卡片右上角星标可收藏。'
    }
    if (quickAccessMode === 'recent') {
      return '最近访问即将支持。'
    }
    return '暂无库，右键空白区域可新建库。'
  }, [quickAccessMode])

  const isEmpty = useMemo(() => visibleLibraries.length === 0, [visibleLibraries])
  const activeSystemMeta = librarySystemView ? systemWorkspaceMeta[librarySystemView] : null
  const ActiveSystemView = librarySystemView ? systemWorkspaceViews[librarySystemView] : null
  const librarySystemFrameSize = librarySystemView === 'settings' && librarySettingsSection !== 'home'
    ? 'detail'
    : 'normal'

  return (
    <LibraryWrapper ref={wrapperRef} onContextMenu={preventSystemMenu}>
      <ContentRow>
        <QuickAccessSidebar
          mode={quickAccessMode}
          onModeChange={setQuickAccessMode}
          onOpenSettings={openLibrarySettingsView}
          onOpenResourceMonitor={openLibraryResourceMonitorView}
          onSidebarClick={closeLibrarySystemView}
          footerContent={userContent}
        />
        <VerticalDivider />
        <CardArea onContextMenu={librarySystemView ? undefined : handleBlankContextMenu}>
          <LibraryMainToolbar>
            <div className="toolbar-left">
              <RightHeaderTitle>{activeSystemMeta?.title || '我的库'}</RightHeaderTitle>
            </div>
            <div className="toolbar-spacer" />
            <div className="toolbar-right">
              {mediaEntries.length > 0 ? (
                <Popover
                  trigger="click"
                  showArrow={false}
                  position="bottomRight"
                  spacing={6}
                  getPopupContainer={getAppPopupContainer}
                  content={
                    <MediaHubPopover
                      entries={mediaEntries}
                      onActivate={handleMediaActivate}
                      onToggle={(entry) => {
                        if (entry.isPlaying) {
                          mediaRegistry.pause(entry.entryId)
                        } else {
                          void mediaRegistry.play(entry.entryId)
                        }
                      }}
                      onSeek={(entry, time) => {
                        mediaRegistry.seek(entry.entryId, time)
                      }}
                      onDismiss={(entry) => {
                        mediaRegistry.dismiss(entry.entryId)
                      }}
                    />
                  }
                >
                  <button
                    type="button"
                    className="toolbar-action-btn"
                    title="正在播放的媒体"
                  >
                    <IconMusic />
                  </button>
                </Popover>
              ) : null}
              <button
                type="button"
                className="toolbar-action-btn"
                onClick={handleMediaRefresh}
                title="刷新库列表"
                disabled={loading}
              >
                <IconRefresh />
              </button>
            </div>
          </LibraryMainToolbar>
          <RightHeaderDivider />
          {ActiveSystemView ? (
            <LibrarySystemScroll>
              <LibrarySystemFrame data-size={librarySystemFrameSize}>
                <ActiveSystemView
                  currentView={librarySystemView as SystemWorkspaceView}
                  libraryId={0}
                  onClose={closeLibrarySystemView}
                  onOpenLegacyRoute={navigate}
                  onOpenView={(view) => {
                    if (view === 'settings' || view === 'profile' || view === 'resource-monitor') {
                      setLibrarySystemView(view)
                    }
                  }}
                  onSettingsSectionChange={setLibrarySettingsSection}
                  settingsSection={librarySystemView === 'settings' ? librarySettingsSection : 'home'}
                />
              </LibrarySystemFrame>
            </LibrarySystemScroll>
          ) : isEmpty ? (
            <EmptyTip>{emptyTip}</EmptyTip>
          ) : (
            <CardScroll onContextMenu={handleBlankContextMenu}>
              <CardGrid>
                {visibleLibraries.map(library => (
                  <LibraryCard
                    key={library.id}
                    library={library}
                    onContextMenu={(e) => handleContextMenu(e, library)}
                    onMoreClick={(e) => handleMoreClick(e, library)}
                    onDoubleClick={() => navigate(`/libraries/${library.id}`)}
                    onToggleStar={() => toggleStar(library)}
                  />
                ))}
              </CardGrid>
            </CardScroll>
          )}
        </CardArea>
      </ContentRow>

      <LibraryContextMenu
        visible={menu.visible}
        x={menu.x}
        y={menu.y}
        mode={menu.mode}
        library={menu.library}
        onCreate={openCreateModalFromMenu}
        onEdit={openEditModal}
        onReleaseWorkspace={doReleaseWorkspace}
        onDelete={doDelete}
        onClose={() => setMenu(m => ({ ...m, visible: false, mode: 'blank', library: null }))}
      />

      <LibraryCreateModal
        visible={createVisible}
        name={createName}
        onNameChange={setCreateName}
        onConfirm={handleCreate}
        onCancel={() => setCreateVisible(false)}
      />

      <LibraryEditModal
        visible={editVisible}
        name={editName}
        starred={editStarred}
        onNameChange={setEditName}
        onStarredChange={setEditStarred}
        onConfirm={submitEdit}
        onCancel={() => {
          setEditVisible(false)
          setEditingLibrary(null)
        }}
      />
    </LibraryWrapper>
  )
}

export default LibraryPage
