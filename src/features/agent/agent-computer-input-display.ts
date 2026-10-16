import type { WindowMenuOperation } from '@/shared/computer-use/window-menu-contract';
import type { WindowInputOperation, WindowInputShortcut } from '@/shared/computer-use/window-input-contract';

export const COMPUTER_INPUT_LABELS: Record<WindowInputOperation, string> = {
  shortcut: '快捷键', rightClick: '右键', doubleClick: '双击', drag: '拖拽', click: '单击', typeText: '文字输入', scroll: '滚轮',
};

export const COMPUTER_MENU_LABELS: Record<WindowMenuOperation, string> = {
  open: '展开菜单', press: '选择菜单项', cancel: '关闭菜单',
};

const KEY_LABELS: Record<string, string> = {
  space: '空格', return: 'Return', escape: 'Escape', tab: 'Tab', backspace: '退格', delete: 'Delete',
  arrowUp: '↑', arrowDown: '↓', arrowLeft: '←', arrowRight: '→', pageUp: 'Page Up', pageDown: 'Page Down', home: 'Home', end: 'End',
};
const MODIFIER_LABELS = { command: 'Command', shift: 'Shift', option: 'Option', control: 'Control' };

export function formatComputerInputShortcut(shortcut: WindowInputShortcut): string {
  return [...shortcut.modifiers.map(modifier => MODIFIER_LABELS[modifier]),
    KEY_LABELS[shortcut.key] || shortcut.key.toUpperCase()].join(' + ');
}
