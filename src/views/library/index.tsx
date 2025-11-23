import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Modal, Input, Toast } from '@douyinfe/semi-ui'
import {
  IconFolder,
  IconPlus,
  IconEdit,
  IconDelete,
  IconStar,
  IconStarStroked,
  IconMore
} from '@douyinfe/semi-icons'

import LibraryWrapper, {
  ContentRow,
  SideMenu,
  SideMenuHeader,
  SideMenuList,
  SideMenuItem,
  VerticalDivider,
  CardArea,
  RightHeader,
  RightHeaderTitle,
  RightHeaderDivider,
  CardScroll,
  CardGrid,
  CardItem,
  CardIcon,
  CardName,
  CardNameEdit,
  CardActions,
  ActionIconBtn,
  ContextMenu,
  ContextMenuTitle,
  ContextMenuActions,
  EmptyTip
} from './style'
import {createLibrary, deleteLibrary, fetchRepositories, renameLibrary} from "@/service/directory-sidebar.api.ts";

type Library = {
  createdAt: string
  updatedAt: string
  id: number
  userId: number
  name: string
  delFlag: number
  starred?: boolean
}

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
  const [libraries, setLibraries] = useState<Library[]>([])
  const [createVisible, setCreateVisible] = useState(false)
  const [createName, setCreateName] = useState('')

  const [menu, setMenu] = useState<MenuState>({ visible: false, x: 0, y: 0, library: null })

  // 就地重命名
  const [editingLibraryId, setEditingLibraryId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const wrapperRef = useRef<HTMLDivElement>(null)

  // 加载仓库
  useEffect(() => {
    (async () => {
      const list = await fetchRepositories();
      setLibraries(list);
    })();
  }, []);

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
    if (editingLibraryId !== null) return
    const { x, y } = clampToViewport(e.clientX, e.clientY)
    setMenu({ visible: true, x, y, library })
  }

  const handleMoreClick = (e: React.MouseEvent, library: Library) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const { x, y } = clampToViewport(rect.right, rect.bottom)
    setMenu({ visible: true, x, y, library })
  }

  const handleDoubleClick = (libraryId: number) => {
    if (editingLibraryId !== null) return
    navigate(`/libraries/${libraryId}`)
  }

  const handleCreate = async () => {
    const name = createName.trim()
    if (!name) {
      Toast.warning('库名不能为空')
      return
    }
    // 创建仓库
    await createLibrary({ userId: 0, name: createName });
    // 重新请求仓库列表
    const list = await fetchRepositories();
    setLibraries(list);

    setCreateVisible(false)
    setCreateName('')
    Toast.success('已创建')
  }

  const toggleStar = (library: Library) => {
    setLibraries(list => list.map(l => (l.id === library.id ? { ...l, starred: !l.starred } : l)))
  }

  const enterRename = () => {
    if (!menu.library) return
    setEditingLibraryId(menu.library.id)
    setRenameValue(menu.library.name)
    setMenu(m => ({ ...m, visible: false, library: null }))
  }

  const submitRename = async () => {
    if (editingLibraryId === null) return
    const newName = renameValue.trim()
    if (!newName) {
      Toast.warning('名称不能为空')
      return
    }
    try {
      await renameLibrary(editingLibraryId, newName)
      setLibraries(list =>
        list.map(l =>
          l.id === editingLibraryId
            ? { ...l, name: newName, updatedAt: new Date().toISOString() }
            : l
        )
      )
      setEditingLibraryId(null)
      setRenameValue('')
      Toast.success('重命名成功')
    } catch (err) {
      console.error('重命名失败:', err)
      Toast.error('重命名失败')
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
        try {
          await deleteLibrary(library.id);
          // 前端直接删除
          setLibraries(list => list.filter(l => l.id !== library.id));
          // 关闭右键菜单
          setMenu(m => ({ ...m, visible: false, library: null }));
          Toast.success('删除成功');
        } catch (err) {
          console.error('删除失败:', err);
          Toast.error('删除失败');
        }
      },
    });
  };

  const isEmpty = useMemo(() => libraries.length === 0, [libraries])

  return (
    <LibraryWrapper ref={wrapperRef} onContextMenu={preventSystemMenu}>
      <ContentRow>
        {/* 左侧：快速访问（沾满左侧） */}
        <SideMenu>
          <SideMenuHeader>快速访问</SideMenuHeader>
          <SideMenuList>
            <SideMenuItem>我的收藏</SideMenuItem>
            <SideMenuItem>最近访问文件</SideMenuItem>
          </SideMenuList>
        </SideMenu>

        {/* 左右分割线 */}
        <VerticalDivider />

        {/* 右侧：标题 + 右上角按钮 + 卡片区 */}
        <CardArea>
          <RightHeader>
            <RightHeaderTitle>我的库</RightHeaderTitle>
            <Button icon={<IconPlus />} theme="solid" onClick={() => setCreateVisible(true)}>
              新建库
            </Button>
          </RightHeader>

          {/* 右侧局部分割线（不占满宽度） */}
          <RightHeaderDivider />

          {isEmpty ? (
            <EmptyTip>暂无库，点击右上角「新建库」创建一个吧～</EmptyTip>
          ) : (
            <CardScroll>
              <CardGrid>
                {libraries.map(library => {
                  const isEditing = editingLibraryId === library.id
                  return (
                    <CardItem
                      key={library.id}
                      title={library.name}
                      onContextMenu={(e) => handleContextMenu(e, library)}
                      onDoubleClick={() => handleDoubleClick(library.id)}
                    >
                      <CardActions className="card-actions" onClick={(e) => e.stopPropagation()}>
                        <ActionIconBtn
                          aria-label={library.starred ? '取消收藏' : '收藏'}
                          onClick={() => toggleStar(library)}
                          title={library.starred ? '取消收藏' : '收藏'}
                        >
                          {library.starred ? <IconStar /> : <IconStarStroked />}
                        </ActionIconBtn>

                        <ActionIconBtn
                          aria-label="更多"
                          onClick={(e) => handleMoreClick(e, library)}
                          title="更多操作"
                        >
                          <IconMore />
                        </ActionIconBtn>
                      </CardActions>

                      <CardIcon><IconFolder size="extra-large" /></CardIcon>

                      {isEditing ? (
                        <CardNameEdit onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                          <Input
                            value={renameValue}
                            onChange={(v) => setRenameValue(v)}
                            autoFocus
                            onEnterPress={submitRename}
                            onBlur={submitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.stopPropagation()
                                setEditingLibraryId(null)
                                setRenameValue('')
                              }
                            }}
                            style={{ width: 260 }}
                            placeholder="输入新名称"
                          />
                        </CardNameEdit>
                      ) : (
                        <CardName>{library.name}</CardName>
                      )}
                    </CardItem>
                  )
                })}
              </CardGrid>
            </CardScroll>
          )}
        </CardArea>
      </ContentRow>

      {/* 右键/更多 菜单（竖直按钮） */}
      {menu.visible && (
        <ContextMenu id="library-context-menu" style={{ left: menu.x, top: menu.y }}>
          <ContextMenuTitle>{menu.library?.name}</ContextMenuTitle>
          <ContextMenuActions>
            <Button icon={<IconEdit />} onClick={enterRename}>重命名</Button>
            <Button icon={<IconDelete />} type="danger" onClick={doDelete}>删除</Button>
          </ContextMenuActions>
        </ContextMenu>
      )}

      {/* 新建库对话框（模拟） */}
      <Modal
        title="新建库"
        visible={createVisible}
        onOk={handleCreate}
        onCancel={() => setCreateVisible(false)}
        okText="创建"
      >
        <Input
          placeholder="请输入库名称"
          value={createName}
          onChange={v => setCreateName(v)}
        />
      </Modal>
    </LibraryWrapper>
  )
}

export default LibraryPage
