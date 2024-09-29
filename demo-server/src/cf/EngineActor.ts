import type * as CF from '@cloudflare/workers-types';
import debug from 'debug'
import {EngineActorDefaultImpl} from "./engine-actor-default-impl";

const debugLogger = debug('sio-serverless:EngineActor');

/**
 * Works in place of a engine.io Server
 * - accepts incoming WebSocket connection
 * - emit eio.Socket
 */
export class EngineActor extends EngineActorDefaultImpl {

    async webSocketMessage(ws: CF.WebSocket, message: string | ArrayBuffer){
        const socketState = this.recallSocketStateForConn(ws)
        const socket = socketState && this.recallSocket(socketState)
        socket?.onCfMessage(message as string)
    }

    async webSocketClose(ws: CF.WebSocket, code: number, reason: string, wasClean: boolean) {
        const socketState = this.recallSocketStateForConn(ws)
        const socket = socketState && this.recallSocket(socketState)
         socket?.onCfClose(code, reason, wasClean)
    }
    async webSocketError(ws: CF.WebSocket, error: unknown) {
        const socketState = this.recallSocketStateForConn(ws)
        const socket = socketState && this.recallSocket(socketState)
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

