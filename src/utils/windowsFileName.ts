const WINDOWS_INVALID_CHAR_PATTERN = /[<>:"/\\|?*]/;
const WINDOWS_RESERVED_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export type FileNameValidationResult =
  | { valid: true }
  | { valid: false; message: string };

function containsControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) < 32) {
      return true;
    }
  }
  return false;
}

export function validateWindowsLikeFileName(input: string): FileNameValidationResult {
  const value = input.trim();
  if (!value) {
    return { valid: false, message: '名称不能为空' };
  }

  if (value === '.' || value === '..') {
    return { valid: false, message: '名称不能为 . 或 ..' };
  }

  if (WINDOWS_INVALID_CHAR_PATTERN.test(value)) {
    return { valid: false, message: '名称包含非法字符：< > : " / \\ | ? *' };
  }

  if (containsControlChar(value)) {
    return { valid: false, message: '名称包含非法控制字符' };
  }

  if (/[. ]$/.test(value)) {
    return { valid: false, message: '名称不能以空格或点结尾' };
  }

  const deviceNameCandidate = value.split('.')[0];
  if (WINDOWS_RESERVED_NAME_PATTERN.test(deviceNameCandidate)) {
    return {
      valid: false,
      message: '名称不能使用系统保留名（CON/PRN/AUX/NUL/COM1..9/LPT1..9）',
    };
  }

  return { valid: true };
}
