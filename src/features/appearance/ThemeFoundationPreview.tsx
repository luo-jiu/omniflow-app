import { useContext, useEffect, useId, useRef, useState } from 'react';
import { Button, Checkbox, Select, Switch } from '@douyinfe/semi-ui';
import styled from 'styled-components';
import { ResourceLabel } from '@/components/business/resource-label';
import ContextMenu from '@/components/ui/context-menu';
import {
  ThemeButton, ThemeInput, ThemeSelectableButton, ThemeSurface, ThemeText,
} from '@/components/ui/theme-foundation';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';
import folderIcon from '@/assets/icons/material/folder-base.svg';
import galleryIcon from '@/assets/icons/material/folder-gallery.svg';
import { AppearanceControlContext, AppearanceViewContext } from './appearance.context';
import { BUILT_IN_COLOR_THEMES } from './built-in-themes';
import ThemedDirectoryIcon from './ThemedDirectoryIcon';
import type { ThemeOperationToken, ThemeSelection } from './theme-state';

const Page = styled(ThemeSurface)<{ $embedded: boolean }>`
  width: 100%; min-width: 0; flex: 1; height: 100%; min-height: 0; overflow: auto;
  padding: ${({ $embedded }) => $embedded ? '16px' : '38px 28px 28px'};
  container: theme-preview / inline-size;
  font-size: 13px; line-height: 1.5;
  ${workspaceScrollbarStyles}
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: 22px; line-height: 1.35; font-weight: 600; }
  h2 { font-size: 14px; line-height: 1.5; font-weight: 600; }
  h3 { font-size: 13px; line-height: 1.5; font-weight: 600; }
  @media (max-width: 760px) {
    padding: ${({ $embedded }) => $embedded ? '16px' : '38px 16px 20px'};
  }
`;
const Content = styled.div`max-width: 1160px; margin: 0 auto; display: grid; gap: 18px;`;
const Header = styled.header`
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 14px;
  > div { min-width: 0; }
  p { margin-top: 6px; max-width: 680px; }
`;
const Row = styled.div`display: flex; align-items: center; flex-wrap: wrap; gap: 8px;`;
const Toolbar = styled(ThemeSurface)`
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
  gap: 12px; padding: 12px 14px; border: 1px solid var(--app-border); border-radius: var(--app-radius-medium);
`;
const ControlGroup = styled.div`
  display: flex; align-items: center; flex-wrap: wrap; gap: 5px;
  > span:first-child { margin-right: 6px; font-size: 12px; }
`;
const Grid = styled.div`
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px;
  @container theme-preview (max-width: 820px) { grid-template-columns: minmax(0, 1fr); }
`;
const Section = styled(ThemeSurface)`
  min-width: 0; padding: 16px; border: 1px solid var(--app-border); border-radius: var(--app-radius-medium);
  > p { margin: 5px 0 14px; }
`;
const SurfaceGrid = styled.div`
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;
  @container theme-preview (max-width: 440px) { grid-template-columns: minmax(0, 1fr); }
`;
const SurfaceSample = styled(ThemeSurface)`
  min-height: 70px; padding: 12px; border: 1px solid var(--app-border); border-radius: var(--app-radius-small);
  display: grid; gap: 4px; align-content: center;
`;
const TextSamples = styled.div`
  display: grid; gap: 8px; padding-top: 14px; margin-top: 14px; border-top: 1px solid var(--app-border);
`;
const DirectoryList = styled(ThemeSurface)`
  padding: 6px; border: 1px solid var(--app-border); border-radius: var(--app-radius-small);
`;
const DirectoryRow = styled(ThemeSelectableButton)`
  width: 100%; display: flex; align-items: center; justify-content: flex-start; gap: 8px;
  padding: 8px; min-height: 36px; text-align: left;
  .directory-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .directory-detail { margin-left: auto; flex: none; font-size: 11px; }
`;
const SelectionSummary = styled(ThemeSurface)`
  margin-top: 12px; padding: 12px; border-radius: var(--app-radius-small);
  display: grid; gap: 5px;
`;
const Field = styled.label`
  display: grid; gap: 6px; min-width: 0;
  > span { font-size: 12px; }
`;
const FormGrid = styled.div`
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;
  @container theme-preview (max-width: 440px) { grid-template-columns: minmax(0, 1fr); }
`;
const ErrorText = styled.p`color: var(--app-danger-text); font-size: 12px;`;
const StatusLine = styled.div<{ $tone: 'success' | 'warning' | 'danger' | 'info' }>`
  color: ${({ $tone }) => `var(--app-${$tone}-text)`};
  background: ${({ $tone }) => `var(--app-${$tone}-bg)`};
  border-left: 2px solid ${({ $tone }) => `var(--app-${$tone}-border)`};
  padding: 8px 10px; border-radius: var(--app-radius-small); font-size: 12px;
`;
const Stack = styled.div`display: grid; gap: 10px;`;
const Footer = styled.footer`font-size: 12px; display: grid; gap: 4px;`;

