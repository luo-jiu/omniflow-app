import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-ui-pressure-'));
let total = 0;
for (let index = 1; index <= 40; index += 1) {
  const amount = 100 + index;
  total += amount;
  const lines = [`record=${index} amount=${amount} reference=UI-CHECK-${index}-619`];
  for (let row = 2; row <= 400; row += 1) {
    lines.push(`record ${index} archived observation ${row}: ordinary historical inventory notation; unrelated to the amount in the first line.`);
  }
  await writeFile(path.join(directory, `${String(index).padStart(2, '0')}.txt`), lines.join('\n'), { mode: 0o600 });
}
console.log(JSON.stringify({ directory, count: 40, total, firstReference: 'UI-CHECK-1-619', lastReference: 'UI-CHECK-40-619' }));
