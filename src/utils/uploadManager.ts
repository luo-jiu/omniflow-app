import { uploadAndCreateNode } from "@/features/file-explorer/services/file.api";

export interface UploadTask {
  file: File;
  parentId: number;
  libraryId: number;
}

export interface UploadResult {
  status: 'fulfilled' | 'rejected';
  value?: any;
  reason?: any;
  fileName: string;
}

/**
 * 文件上传管理工具
 * 负责并发控制、任务执行，并为以后扩展进度追踪、历史记录预留接口
 */
class UploadManager {
  /**
   * 并发上传多个文件
   * @param tasks 上传任务列表
   * @param onSingleSuccess 单个文件上传成功的回调（用于实时更新UI树）
   */
  async uploadFiles(
    tasks: UploadTask[],
    onSingleSuccess?: (newNode: any) => void
  ): Promise<UploadResult[]> {
    const promises = tasks.map(async (task): Promise<UploadResult> => {
      try {
        const newNode = await uploadAndCreateNode(task.file, task.parentId, task.libraryId);
        if (onSingleSuccess) {
          onSingleSuccess(newNode);
        }
        return { status: 'fulfilled', value: newNode, fileName: task.file.name };
      } catch (error) {
        console.error(`File upload failed: ${task.file.name}`, error);
        return { status: 'rejected', reason: error, fileName: task.file.name };
      }
    });

    // 并发执行所有上传任务
    return await Promise.all(promises);
  }

  /**
   * 计算文件大小显示文本
   */
  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

export const uploadManager = new UploadManager();

