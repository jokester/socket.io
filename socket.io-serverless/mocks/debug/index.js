const enabledPrefix = name =>
  ['engine',
    'socket', 'sio-worker'].some(prefix => name.startsWith(prefix));

module.exports =
  name =>
  (...args) => {
    if (true ||enabledPrefix(name)) {
      console.debug(new Date(), 'DEBUG', name, ...args);
    }
  };
