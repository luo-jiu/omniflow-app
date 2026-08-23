import React from 'react';
import styled from 'styled-components';

import type {
  AgentInteractionResponse,
  AgentInteractionValue,
  AgentPresentationAction,
  AgentPresentationBlock,
} from '@/shared/agent/agent.types';

type InteractionBlock = Extract<AgentPresentationBlock, { type: 'choice' | 'form' }>;

const Interaction = styled.section`
  min-width: 0;
  display: grid;
  gap: 10px;

  .agent-interaction-title,
  .agent-interaction-prompt {
    margin: 0;
  }

  .agent-interaction-title {
    font-size: 14px;
    line-height: 1.45;
    font-weight: 600;
  }

  .agent-interaction-prompt {
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.55;
    white-space: pre-wrap;
  }

  .agent-interaction-options,
  .agent-interaction-fields {
    display: grid;
    gap: 7px;
  }

  .agent-interaction-option {
    min-width: 0;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
    padding: 8px 10px;
    border-radius: var(--app-radius-small);
    background: color-mix(in srgb, var(--app-text-muted) 6%, transparent);
    cursor: pointer;
  }

  .agent-interaction-option:has(input:checked) {
    background: color-mix(in srgb, var(--semi-color-primary) 14%, transparent);
  }

  .agent-interaction-option:has(input:disabled) {
    cursor: default;
  }

  .agent-interaction-option input {
    width: 16px;
    height: 16px;
    margin: 2px 0 0;
    accent-color: var(--semi-color-primary);
  }

  .agent-interaction-option-copy {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .agent-interaction-option-label,
  .agent-interaction-field-label {
    font-size: 13px;
    line-height: 1.45;
  }

  .agent-interaction-option-description {
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .agent-interaction-field {
    min-width: 0;
    display: grid;
    gap: 5px;
  }

  .agent-interaction-field input[type='text'],
  .agent-interaction-field input[type='number'],
  .agent-interaction-field select {
    width: 100%;
    height: 34px;
    min-width: 0;
    padding: 0 10px;
    border: 1px solid var(--app-border);
    border-radius: var(--app-radius-small);
    outline: 0;
    background: var(--app-bg);
    color: var(--app-text);
    font: inherit;
    font-size: 13px;
  }

  .agent-interaction-field input:focus,
  .agent-interaction-field select:focus {
    border-color: var(--semi-color-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--semi-color-primary) 16%, transparent);
  }

  .agent-interaction-boolean {
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .agent-interaction-boolean input {
    width: 16px;
    height: 16px;
    accent-color: var(--semi-color-primary);
  }

  .agent-interaction-footer {
    min-height: 30px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
  }

  .agent-interaction-state {
    margin-right: auto;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .agent-interaction-submit {
    min-width: 72px;
    height: 30px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--app-radius-large);
    background: var(--semi-color-primary);
    color: #fff;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .agent-interaction-submit:disabled {
    cursor: default;
    opacity: 0.48;
  }
`;

const INTERACTION_STATE_LABELS = {
  cancelled: '已取消',
  expired: '已过期',
  interrupted: '已中断',
  pending: '等待输入',
  submitted: '已提交',
} as const;

function initialChoice(block: Extract<InteractionBlock, { type: 'choice' }>): Set<string> {
  return new Set(block.response?.selectedOptionIds || []);
}

function initialForm(block: Extract<InteractionBlock, { type: 'form' }>): Record<string, string | boolean> {
  const responseValues = block.response?.values || {};
  return Object.fromEntries(block.fields.map((field) => {
    const value = responseValues[field.id];
    if (field.type === 'boolean') return [field.id, value === true];
    return [field.id, value === undefined ? '' : String(value)];
  }));
}

function buildFormResponse(
  block: Extract<InteractionBlock, { type: 'form' }>,
  draft: Record<string, string | boolean>,
): AgentInteractionResponse {
  const values: Record<string, AgentInteractionValue> = {};
  block.fields.forEach((field) => {
    const value = draft[field.id];
    if (field.type === 'boolean') {
      values[field.id] = value === true;
      return;
    }
    const text = typeof value === 'string' ? value : '';
    if (!text && !field.required) return;
    values[field.id] = field.type === 'number' ? Number(text) : text;
  });
  return { kind: 'form', values };
}

function isFormReady(
  block: Extract<InteractionBlock, { type: 'form' }>,
  draft: Record<string, string | boolean>,
): boolean {
  return block.fields.every((field) => {
    if (field.type === 'boolean') return true;
    const value = typeof draft[field.id] === 'string' ? draft[field.id] as string : '';
    if (field.required && !value.trim()) return false;
    return field.type !== 'number' || !value || Number.isFinite(Number(value));
  });
}

interface AgentInteractionBlockProps {
  block: InteractionBlock;
  busy: boolean;
  onAction?: (action: AgentPresentationAction) => void;
}

