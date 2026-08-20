import React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { IconPlus } from '@douyinfe/semi-icons';
import { Button, Spin, Toast } from '@douyinfe/semi-ui';

import { openCompactConfirm } from '@/components/ui/compact-confirm';
import AIServiceIcon from './AIServiceIcon';
import AIServiceProfileEditor from './AIServiceProfileEditor';
import AIServiceProfileRow from './AIServiceProfileRow';
import {
  buildAIServiceSaveInput,
  createAIServiceEditorDraft,
  createEmptyAIServiceEditorDraft,
  type AIServiceEditorDraft,
} from './ai-service.editor';
import { AI_SERVICE_PROVIDER_BY_TYPE } from './ai-service.providers';
import {
  activateAIServiceProfile,
  deleteAIServiceProfile,
  duplicateAIServiceProfile,
  fetchAIServiceProfiles,
  revealAIServiceProfileApiKey,
  reorderAIServiceProfiles,
  saveAIServiceProfile,
} from './ai-service.api';
import type {
  AIServiceProfile,
  AIServiceProviderType,
  AIServiceSnapshot,
} from './ai-service.types';
import { AIServiceGlobalStyle, AIServiceWorkspaceShell } from './styles';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function AIServiceWorkspace() {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [snapshot, setSnapshot] = React.useState<AIServiceSnapshot>({
    activeProfileId: null,
    profiles: [],
  });
  const [loading, setLoading] = React.useState(true);
  const [operatingId, setOperatingId] = React.useState<string | null>(null);
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [revealingApiKey, setRevealingApiKey] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [draft, setDraft] = React.useState<AIServiceEditorDraft>(createEmptyAIServiceEditorDraft);
  const apiKeyRevealRequestIdRef = React.useRef(0);

  React.useEffect(() => {
    let active = true;
    fetchAIServiceProfiles()
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch((error) => {
        if (active) Toast.error(errorMessage(error, 'AI 服务配置加载失败'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadDraftApiKey = React.useCallback(async (profileId: string) => {
    const requestId = apiKeyRevealRequestIdRef.current + 1;
    apiKeyRevealRequestIdRef.current = requestId;
    setRevealingApiKey(true);
    try {
      const apiKey = await revealAIServiceProfileApiKey(profileId);
      if (apiKeyRevealRequestIdRef.current !== requestId) return false;
      setDraft((current) => current.id === profileId ? {
        ...current,
        apiKey,
        apiKeyLoaded: true,
      } : current);
      return true;
    } catch (error) {
      if (apiKeyRevealRequestIdRef.current !== requestId) return false;
      Toast.error(errorMessage(error, '读取 API Key 失败'));
      return false;
    } finally {
      if (apiKeyRevealRequestIdRef.current === requestId) {
        setRevealingApiKey(false);
      }
    }
  }, []);

  const openCreate = React.useCallback(() => {
    apiKeyRevealRequestIdRef.current += 1;
    setRevealingApiKey(false);
    setDraft(createEmptyAIServiceEditorDraft());
    setEditorVisible(true);
  }, []);

  const openEdit = React.useCallback((profile: AIServiceProfile) => {
    apiKeyRevealRequestIdRef.current += 1;
    setRevealingApiKey(false);
    setDraft(createAIServiceEditorDraft(profile));
    setEditorVisible(true);
    if (profile.hasApiKey) {
      void loadDraftApiKey(profile.id);
    }
  }, [loadDraftApiKey]);

  const closeEditor = React.useCallback(() => {
    apiKeyRevealRequestIdRef.current += 1;
    setEditorVisible(false);
    setRevealingApiKey(false);
    setDraft(createEmptyAIServiceEditorDraft());
  }, []);

  React.useEffect(() => () => {
    apiKeyRevealRequestIdRef.current += 1;
  }, []);

  const changeProvider = React.useCallback((providerType: AIServiceProviderType) => {
    setDraft((current) => {
      const currentProvider = AI_SERVICE_PROVIDER_BY_TYPE[current.providerType];
      const nextProvider = AI_SERVICE_PROVIDER_BY_TYPE[providerType];
      const shouldUseDefaultUrl = !current.baseUrl.trim()
        || current.baseUrl === currentProvider.defaultBaseUrl;
      return {
        ...current,
        baseUrl: shouldUseDefaultUrl ? nextProvider.defaultBaseUrl : current.baseUrl,
        providerType,
      };
    });
  }, []);

  const updateDraft = React.useCallback((changes: Partial<AIServiceEditorDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
  }, []);

  const revealDraftApiKey = React.useCallback(async () => {
    const profileId = draft.id;
    if (!profileId || !draft.hasStoredApiKey) return true;
    return loadDraftApiKey(profileId);
  }, [draft.hasStoredApiKey, draft.id, loadDraftApiKey]);

  const runProfileAction = React.useCallback(async (
    actionId: string,
    action: () => Promise<AIServiceSnapshot>,
    successMessage: string,
  ) => {
    setOperatingId(actionId);
    try {
      setSnapshot(await action());
      Toast.success(successMessage);
    } catch (error) {
      Toast.error(errorMessage(error, '操作失败'));
    } finally {
      setOperatingId(null);
    }
  }, []);

  const handleSave = React.useCallback(async () => {
    const input = buildAIServiceSaveInput(draft);
    setSaving(true);
    try {
      setSnapshot(await saveAIServiceProfile(input));
      closeEditor();
      Toast.success(draft.id ? 'AI 服务配置已更新' : 'AI 服务配置已创建');
    } catch (error) {
      Toast.error(errorMessage(error, '保存失败'));
    } finally {
      setSaving(false);
    }
  }, [closeEditor, draft]);

  const confirmDelete = React.useCallback((profile: AIServiceProfile) => {
    openCompactConfirm({
      title: '删除 AI 服务配置',
      content: `确定删除“${profile.name}”吗？此操作会同时移除本机保存的 API Key。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { type: 'danger' },
      onOk: () => runProfileAction(
        `delete:${profile.id}`,
        () => deleteAIServiceProfile(profile.id),
        'AI 服务配置已删除',
      ),
    });
  }, [runProfileAction]);

  const handleProfileDragEnd = React.useCallback(async (event: DragEndEvent) => {
    if (operatingId) return;
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || activeId === overId) return;
    const profileIds = snapshot.profiles.map((profile) => profile.id);
    const fromIndex = profileIds.indexOf(activeId);
    const toIndex = profileIds.indexOf(overId);
    if (fromIndex < 0 || toIndex < 0) return;

    setOperatingId('reorder');
    try {
      setSnapshot(await reorderAIServiceProfiles(arrayMove(profileIds, fromIndex, toIndex)));
    } catch (error) {
      Toast.error(errorMessage(error, 'AI 服务顺序保存失败'));
    } finally {
      setOperatingId(null);
    }
  }, [operatingId, snapshot.profiles]);

  return (
    <AIServiceWorkspaceShell>
      <AIServiceGlobalStyle />
      <header className="ai-service-header">
        <div className="ai-service-heading">
          <h2 className="ai-service-title">AI 服务配置</h2>
          <div className="ai-service-description">管理本机可用的模型服务连接，API Key 由系统安全存储加密。</div>
        </div>
        {!editorVisible ? (
          <Button
            aria-label="添加 AI 服务配置"
            className="ai-service-add"
            disabled={loading}
            icon={<IconPlus />}
            title="添加 AI 服务配置"
            theme="solid"
            type="primary"
            onClick={openCreate}
          />
        ) : null}
      </header>

      <main className="ai-service-body">
        {editorVisible ? (
          <AIServiceProfileEditor
            draft={draft}
            revealingApiKey={revealingApiKey}
            saving={saving}
            onCancel={closeEditor}
            onChange={updateDraft}
            onProviderChange={changeProvider}
            onRevealApiKey={revealDraftApiKey}
            onSave={handleSave}
          />
        ) : loading ? (
          <div className="ai-service-loading"><Spin size="middle" /></div>
        ) : snapshot.profiles.length === 0 ? (
          <div className="ai-service-empty">
            <span className="ai-service-empty-icon"><AIServiceIcon /></span>
            <span className="ai-service-empty-title">还没有 AI 服务配置</span>
            <span>添加一个云端或本地 AI 服务配置。</span>
          </div>
        ) : (
          <DndContext
            collisionDetection={closestCenter}
            sensors={sensors}
            onDragEnd={handleProfileDragEnd}
          >
            <SortableContext
              items={snapshot.profiles.map((profile) => profile.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="ai-service-list">
                {snapshot.profiles.map((profile) => (
                  <AIServiceProfileRow
                    key={profile.id}
                    active={snapshot.activeProfileId === profile.id}
                    operatingId={operatingId}
                    profile={profile}
                    onActivate={() => runProfileAction(
                      `activate:${profile.id}`,
                      () => activateAIServiceProfile(profile.id),
                      `已启用 ${profile.name}`,
                    )}
                    onDelete={() => confirmDelete(profile)}
                    onDuplicate={() => runProfileAction(
                      `duplicate:${profile.id}`,
                      () => duplicateAIServiceProfile(profile.id),
                      '已复制 AI 服务配置',
                    )}
                    onEdit={() => openEdit(profile)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>
    </AIServiceWorkspaceShell>
  );
}
