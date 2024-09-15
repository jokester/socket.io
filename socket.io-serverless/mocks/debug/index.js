const enabledPrefixes = [
  // 'engine', 'socket',
  'sio-worker',
  'sio-serverless',
  'sio-serverless:SocketActor'
]

function enablePrefix(name) {
  return enabledPrefixes.some(prefix => name.startsWith(prefix));
}

module.exports = name => enablePrefix(name) ? doLog.bind(null, name) : noop;

function doLog(name, ...args) {
  console.debug(new Date(), 'DEBUG', name, ...args);
}

function noop() {}
