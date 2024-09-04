import debug from 'debug';
import type * as sio from 'socket.io/lib';

export const parentNamespace = /^\/v1\/[-\w:.]+$/;

const logger = debug('limb:server:v1');

export function onV1Connection(socket: sio.Socket) {
  const namespace = socket.nsp;
  logger('connection', namespace.name, socket.id);

  socket.on('disconnecting', (reason: any) => {
    logger('disconnecting', namespace.name, socket.id, reason);
  });

  socket.on('disconnect', (reason: any) => {
    logger('disconnect', namespace.name, socket.id, reason);
  });

  socket.on('error', (error: any) => {
    logger('error', namespace.name, socket.id, error);
  });

  // only forward "message" events. Clients should use `send(clientEventName, value)`
  socket.on('message', (event: string, value: any) => {
    logger('forwarding message', namespace.name, socket.id, event, value);
    namespace.send(event, value);
  });
}
