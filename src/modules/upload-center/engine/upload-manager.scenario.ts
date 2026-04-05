import { UploadManager, UploadManagerEvent, UploadTaskExecutorPayload, UploadTaskInput } from './upload-manager';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(`[upload-manager-scenario] ${message}`);
  }
}

function createFakeFile(name: string, size: number, type: string): File {
  return {
    name,
    size,
    type,
  } as unknown as File;
}

/**
 * Step 2 验收场景：
 * 1) 支持并发（maxConcurrent=2）
 * 2) 支持事件推送（包含 PROGRESS）
 * 3) 批量完成结果可回收
 */
export async function runUploadManagerScenario() {
  const manager = new UploadManager();
  manager.setMaxConcurrent(2);

  let activeCount = 0;
  let maxParallel = 0;
  let progressEventCount = 0;
  let taskEventCount = 0;

  manager.setExecutor(async (payload: UploadTaskExecutorPayload) => {
    activeCount += 1;
    maxParallel = Math.max(maxParallel, activeCount);

    const total = payload.input.file.size;
    const step = Math.max(1, Math.floor(total / 3));

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    payload.onProgress(step, 128000);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    payload.onProgress(step * 2, 128000);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    payload.onProgress(total, 128000);

    activeCount -= 1;
    return { nodeId: payload.taskId };
  });

  const events: UploadManagerEvent[] = [];
  const unsubscribe = manager.subscribe((event) => {
    events.push(event);
    if (event.type === 'task') {
      taskEventCount += 1;
      if (event.reason === 'PROGRESS') {
        progressEventCount += 1;
      }
    }
  });

  const inputs: UploadTaskInput[] = [
    {
      file: createFakeFile('a.png', 3000, 'image/png'),
      parentId: 1,
      libraryId: 1,
    },
    {
      file: createFakeFile('b.mp3', 4500, 'audio/mpeg'),
      parentId: 1,
      libraryId: 1,
    },
    {
      file: createFakeFile('c.mp4', 6000, 'video/mp4'),
      parentId: 1,
      libraryId: 1,
    },
  ];

  const batch = manager.createBatch(inputs);
  const results = await batch.done;
  unsubscribe();

  assert(maxParallel === 2, `max parallel expected 2, got ${maxParallel}`);
  assert(results.length === 3, `result length expected 3, got ${results.length}`);
  assert(results.every((item) => item.status === 'fulfilled'), 'all tasks should be fulfilled');
  assert(taskEventCount > 0, 'task event count should > 0');
  assert(progressEventCount >= 3, `progress event count should >= 3, got ${progressEventCount}`);

  return {
    maxParallel,
    resultCount: results.length,
    progressEventCount,
  };
}

