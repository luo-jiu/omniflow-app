export type FileNameValidationResult =
  | { valid: true }
  | { valid: false; message: string };

export function validateWindowsLikeFileName(input: string): FileNameValidationResult {
  const value = input.trim();
  if (!value) {
    return { valid: false, message: '名称不能为空' };
  }

  return { valid: true };
}
