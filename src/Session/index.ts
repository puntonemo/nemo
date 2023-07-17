import { GenericObject, SessionValue } from "../Types";
import { ISessionAdapterStatic, ISessionAdapter, EmptyAdapter } from "./Adapters/SessionAdapter";
import { MemoryAdapter, StaticMemoryAdapter } from "./Adapters/MemoryAdapter";
import { RedisAdapter, StaticRedisAdapter } from "./Adapters/RedisAdapter";

type AdapterType = "memory" | "redis";

export default class Session {
    private static _adapterType = "";
    private static _staticAdapter:ISessionAdapterStatic;
    private _adapter:ISessionAdapter;
    constructor (public id:string){
        if(id.trim()!=""){
            if(Session._adapterType == "memory"){
                this._adapter = new MemoryAdapter(this);
            }else{
                this._adapter = new RedisAdapter(this);
            }
        }else{
            this._adapter = new EmptyAdapter(this);
        }
    }
    getValue (key:string){
        return this._adapter.getValue(key);
    }
    setValue (key:string, value:SessionValue|SessionValue|[]){       
        //const stringValue = JSON.stringify(value);
        return this._adapter.setValue(key, value);
    }
    delValue (key:string){
        return this._adapter.delValue(key);
    }
    toGenericObject(){
        return this._adapter.toGenericObject();
    }
    
    static setAdapterType(adapterType:AdapterType){
        Session._adapterType = adapterType;
        switch(adapterType){
            case "memory":
                Session._staticAdapter = StaticMemoryAdapter;
                break;
            case "redis":
                Session._staticAdapter = StaticRedisAdapter;
                break;
        }
    }
    static get(sessionId:string){
        return Session._staticAdapter.get(sessionId)
    }
}