export interface TextSaveFeedback {
  level: 'success' | 'warning';
  message: string;
}

export function resolveTextSaveFeedback(options: {
  draftCleanupFailed: boolean;
  editedDuringSave: boolean;
  followUpDraftPersisted: boolean;
}): TextSaveFeedback {
  if (options.editedDuringSave && !options.followUpDraftPersisted) {
    return {
      level: 'warning',
      message: '文件已保存，但后续修改尚未写入草稿，请尽快再次保存',
    };
  }
  if (options.draftCleanupFailed) {
    return {
      level: 'warning',
      message: '文件已保存，但旧草稿清理失败',
    };
  }
  return {
    level: 'success',
    message: options.editedDuringSave ? '已保存，后续修改已保留为草稿' : '已保存',
  };
}
