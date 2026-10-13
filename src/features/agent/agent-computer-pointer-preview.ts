import { AGENT_ATTACHMENT_MAX_BYTES } from '@/shared/agent/agent-attachments';
import type { AgentComputerPointerPlan } from './agent-computer-pointer-plan';
import { agentComputerPointerPlanLabel } from './agent-computer-pointer-plan';
import { POINTER_PATH, POINTER_PURPLE, pointerPlanGeometry } from './agent-computer-pointer-geometry';

const MAX_SOURCE_LENGTH = Math.ceil(AGENT_ATTACHMENT_MAX_BYTES / 3) * 4 + 64;
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u;

/** Temporary renderer pixels only. Neither the original attachment nor model input changes. */
export function createAgentComputerPointerPreview(source: string, plan: AgentComputerPointerPlan, signal: AbortSignal): Promise<string> {
  const inside = (point: { x: number; y: number }) => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y)
    && point.x >= 0 && point.x < plan.width && point.y >= 0 && point.y < plan.height;
  if (signal.aborted || source.length > MAX_SOURCE_LENGTH || !PNG.test(source)
    || !Number.isSafeInteger(plan.width) || !Number.isSafeInteger(plan.height)
    || plan.width < 1 || plan.height < 1 || plan.width > 2048 || plan.height > 2048
    || !['click', 'rightClick', 'doubleClick', 'drag'].includes(plan.operation)
    || !inside(plan.point) || plan.operation === 'drag' && (!plan.endPoint || !inside(plan.endPoint))
    || plan.operation !== 'drag' && plan.endPoint !== undefined) return Promise.reject(new Error('Pointer preview unavailable'));
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      image.onload = null; image.onerror = null;
      image.src = '';
      if (value) resolve(value); else reject(new Error('Pointer preview unavailable'));
    };
    const abort = () => finish();
    const timeout = setTimeout(abort, 3000);
    signal.addEventListener('abort', abort, { once: true });
    image.onerror = abort;
    image.onload = () => {
      if (settled) return;
      if (signal.aborted || image.naturalWidth !== plan.width || image.naturalHeight !== plan.height) { finish(); return; }
      let canvas: HTMLCanvasElement | undefined;
      try {
        canvas = document.createElement('canvas');
        canvas.width = plan.width; canvas.height = plan.height;
        const context = canvas.getContext('2d');
        if (!context) { finish(); return; }
        context.drawImage(image, 0, 0);
        const { scale, x, y, labelWidth, labelHeight } = pointerPlanGeometry(plan);
        if (plan.endPoint) {
          context.setLineDash([7 * scale, 5 * scale]);
          context.beginPath(); context.moveTo(plan.point.x, plan.point.y); context.lineTo(plan.endPoint.x, plan.endPoint.y);
          context.strokeStyle = 'white'; context.lineWidth = 5 * scale; context.stroke();
          context.strokeStyle = POINTER_PURPLE; context.lineWidth = 2.5 * scale; context.stroke();
          context.setLineDash([]);
          context.beginPath(); context.arc(plan.endPoint.x, plan.endPoint.y, 7 * scale, 0, Math.PI * 2);
          context.fillStyle = POINTER_PURPLE; context.fill(); context.strokeStyle = 'white'; context.lineWidth = 2 * scale; context.stroke();
        }
        context.save(); context.translate(plan.point.x, plan.point.y); context.scale(scale, scale);
        const arrow = new Path2D(POINTER_PATH);
        context.fillStyle = POINTER_PURPLE; context.strokeStyle = 'white'; context.lineWidth = 1.8; context.lineJoin = 'round';
        context.fill(arrow); context.stroke(arrow); context.restore();
        context.beginPath(); context.roundRect(x, y, labelWidth, labelHeight, 5 * scale);
        context.fillStyle = POINTER_PURPLE; context.fill(); context.strokeStyle = 'white'; context.lineWidth = scale; context.stroke();
        context.fillStyle = 'white'; context.font = `600 ${12 * scale}px system-ui, sans-serif`;
        context.fillText(agentComputerPointerPlanLabel(plan), x + 7 * scale, y + 15 * scale, labelWidth - 14 * scale);
        const result = canvas.toDataURL('image/png');
        finish(result.length <= MAX_SOURCE_LENGTH && PNG.test(result) ? result : undefined);
      } catch { finish(); }
      finally { if (canvas) { canvas.width = 0; canvas.height = 0; } }
    };
    image.src = source;
  });
}
