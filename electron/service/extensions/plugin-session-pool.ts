import { session, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
const poolId = randomUUID();
const slots: Array<{ session: Session; partition: string; busy: boolean; ready: Promise<void> }> = [];
/** Electron Session 没有 destroy API；固定四个槽位，清理完成后才能复用。 */
export async function acquirePluginSession() {
  let slot = slots.find(item => !item.busy);
  if (!slot) {
    if (slots.length >= 4) throw new Error('Plugin session limit reached');
    const partition = `omniflow-plugin-pool-${poolId}-${slots.length}`;
    slot = { session: session.fromPartition(partition, { cache: false }), partition, busy: false, ready: Promise.resolve() };
    slots.push(slot);
  }
  slot.busy = true;
  try { await slot.ready; } catch { throw new Error('Plugin session cleanup failed'); }
  const owned = slot; let released = false;
  return { session: owned.session, partition: owned.partition, release() {
    if (released) return; released = true;
    owned.ready = Promise.all([owned.session.clearStorageData(), owned.session.clearCache()]).then(() => undefined);
    // 阻止未处理拒绝；失败槽位保留拒绝状态，后续租用保持不可用。
    void owned.ready.catch(() => undefined); owned.busy = false;
  } };
}
