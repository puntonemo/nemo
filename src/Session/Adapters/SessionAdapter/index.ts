import Session from "../..";
import { GenericObject, SessionValue } from "../../../Types";

export interface ISessionAdapter {
    get(sessionId:string): Promise<Session>,
    getAdapter(session:Session): ISessionInstanceAdapter
}
export abstract class ISessionInstanceAdapter {
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
export class EmptyAdapter extends ISessionInstanceAdapter{
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
How to implement an XXX adapter with DB Connection:

import { Session, ISessionAdapterStatic, ISessionAdapter, GenericObject, SessionValue } from "../../..";

interface ISessionAdapterConnection {
    setAdapter (mongoClient:MongoClient, dbName:string,  collectionName:string):void;
}

export const StaticXXXAdapter:ISessionAdapterStatic & ISessionAdapterConnection  = {
    async get(sessionId:string): Promise<Session> {
        throw `not implemented for ${sessionId}`;
    },
    getAdapter(session:Session) {
        return new XXXAdapter(session);
    },
    async setAdapter(mongoClient, dbName, collectionName) {
        try {
            // do some async operations (DB Conections, ...)
        } catch (error) {
            // Catch error
        }
        Session.setAdapter(this);
    }
}
class XXXAdapter extends ISessionAdapter{
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