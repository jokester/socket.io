// this import name must be handled by wrangler . set it to esbuild externals.
import { DurableObject } from "cloudflare:workers";

export class EngineActor extends DurableObject {
}

export class SocketActor extends DurableObject {

}
export default {
    fetch() {
        throw new Error("todo")
    }
}