const directories = [
  { id: 'notes', name: '阅读笔记', detail: '普通目录', icon: folderIcon, assetName: 'folder-base', archived: false },
  { id: 'gallery', name: '旅行照片', detail: '图集目录', icon: galleryIcon, assetName: 'folder-gallery', archived: false },
  { id: 'archive', name: '旅行照片 · 年度归档', detail: '归档已开启', icon: galleryIcon, assetName: 'folder-gallery', archived: true },
  { id: 'long', name: '一段很长的目录名称，用于观察窄空间中的截断与选中状态', detail: '普通目录', icon: folderIcon, assetName: 'folder-base', archived: false },
] as const;
const surfaces = [
  { surface: 'app', title: '页面底色', description: '承托整页内容' },
  { surface: 'panel', title: '内容面板', description: '同一组内容的归属' },
  { surface: 'elevated', title: '卡片表面', description: '独立条目与信息卡片' },
  { surface: 'raised', title: '次级表面', description: '局部工具与摘要' },
  { surface: 'input', title: '输入表面', description: '需要填写或编辑的位置' },
  { surface: 'popover', title: '浮层表面', description: '菜单与弹出内容' },
] as const;
const modes = [{ mode: 'light', label: '白天' }, { mode: 'dark', label: '夜间' }, { mode: 'system', label: '跟随系统' }] as const;

interface ThemeFoundationPreviewProps {
  embedded?: boolean;
  onBack?: () => void;
}

