// 上传中心通用展示工具：速率与剩余时间格式化。
// 数据源是 UploadTaskProgress.speedBps / etaSeconds（已经在 state-machine 里平滑过）。
// 这里只做展示层格式化，不引入新的状态。

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/**
 * formatRate 把 bytes/s 渲染成人类可读速率。
 * 0 或负数返回空串，调用方负责"非上传中状态不渲染"。
 */
export function formatRate(speedBps: number): string {
  if (!Number.isFinite(speedBps) || speedBps <= 0) return '';
  if (speedBps >= GB) return `${(speedBps / GB).toFixed(2)} GiB/s`;
  if (speedBps >= MB) return `${(speedBps / MB).toFixed(1)} MiB/s`;
  if (speedBps >= KB) return `${(speedBps / KB).toFixed(0)} KiB/s`;
  return `${Math.round(speedBps)} B/s`;
}

/**
 * formatETA 把剩余秒数渲染成 "1h2m" / "5m30s" / "12s"。
 * null / 非正数返回空串。> 24h 直接显示 ">24h" 防止异常长 ETA 占位。
 */
export function formatETA(etaSeconds: number | null | undefined): string {
  if (etaSeconds == null) return '';
  if (!Number.isFinite(etaSeconds) || etaSeconds <= 0) return '';
  const seconds = Math.ceil(etaSeconds);
  if (seconds >= 86400) return '>24h';
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m${s}s` : `${m}m`;
  }
  return `${seconds}s`;
}
