/**
 * 串行化异步任务队列：后进任务排队执行，保证不会并行跑。
 * 任一任务失败不会打断后续任务；调用方可 await 返回的 Promise 感知该次任务成败。
 */
export function createAsyncSerialQueue(): {
  enqueue: (task: () => Promise<void>) => Promise<void>;
} {
  let chain: Promise<void> = Promise.resolve();

  return {
    enqueue(task: () => Promise<void>): Promise<void> {
      const run = chain.then(task, task);
      // 保持链不断裂：失败也吞掉，让后续 enqueue 仍能排队
      chain = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
  };
}
