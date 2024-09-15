const enabledPrefixes = [
  // 'engine', 'socket',
  'sio-worker',
  'sio-serverless',
  'sio-serverless:SocketActor'
]

function enablePrefix(name) {
  return enabledPrefixes.some(prefix => name.startsWith(prefix));
}

function doLog(name, ...args) {
  console.debug(new Date(), 'DEBUG', name, ...args);
}

function noop() {}

function createDebug(name) {
  return enablePrefix(name) ? doLog.bind(null, name) : noop;
}

module.exports = createDebug

module.exports.debug = createDebug

