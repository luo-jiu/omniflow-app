// Deliberately separate: this suite starts harmless Node process fixtures only.
export default { test: { include: ['tools/computer-use/safe-fixture-launcher.node-test.mjs'], fileParallelism: false } };
