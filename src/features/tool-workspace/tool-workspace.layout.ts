import {
  TOOL_WORKSPACE_TOOL_IDS,
  type ToolWorkspaceToolId,
} from './types';

export const TOOL_WORKSPACE_PREFERENCE_NAMESPACE = 'tool-workspace';
export const TOOL_WORKSPACE_LAYOUT_SCHEMA_VERSION = 2;
export const MIN_TOOL_NAV_WIDTH = 57;
export const DEFAULT_TOOL_NAV_WIDTH = 208;
export const MAX_TOOL_NAV_WIDTH = 240;
export const TOOL_NAV_REORDER_HANDLE_MIN_WIDTH = 180;
export const TOOL_NAV_COLLAPSE_BUTTON_SIZE = 24;
export const TOOL_NAV_COLLAPSE_BUTTON_EXPANDED_OFFSET = 38;
export const TOOL_NAV_ICON_CENTER = 28;
const LEGACY_MIN_TOOL_NAV_WIDTH = 58;

export interface ToolWorkspaceLayout extends Record<string, unknown> {
  navWidth: number;
  toolOrder: ToolWorkspaceToolId[];
}

export const DEFAULT_TOOL_WORKSPACE_LAYOUT: ToolWorkspaceLayout = {
  navWidth: DEFAULT_TOOL_NAV_WIDTH,
  toolOrder: [...TOOL_WORKSPACE_TOOL_IDS],
};

export function clampToolNavWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_TOOL_NAV_WIDTH;
  return Math.min(MAX_TOOL_NAV_WIDTH, Math.max(MIN_TOOL_NAV_WIDTH, Math.round(width)));
}

export function getToolNavCollapseButtonLeft(width: number, collapsed: boolean): number {
  const clampedWidth = clampToolNavWidth(width);
  return collapsed
    ? TOOL_NAV_ICON_CENTER - (TOOL_NAV_COLLAPSE_BUTTON_SIZE / 2)
    : clampedWidth - TOOL_NAV_COLLAPSE_BUTTON_EXPANDED_OFFSET;
}

function isToolId(value: unknown): value is ToolWorkspaceToolId {
  return typeof value === 'string'
    && (TOOL_WORKSPACE_TOOL_IDS as readonly string[]).includes(value);
}

export function normalizeToolOrder(value: unknown): ToolWorkspaceToolId[] {
  const seen = new Set<ToolWorkspaceToolId>();
  const order: ToolWorkspaceToolId[] = [];
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (isToolId(item) && !seen.has(item)) {
        seen.add(item);
        order.push(item);
      }
    });
  }
  TOOL_WORKSPACE_TOOL_IDS.forEach((toolId) => {
    if (!seen.has(toolId)) order.push(toolId);
  });
  return order;
}

export function normalizeToolWorkspaceLayout(
  value: unknown,
  schemaVersion = TOOL_WORKSPACE_LAYOUT_SCHEMA_VERSION,
): ToolWorkspaceLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ...DEFAULT_TOOL_WORKSPACE_LAYOUT,
      toolOrder: [...DEFAULT_TOOL_WORKSPACE_LAYOUT.toolOrder],
    };
  }
  const raw = value as Record<string, unknown>;
  const rawNavWidth = Number(raw.navWidth);
  return {
    navWidth: schemaVersion < TOOL_WORKSPACE_LAYOUT_SCHEMA_VERSION
      && rawNavWidth === LEGACY_MIN_TOOL_NAV_WIDTH
      ? MIN_TOOL_NAV_WIDTH
      : clampToolNavWidth(rawNavWidth),
    toolOrder: normalizeToolOrder(raw.toolOrder),
  };
}
