import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconCopy, IconDelete, IconEdit } from '@douyinfe/semi-icons';
import { Button } from '@douyinfe/semi-ui';

import { AIServiceProviderIcon } from './AIServiceProviderLabel';
import { AI_SERVICE_PROVIDER_BY_TYPE } from './ai-service.providers';
import type { AIServiceProfile } from './ai-service.types';

interface AIServiceProfileRowProps {
  active: boolean;
  operatingId: string | null;
  profile: AIServiceProfile;
  onActivate: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
}

export default function AIServiceProfileRow({
  active,
  operatingId,
  profile,
  onActivate,
  onDelete,
  onDuplicate,
  onEdit,
}: AIServiceProfileRowProps) {
  const disabled = Boolean(operatingId);
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: profile.id, disabled });
  const provider = AI_SERVICE_PROVIDER_BY_TYPE[profile.providerType];

  return (
    <div
      ref={setNodeRef}
      className={`ai-service-row ${active ? 'is-active' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span
        ref={setActivatorNodeRef}
        className="ai-service-avatar"
        title={`${provider.label}，拖动调整顺序`}
        {...attributes}
        {...listeners}
      >
        <AIServiceProviderIcon providerType={profile.providerType} />
      </span>
      <div className="ai-service-main">
        <div className="ai-service-name-line">
          <span className="ai-service-name" title={profile.name}>{profile.name}</span>
          {active ? <span className="ai-service-active-mark">使用中</span> : null}
        </div>
        <div className="ai-service-meta">
          <span className="ai-service-url" title={profile.baseUrl}>{profile.baseUrl}</span>
        </div>
      </div>
      <div className="ai-service-actions">
        {!active ? (
          <Button
            className="ai-service-activate"
            disabled={disabled}
            loading={operatingId === `activate:${profile.id}`}
            onClick={onActivate}
          >
            启用
          </Button>
        ) : null}
        <Button
          aria-label={`编辑${profile.name}`}
          className="ai-service-icon-action"
          disabled={disabled}
          icon={<IconEdit />}
          theme="borderless"
          title="编辑"
          onClick={onEdit}
        />
        <Button
          aria-label={`复制${profile.name}`}
          className="ai-service-icon-action"
          disabled={disabled}
          icon={<IconCopy />}
          loading={operatingId === `duplicate:${profile.id}`}
          theme="borderless"
          title="复制"
          onClick={onDuplicate}
        />
        <Button
          aria-label={`删除${profile.name}`}
          className="ai-service-icon-action is-danger"
          disabled={disabled}
          icon={<IconDelete />}
          theme="borderless"
          title="删除"
          onClick={onDelete}
        />
      </div>
    </div>
  );
}
