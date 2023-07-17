import Session from "../..";
import { GenericObject, SessionValue } from "../../../Types";

export interface ISessionAdapterStatic {
    get(sessionId:string): Promise<Session>,
}
export abstract class ISessionAdapter {
    constructor(protected session:Session){
    }
    toJSON (_key:string){
        return (`{"id":"${this.session.id}"}`);
    }
    abstract getValue (key:string):Promise<SessionValue>;
    abstract setValue (key:string, value:SessionValue):Promise<void>;
    abstract delValue (key:string):Promise<void>;
    abstract toGenericObject() : Promise<GenericObject>;
}
export class EmptyAdapter extends ISessionAdapter{
    private _session:GenericObject;
    constructor(session:Session){
        super(session);
        this._session = {id:""};
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
/*
Implement XXX adapter:

import Session from "../..";
import { GenericObject, SessionValue } from "../../../../types";
import { ISessionAdapterStatic, ISessionAdapter } from "../SessionAdapter";

export const StaticXXXAdapter:ISessionAdapterStatic = {
    async get(sessionId:string): Promise<Session> {
        throw `not implemented for ${sessionId}`;
    }
}
export class XXXAdapter extends ISessionAdapter{
    constructor(session:Session){
        super(session);
        ...
    }

    override getValue (key:string):Promise<SessionValue>{
        return new Promise(resolve=>{
            ...
        })
    }
    override setValue (key:string, value:SessionValue):Promise<void>{
        return new Promise(resolve=>{
            ...
            resolve()
        })
    }
    override delValue (key:string):Promise<void> {
        return new Promise(resolve=>{
            ...
            resolve();
        })
    }
    override toGenericObject () : Promise<GenericObject> {
        return new Promise(resolve=>{
            ...
        })
    }
}

*/