export default function AgentInteractionBlock({
  block,
  busy,
  onAction,
}: AgentInteractionBlockProps) {
  const choiceBlock = block.type === 'choice' ? block : null;
  const formBlock = block.type === 'form' ? block : null;
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => choiceBlock ? initialChoice(choiceBlock) : new Set(),
  );
  const [formDraft, setFormDraft] = React.useState<Record<string, string | boolean>>(
    () => formBlock ? initialForm(formBlock) : {},
  );
  const editable = block.status === 'pending' && !busy;
  const choiceInteractionId = choiceBlock?.interactionId;
  const choiceResponse = choiceBlock?.response;
  const formFields = formBlock?.fields;
  const formInteractionId = formBlock?.interactionId;
  const formResponse = formBlock?.response;

  React.useEffect(() => {
    if (!choiceInteractionId) return;
    setSelectedIds(new Set(choiceResponse?.selectedOptionIds || []));
  }, [choiceInteractionId, choiceResponse]);

  React.useEffect(() => {
    if (!formInteractionId || !formFields) return;
    const responseValues = formResponse?.values || {};
    setFormDraft(Object.fromEntries(formFields.map((field) => {
      const value = responseValues[field.id];
      if (field.type === 'boolean') return [field.id, value === true];
      return [field.id, value === undefined ? '' : String(value)];
    })));
  }, [formFields, formInteractionId, formResponse]);

  const response = choiceBlock
    ? { kind: 'choice' as const, selectedOptionIds: Array.from(selectedIds) }
    : formBlock
      ? buildFormResponse(formBlock, formDraft)
      : null;
  const ready = choiceBlock
    ? selectedIds.size > 0 && (choiceBlock.multiple || selectedIds.size === 1)
    : formBlock
      ? isFormReady(formBlock, formDraft)
      : false;

  const submit = () => {
    if (!editable || !ready || !response || !onAction) return;
    onAction({
      action: 'agent.interaction.submit',
      interactionId: block.interactionId,
      label: block.submitLabel || '提交',
      response,
    });
  };

  return (
    <Interaction aria-label={block.title || 'Agent 交互请求'}>
      {block.title ? <h4 className="agent-interaction-title">{block.title}</h4> : null}
      <p className="agent-interaction-prompt">{block.prompt}</p>
      {choiceBlock ? (
        <div className="agent-interaction-options">
          {choiceBlock.options.map(option => (
            <label className="agent-interaction-option" key={option.id}>
              <input
                checked={selectedIds.has(option.id)}
                disabled={!editable}
                name={`agent-interaction-${choiceBlock.interactionId}`}
                onChange={() => {
                  setSelectedIds((current) => {
                    if (!choiceBlock.multiple) return new Set([option.id]);
                    const next = new Set(current);
                    if (next.has(option.id)) next.delete(option.id);
                    else next.add(option.id);
                    return next;
                  });
                }}
                type={choiceBlock.multiple ? 'checkbox' : 'radio'}
              />
              <span className="agent-interaction-option-copy">
                <span className="agent-interaction-option-label">{option.label}</span>
                {option.description ? (
                  <span className="agent-interaction-option-description">{option.description}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      ) : null}
      {formBlock ? (
        <div className="agent-interaction-fields">
          {formBlock.fields.map((field) => (
            <label className="agent-interaction-field" key={field.id}>
              {field.type === 'boolean' ? (
                <span className="agent-interaction-boolean">
                  <input
                    checked={formDraft[field.id] === true}
                    disabled={!editable}
                    onChange={event => setFormDraft(current => ({
                      ...current,
                      [field.id]: event.target.checked,
                    }))}
                    type="checkbox"
                  />
                  <span>{field.label}</span>
                </span>
              ) : (
                <>
                  <span className="agent-interaction-field-label">{field.label}</span>
                  {field.type === 'select' ? (
                    <select
                      disabled={!editable}
                      onChange={event => setFormDraft(current => ({
                        ...current,
                        [field.id]: event.target.value,
                      }))}
                      value={String(formDraft[field.id] || '')}
                    >
                      <option value="">{field.placeholder || '请选择'}</option>
                      {field.values?.map(option => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      disabled={!editable}
                      inputMode={field.type === 'number' ? 'decimal' : undefined}
                      onChange={event => setFormDraft(current => ({
                        ...current,
                        [field.id]: event.target.value,
                      }))}
                      placeholder={field.placeholder}
                      type="text"
                      value={String(formDraft[field.id] ?? '')}
                    />
                  )}
                </>
              )}
            </label>
          ))}
        </div>
      ) : null}
      <div className="agent-interaction-footer">
        <span className="agent-interaction-state">{INTERACTION_STATE_LABELS[block.status]}</span>
        {block.status === 'pending' ? (
          <button
            className="agent-interaction-submit"
            disabled={!editable || !ready || !onAction}
            onClick={submit}
            type="button"
          >
            {busy ? '提交中' : block.submitLabel || '提交'}
          </button>
        ) : null}
      </div>
    </Interaction>
  );
}
