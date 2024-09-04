const nop = (...args: unknown[]) => {
  // throw new Error(`not implemented`);
};

export {
  nop as patchAdapter,
  nop as restoreAdapter,
  nop as serveFile,
  nop as createDeflate,
  nop as createGzip,
  nop as createBrotliCompress,
  nop as createReadStream,
  nop as pipeline,
}
