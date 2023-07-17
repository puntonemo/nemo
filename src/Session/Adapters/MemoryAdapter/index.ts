import Session from "../..";
import { GenericObject, SessionValue } from "../../../Types";
import { ISessionAdapterStatic, ISessionAdapter } from "../SessionAdapter";

var sessions:Map<string, GenericObject> = new Map();

export const StaticMemoryAdapter:ISessionAdapterStatic = {
    async get(sessionId:string): Promise<Session> {
        let session = sessions.get(sessionId);
        if(!session){
            const defaultValue = {
                id:sessionId,
                creationTimeStamp:Date.now(),
            }
            const newSession = new Session(sessionId);
            sessions.set(sessionId, defaultValue);
            return newSession;
        }else{
            return new Session(sessionId);
        }
    }
}
export class MemoryAdapter extends ISessionAdapter{
    private _session:GenericObject;
    constructor(session:Session){
        super(session);
        this._session = sessions.get(session.id) ?? {id:session.id};
    }

    override getValue (key:string):Promise<SessionValue>{
        return new Promise(resolve=>{
            resolve(this._session[key]);
        })
    }
    override setValue (key:string, value:SessionValue):Promise<void>{
        return new Promise(resolve=>{
            this._session[key] = value;
            resolve()
        })
    }
    override delValue (key:string):Promise<void> {
        return new Promise(resolve=>{
            delete this._session[key];
            resolve();
        })
    }
    override toGenericObject () : Promise<GenericObject> {
        return new Promise(resolve=>{
            resolve(this._session);
        })
    }
}