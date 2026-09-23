import type { PluginToolSchema } from '../../../packages/plugin-sdk/index.js';
import { initialCommandValue } from './command-form';

interface Props { schema: PluginToolSchema; value: unknown; onChange: (value: unknown) => void; disabled?: boolean; label?: string; }

export function CommandParameterForm({ schema, value, onChange, disabled = false, label = '参数' }: Props) {
  if (schema.type === 'object') {
    const record = (value ?? {}) as Record<string, unknown>;
    return <div className="parameter-fields">{Object.entries(schema.properties ?? {}).map(([key, child]) => {
      const required = schema.required?.includes(key);
      const enabled = Object.prototype.hasOwnProperty.call(record, key);
      const fieldLabel = `${label}.${key}`;
      return <div className="parameter-field" key={key}>
        <label className="parameter-label">
          {!required && <input type="checkbox" aria-label={`启用 ${fieldLabel}`} checked={enabled} disabled={disabled}
            onChange={event => {
              const next = { ...record };
              if (event.target.checked) next[key] = initialCommandValue(child); else delete next[key];
              onChange(next);
            }} />}
          {key}{required ? ' *' : '（可选）'}
        </label>
        {child.description && <div className="muted">{child.description}</div>}
        {enabled && <CommandParameterForm schema={child} value={record[key]} label={fieldLabel} disabled={disabled}
          onChange={next => onChange({ ...record, [key]: next })} />}
      </div>;
    })}</div>;
  }
  if (schema.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    return <div className="parameter-fields">
      {items.map((item, index) => <div className="array-item" key={index}>
        <CommandParameterForm schema={schema.items!} value={item} label={`${label}[${index + 1}]`} disabled={disabled}
          onChange={next => onChange(items.map((entry, i) => i === index ? next : entry))} />
        <button type="button" disabled={disabled || items.length <= (schema.minItems ?? 0)} aria-label={`移除 ${label}[${index + 1}]`}
          onClick={() => onChange(items.filter((_, i) => i !== index))}>移除</button>
      </div>)}
      <button type="button" disabled={disabled || items.length >= (schema.maxItems ?? 256)}
        onClick={() => onChange([...items, initialCommandValue(schema.items!)])}>添加一项</button>
      <div className="muted">最多 {schema.maxItems} 项</div>
    </div>;
  }
  if (schema.enum) return <select aria-label={label} disabled={disabled} value={schema.enum.findIndex(item => item === value)}
    onChange={event => onChange(schema.enum![Number(event.target.value)])}>
    {schema.enum.map((item, index) => <option key={index} value={index}>{String(item)}</option>)}
  </select>;
  if (schema.type === 'boolean') return <select aria-label={label} disabled={disabled} value={value === true ? 'true' : 'false'}
    onChange={event => onChange(event.target.value === 'true')}><option value="false">否</option><option value="true">是</option></select>;
  if (schema.type === 'null') return <span className="muted">空值</span>;
  return <input aria-label={label} disabled={disabled} value={String(value ?? '')}
    type={schema.type === 'string' ? 'text' : 'number'}
    min={schema.minimum} max={schema.maximum} step={schema.type === 'integer' ? 1 : 'any'}
    onChange={event => onChange(event.target.value)} />;
}
