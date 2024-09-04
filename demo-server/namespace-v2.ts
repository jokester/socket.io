import debug from 'debug';
import type sio from 'socket.io';
import {
  ClientCommands,
  ClientMessage,
  LimbV2MessageBase,
} from './types/namespace-v2';

const logger = debug('limb:server:v2');

export function onV2Connection(
  namespace: sio.Namespace,
  socket: sio.Socket
): void {
  logger('connection', socket.id);

  socket.on('disconnecting', (reason: unknown) => {
    logger('disconnecting', socket.id, reason);
  });

  socket.on('disconnect', (reason: unknown) => {
    logger('disconnect', socket.id, reason);
  });

  socket.on('error', (error: unknown) => {
    logger('error', socket.id, error);
    onInternalError(socket, error);
  });

  socket.on('message', (event: string, payload: any) => {
    try {
      handleUserMessage(namespace, socket, event, payload);
    } catch (e) {
      onInternalError(socket, e);
    }
  });

  socket.send('sys:welcome', {socketId: socket.id});
}

function handleUserMessage(
  namespace: sio.Namespace,
  socket: sio.Socket,
  event: string,
  _payload: LimbV2MessageBase
) {
  logger('user message', socket.id, event, _payload.nonce);

  switch (event) {
    case 'sys:ping': {
      const now = new Date().toISOString();
      socket.send('sys:pong', {timestamp: now});
      break;
    }
    case 'room:join': {
      const payload = _payload as ClientCommands[typeof event];
      socket.join(`room:${payload.room}`);
      break;
    }
    case 'room:leave': {
      const payload = _payload as ClientCommands[typeof event];
      socket.leave(`room:${payload.room}`);
      break;
    }
    default:
      forwardMessage(namespace, socket, event, _payload);
  }
}

function forwardMessage(
  namespace: sio.Namespace,
  socket: sio.Socket,
  event: string,
  clientMessage: ClientMessage
): void {
  const {to, viaRoom: _removed, ...rest} = clientMessage;

  to?.forEach(recipient => {
    if (recipient.startsWith('room:')) {
      const roomId = recipient.slice('room:'.length);
      socket.in(recipient).emit(event, {
        ...rest,
        from: socket.id,
        viaRoom: roomId,
      });
    } else if (recipient.startsWith('socket:')) {
      const socketId = recipient.slice('socket:'.length);
      namespace.sockets.get(socketId)?.emit(event, {
        ...rest,
        from: socket.id,
      });
    } else {
      logger('unexpected to format. not forwarding', socket.id, recipient);
    }
  });
}

function onInternalError(socket: sio.Socket, error: unknown): void {
  logger('error handling ', socket.id, error);
  socket.disconnect(true);
}
