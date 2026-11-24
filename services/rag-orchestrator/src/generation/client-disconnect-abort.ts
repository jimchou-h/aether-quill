type CloseEmitter = {
  on: (event: 'close', listener: () => void) => unknown;
  off: (event: 'close', listener: () => void) => unknown;
};

type CloseResponse = CloseEmitter & { readonly writableEnded: boolean };

/**
 * 客户端提前断开时取消上游生成；正常 res.end() 之后触发的 close 不算断开。
 * destroyed 在提前断开与正常结束路径上都可能为 true，只以 writableEnded 判定。
 */
export function bindClientDisconnectAbort(
  req: CloseEmitter,
  res: CloseResponse,
  controller: AbortController
): { abortIfPrematureClose: () => void; dispose: () => void } {
  const abortIfPrematureClose = () => {
    if (res.writableEnded || controller.signal.aborted) {
      return;
    }
    controller.abort();
  };

  req.on('close', abortIfPrematureClose);
  res.on('close', abortIfPrematureClose);

  return {
    abortIfPrematureClose,
    dispose: () => {
      req.off('close', abortIfPrematureClose);
      res.off('close', abortIfPrematureClose);
    },
  };
}
