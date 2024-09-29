import type * as CF from '@cloudflare/workers-types';
import debug from 'debug'
import {EngineActorDefaultImpl} from "./eio/EngineActorDefaultImpl";

const debugLogger = debug('sio-serverless:EngineActor');

/**
 * Works in place of a engine.io Server
 * - accepts incoming WebSocket connection
 * - emit eio.Socket
 */
export class EngineActor extends EngineActorDefaultImpl {

    webSocketMessage(ws: CF.WebSocket, message: string | ArrayBuffer){
        const socketState = this.recallSocketStateForConn(ws)
        const socket = socketState && this.recallSocket(socketState)
        debugLogger('EngineActor#webSocketMessage', socketState?.eioSocketId, socket, socket?.constructor)
        debugLogger('EngineActor#webSocketMessage', message)
        socket?.onCfMessage(message as string)
    }

    webSocketClose(ws: CF.WebSocket, code: number, reason: string, wasClean: boolean) {
        const socketState = this.recallSocketStateForConn(ws)
        const socket = socketState && this.recallSocket(socketState)
        debugLogger('EngineActor#webSocketClose',socketState?.eioSocketId, socket?.constructor)
        debugLogger('EngineActor#webSocketClose',code, reason, wasClean)
         socket?.onCfClose(code, reason, wasClean)
    }
    webSocketError(ws: CF.WebSocket, error: unknown) {
        const socketState = this.recallSocketStateForConn(ws)
        const socket = socketState && this.recallSocket(socketState)
        debugLogger('EngineActor#webSocketError', socketState?.eioSocketId, socket?.constructor)
        debugLogger('EngineActor#webSocketError', error)
        socket?.onCfError(String(error))
    }

    /**
     * called by SocketActor which thinks it's writing to eio.Socket
     * FIXME should be named 'onServerMessage'
     */
    async sendMessage(eioSocketId: string, message: string | Buffer): Promise<boolean> {
        const socketState = this.recallSocketStateForId(eioSocketId)
        const socket = socketState && this.recallSocket(socketState)
        if (!socket) {
            return false
        }
        try {
            socket.write(message);
        } catch (e) {
            debugLogger('EngineActor#sendMessage ERROR', e)
            return false
        }
        return true
    }
}

