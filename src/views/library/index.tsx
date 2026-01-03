import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Modal } from '@douyinfe/semi-ui'
import { IconPlus } from '@douyinfe/semi-icons'

import LibraryWrapper, {
  ContentRow,
  VerticalDivider,
  CardArea,
  RightHeader,
  RightHeaderTitle,
  RightHeaderDivider,
  CardScroll,
  CardGrid,
  EmptyTip
} from './style'

import { useLibraryPage } from './hooks/useLibraryPage.ts'
import QuickAccessSidebar from './components/quick-access-sidebar'
import LibraryCard from './components/library-card'
import LibraryContextMenu from './components/library-context-menu'
import LibraryCreateModal from './components/library-create-modal'
import type { Library } from "@/features/file-explorer/services/file.api"

type MenuState = {
  visible: boolean
  x: number
  y: number
  library: Library | null
}

const MENU_WIDTH = 300
const MENU_HEIGHT = 200
const PADDING = 10

const LibraryPage: React.FC = () => {
  const navigate = useNavigate()
  const {
    libraries,
    handleCreateLibrary,
    handleDeleteLibrary,
    handleRenameLibrary,
    toggleStar
  } = useLibraryPage()

  const [createVisible, setCreateVisible] = useState(false)
  const [createName, setCreateName] = useState('')
  const [menu, setMenu] = useState<MenuState>({ visible: false, x: 0, y: 0, library: null })
  const [editingLibraryId, setEditingLibraryId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const wrapperRef = useRef<HTMLDivElement>(null)

  // 关闭右键菜单：点击空白或 ESC
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const menuEl = document.getElementById('library-context-menu')
      if (menuEl && !menuEl.contains(e.target as Node)) {
        setMenu(m => ({ ...m, visible: false, library: null }))
      }
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingLibraryId !== null) {
          setEditingLibraryId(null)
          setRenameValue('')
        }
        setMenu(m => ({ ...m, visible: false, library: null }))
      }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [editingLibraryId])

  const preventSystemMenu = (e: React.MouseEvent) => e.preventDefault()

  const clampToViewport = (x: number, y: number) => {
    const maxX = window.innerWidth - MENU_WIDTH - PADDING
    const maxY = window.innerHeight - MENU_HEIGHT - PADDING
    return { x: Math.min(x, maxX), y: Math.min(y, maxY) }
  }

  const handleContextMenu = (e: React.MouseEvent, library: Library) => {
    e.preventDefault()
    e.stopPropagation() // 增加：阻止冒泡
    if (editingLibraryId !== null) return
    const { x, y } = clampToViewport(e.clientX, e.clientY)
    
    // 如果已经可见，先重置一下状态确保位置更新
    if (menu.visible) {
      setMenu(m => ({ ...m, visible: false }));
      setTimeout(() => {
        setMenu({ visible: true, x, y, library });
      }, 0);
    } else {
      setMenu({ visible: true, x, y, library });
    }
  }

  const handleMoreClick = (e: React.MouseEvent, library: Library) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const { x, y } = clampToViewport(rect.right, rect.bottom)
    setMenu({ visible: true, x, y, library })
  }

  const handleCreate = async () => {
    const success = await handleCreateLibrary(createName)
    if (success) {
      setCreateVisible(false)
      setCreateName('')
    }
  }

  const enterRename = () => {
    if (!menu.library) return
    setEditingLibraryId(menu.library.id)
    setRenameValue(menu.library.name)
    setMenu(m => ({ ...m, visible: false, library: null }))
  }

  const submitRename = async () => {
    if (editingLibraryId === null) return
    const success = await handleRenameLibrary(editingLibraryId, renameValue)
    if (success) {
      setEditingLibraryId(null)
      setRenameValue('')
    }
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
          setMenu(m => ({ ...m, visible: false, library: null }))
        }
      },
    });
  };

  const isEmpty = useMemo(() => libraries.length === 0, [libraries])

  return (
    <LibraryWrapper ref={wrapperRef} onContextMenu={preventSystemMenu}>
      <ContentRow>
        <QuickAccessSidebar />
        <VerticalDivider />
        <CardArea>
          <RightHeader>
            <RightHeaderTitle>我的库</RightHeaderTitle>
            <Button icon={<IconPlus />} theme="solid" onClick={() => setCreateVisible(true)}>
              新建库
            </Button>
          </RightHeader>
          <RightHeaderDivider />
          {isEmpty ? (
            <EmptyTip>暂无库，点击右上角「新建库」创建一个吧～</EmptyTip>
          ) : (
            <CardScroll>
              <CardGrid>
                {libraries.map(library => (
                  <LibraryCard
                    key={library.id}
                    library={library}
                    isEditing={editingLibraryId === library.id}
                    renameValue={renameValue}
                    onRenameChange={setRenameValue}
                    onRenameSubmit={submitRename}
                    onRenameCancel={() => {
                      setEditingLibraryId(null);
                      setRenameValue('');
                    }}
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
        library={menu.library}
        onRename={enterRename}
        onDelete={doDelete}
        onClose={() => setMenu(m => ({ ...m, visible: false, library: null }))}
      />

      <LibraryCreateModal
        visible={createVisible}
        name={createName}
        onNameChange={setCreateName}
        onConfirm={handleCreate}
        onCancel={() => setCreateVisible(false)}
      />
    </LibraryWrapper>
  )
}

export default LibraryPage
