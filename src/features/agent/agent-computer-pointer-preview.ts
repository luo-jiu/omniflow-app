import { AGENT_ATTACHMENT_MAX_BYTES } from '@/shared/agent/agent-attachments';
import type { AgentComputerPointerPlan } from './agent-computer-pointer-plan';
import { agentComputerPointerPlanLabel } from './agent-computer-pointer-plan';
import { COMPUTER_POINTER_PATH, computerPointerPalette } from '@/shared/computer-use/pointer-appearance';
import { pointerPlanGeometry } from './agent-computer-pointer-geometry';

const MAX_SOURCE_LENGTH = Math.ceil(AGENT_ATTACHMENT_MAX_BYTES / 3) * 4 + 64;
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u;

/** Display-only SVG: original PNG plus a vector pointer, never persisted or sent to the model. */
export function createAgentComputerPointerPreview(source: string, plan: AgentComputerPointerPlan, signal: AbortSignal, accentColor?: string): Promise<string> {
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
      try {
        const { scale, xDirection, yDirection } = pointerPlanGeometry(plan);
        const palette = computerPointerPalette(accentColor);
        // Every interpolated value is a validated number, finite palette value, static label/path,
        // or bounded PNG base64. Never accept arbitrary SVG, URLs, markup or uploaded SVG content.
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${plan.width}" height="${plan.height}" viewBox="0 0 ${plan.width} ${plan.height}">
<title>${agentComputerPointerPlanLabel(plan)}</title>
<image width="${plan.width}" height="${plan.height}" href="${source}"/>
<defs><filter id="glow" filterUnits="userSpaceOnUse" x="-7" y="-7" width="35" height="35" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="2"/></filter></defs>
<g transform="translate(${plan.point.x} ${plan.point.y}) scale(${scale * xDirection} ${scale * yDirection})" stroke-linejoin="round">
<path d="${COMPUTER_POINTER_PATH}" fill="none" stroke="${palette.accent}" stroke-width="2" stroke-opacity="0.5" filter="url(#glow)"/>
<path d="${COMPUTER_POINTER_PATH}" fill="${palette.fill}" stroke="${palette.accent}" stroke-width="2.6"/>
<path d="${COMPUTER_POINTER_PATH}" fill="none" stroke="${palette.edge}" stroke-width="1.3"/>
</g></svg>`;
        // Semi changes image width/height for zoom, so the path is rasterized at the displayed size.
        finish(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      } catch { finish(); }
    };
    image.src = source;
  });
}