/** Reusable preview. The application ThemeProvider remains the sole theme owner. */
export default function ThemeFoundationPreview({ embedded = false, onBack }: ThemeFoundationPreviewProps) {
  const controls = useContext(AppearanceControlContext);
  const view = useContext(AppearanceViewContext);
  const activePreview = useRef<ThemeOperationToken | null>(null);
  const cancel = controls?.cancel;
  const id = useId();
  const [error, setError] = useState('');
  const [selectedDirectory, setSelectedDirectory] = useState<string>('archive');
  const [name, setName] = useState('一份清晰的阅读笔记');
  const [fieldError, setFieldError] = useState(true);
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [density, setDensity] = useState('compact');
  const [action, setAction] = useState('按钮只更新本页反馈，不操作真实资料。');

  useEffect(() => () => {
    if (activePreview.current) cancel?.(activePreview.current);
    activePreview.current = null;
  }, [cancel]);

  if (!controls || !view) return null;
  const selected = directories.find(directory => directory.id === selectedDirectory)!;
  const preview = (patch: Partial<Pick<ThemeSelection, 'colorThemeId' | 'mode'>>) => {
    try {
      activePreview.current = controls.preview({
        ...controls.selection,
        ...patch,
      });
      setError('');
    } catch {
      setError('未能预览，请恢复已保存外观后重试。');
    }
  };
  const restore = () => {
    if (activePreview.current) controls.cancel(activePreview.current);
    activePreview.current = null;
    setError('');
  };
  return <Page as="main" $surface="app" $embedded={embedded} aria-label="主题预览">
    <Content>
      {onBack && <Row><ThemeButton $variant="quiet" onClick={onBack}>返回外观设置</ThemeButton></Row>}
      <Header>
        <div>
          <ThemeText as="h1" $tone="primary">主题预览</ThemeText>
          <ThemeText as="p" $tone="secondary">集中查看背景、文字、归档高亮和选中效果，也可以试试按钮、输入框与下拉菜单。切换配色和明暗，对照同一组内容的变化。</ThemeText>
        </div>
        <ThemeButton onClick={restore} disabled={!activePreview.current || controls.phase !== 'preview'}>恢复已保存外观</ThemeButton>
      </Header>
      <Toolbar $surface="panel" aria-label="外观预览">
        <ControlGroup role="group" aria-label="预览配色">
          <ThemeText $tone="secondary">配色</ThemeText>
          {BUILT_IN_COLOR_THEMES.map(theme => <ThemeSelectableButton key={theme.id}
            data-selected={controls.selection.colorThemeId === theme.id} aria-pressed={controls.selection.colorThemeId === theme.id}
            onClick={() => preview({ colorThemeId: theme.id })}>{theme.name}</ThemeSelectableButton>)}
        </ControlGroup>
        <ControlGroup role="group" aria-label="预览明暗模式">
          <ThemeText $tone="secondary">明暗</ThemeText>
          {modes.map(({ mode, label }) => <ThemeSelectableButton key={mode}
            data-selected={controls.selection.mode === mode} aria-pressed={controls.selection.mode === mode}
            onClick={() => preview({ mode })}>{label}</ThemeSelectableButton>)}
        </ControlGroup>
      </Toolbar>
      {error && <ErrorText role="alert">{error}</ErrorText>}
      <Grid>
        <Section as="section" $surface="panel" aria-labelledby={`${id}-surfaces`}>
          <ThemeText as="h2" id={`${id}-surfaces`}>表面与文字</ThemeText>
          <ThemeText as="p" $tone="secondary">区域靠层次区分，正文始终优先于辅助信息。</ThemeText>
          <SurfaceGrid>
            {surfaces.map(({ surface, title, description }) => <SurfaceSample key={surface} $surface={surface}>
              <ThemeText as="h3">{title}</ThemeText>
              <ThemeText $tone="secondary">{description}</ThemeText>
            </SurfaceSample>)}
          </SurfaceGrid>
          <TextSamples>
            <ThemeText $tone="primary">正文：值得先读的内容，保持清晰。</ThemeText>
            <ThemeText $tone="secondary">辅助：补充说明，不与主要内容争抢注意力。</ThemeText>
            <ThemeText $tone="muted">弱信息：更新时间、数量和其他元信息。</ThemeText>
            <ThemeText $tone="disabled">禁用：当前不可操作，与普通说明区分。</ThemeText>
            <ThemeText $tone="accent">强调：用于关键关联，避免铺满整个页面。</ThemeText>
          </TextSamples>
        </Section>
        <Section as="section" $surface="panel" aria-labelledby={`${id}-selection`}>
          <ThemeText as="h2" id={`${id}-selection`}>选择与归档状态</ThemeText>
          <ThemeText as="p" $tone="secondary">点击选择目录；归档高亮表达目录状态，选中底色表达当前选择，二者可以同时存在。</ThemeText>
          <DirectoryList $surface="sidebar" role="group" aria-label="示例目录">
            {directories.map(directory => <DirectoryRow key={directory.id}
              data-selected={directory.id === selectedDirectory} aria-pressed={directory.id === selectedDirectory}
              onClick={() => setSelectedDirectory(directory.id)} title={directory.name}>
              <ThemedDirectoryIcon src={directory.icon} assetName={directory.assetName} alt="" aria-hidden="true" />
              <ResourceLabel className="directory-name" $archived={directory.archived}>{directory.name}</ResourceLabel>
              <ThemeText className="directory-detail" $tone="secondary">{directory.detail}</ThemeText>
            </DirectoryRow>)}
          </DirectoryList>
          <SelectionSummary $surface="raised" aria-live="polite">
            <ThemeText $tone="secondary">当前选择</ThemeText>
            <ResourceLabel $archived={selected.archived}>{selected.name}</ResourceLabel>
            <ThemeText $tone="secondary">{selected.archived ? '归档名称使用独立颜色与较粗字重，选中后仍能辨认归档状态。' : '普通名称使用正文颜色，选中时保持可读。'}</ThemeText>
          </SelectionSummary>
          <ThemeText as="p" $tone="muted">用 Tab 移动焦点，焦点圈应与选中底色同时可见。</ThemeText>
        </Section>
        <Section as="section" $surface="panel" aria-labelledby={`${id}-controls`}>
          <ThemeText as="h2" id={`${id}-controls`}>输入与操作</ThemeText>
          <ThemeText as="p" $tone="secondary">试着悬停、点击或用 Tab 切换焦点，观察控件在可用、禁用和错误时的区别。</ThemeText>
          <Stack>
            <FormGrid>
              <Field><ThemeText>标题</ThemeText><ThemeInput value={name} onChange={event => setName(event.target.value)} placeholder="输入标题" /></Field>
              <Field><ThemeText>不可编辑</ThemeText><ThemeInput value="只读示例的禁用字段" disabled /></Field>
            </FormGrid>
            <Field>
              <ThemeText>必填字段</ThemeText>
              <ThemeInput required aria-invalid={fieldError} aria-describedby={`${id}-field-message`} placeholder="输入内容后清除错误" onChange={event => setFieldError(!event.target.value.trim())} />
              {fieldError ? <ErrorText id={`${id}-field-message`}>请填写内容，错误同时通过边框与文字表达。</ErrorText>
                : <ThemeText id={`${id}-field-message`} $tone="secondary">内容已填写，输入框恢复普通状态。</ThemeText>}
            </Field>
            <Row aria-label="操作优先级">
              <ThemeButton $variant="primary" onClick={() => setAction(`主要操作已响应：${name.trim() || '未填写标题'}。`)}>主要操作</ThemeButton>
              <ThemeButton $variant="secondary" onClick={() => setAction('普通操作已响应。')}>普通操作</ThemeButton>
              <ThemeButton $variant="outline" onClick={() => setAction('描边操作已响应。')}>描边操作</ThemeButton>
              <ThemeButton $variant="quiet" onClick={() => setAction('轻量操作已响应。')}>轻量操作</ThemeButton>
              <ThemeButton $variant="danger" onClick={() => setAction('危险操作样式已检查，没有删除任何内容。')}>危险操作</ThemeButton>
              <ThemeButton disabled>不可操作</ThemeButton>
            </Row>
            <ThemeText as="p" $tone="secondary" role="status">{action}</ThemeText>
          </Stack>
        </Section>
        <Section as="section" $surface="panel" aria-labelledby={`${id}-states`}>
          <ThemeText as="h2" id={`${id}-states`}>常见控件与反馈</ThemeText>
          <ThemeText as="p" $tone="secondary">查看勾选、开关和下拉效果；成功、警告和错误各有清楚的颜色与说明。</ThemeText>
          <Stack>
            <Row>
              <Checkbox checked={checked} onChange={event => setChecked(Boolean(event.target.checked))}>选择内容</Checkbox>
              <Switch checked={enabled} onChange={setEnabled} aria-label="示例开关" size="small" />
              <ThemeText $tone="secondary">{enabled ? '已启用' : '已停用'}</ThemeText>
              <Button theme="solid" size="small" onClick={() => setAction('附加操作已响应。')}>附加操作</Button>
            </Row>
            <Field>
              <ThemeText id={`${id}-select-label`}>打开下拉查看浮层</ThemeText>
              <Select value={density} onChange={value => setDensity(String(value))} aria-labelledby={`${id}-select-label`} size="small" style={{ width: '100%' }}
                optionList={[{ value: 'compact', label: '紧凑列表' }, { value: 'comfortable', label: '舒适列表' }, { value: 'unavailable', label: '不可用选项', disabled: true }]} />
            </Field>
            <StatusLine $tone="success">已完成 · 成功提示保留独立语义。</StatusLine>
            <StatusLine $tone="warning">需要留意 · 提示当前限制和下一步。</StatusLine>
            <StatusLine $tone="danger">操作失败 · 错误不只依靠颜色表达。</StatusLine>
            <StatusLine $tone="info">信息说明 · 补充当前状态的上下文。</StatusLine>
          </Stack>
        </Section>
      </Grid>
      <Section as="section" $surface="panel" aria-labelledby={`${id}-menu`}>
        <ThemeText as="h2" id={`${id}-menu`}>菜单状态</ThemeText>
        <ThemeText as="p" $tone="secondary">普通操作、危险操作与禁用项各自清楚；禁用项悬停时保持原状态。以下操作只显示示例反馈。</ThemeText>
        <ContextMenu className="directory-context-menu" style={{ maxWidth: 360 }} items={[
          { key: 'open', label: '打开示例', onClick: () => setAction('菜单中的普通操作已响应。') },
          { key: 'unavailable', label: '当前不可用', disabled: true },
          { key: 'divider', type: 'divider' },
          { key: 'delete', label: '删除示例', danger: true, onClick: () => setAction('危险菜单样式已检查，没有删除任何内容。') },
          { key: 'disabled-delete', label: '不可用的危险操作', danger: true, disabled: true },
        ]} />
        <ThemeText as="p" $tone="secondary">{action}</ThemeText>
      </Section>
      <Footer>
        <ThemeText $tone="secondary">此处切换仅作临时预览，并沿用你的自定义颜色；恢复或离开本页会回到已保存外观。要保留配色，请在外观设置中保存。示例操作不会修改真实资料。</ThemeText>
        <ThemeText $tone="muted">侧栏毛玻璃效果请结合实际工作区观察。图片、视频和网页内容保留原色。</ThemeText>
      </Footer>
    </Content>
  </Page>;
}
