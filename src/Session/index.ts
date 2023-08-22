import { SessionValue } from "../Types";
import { ISessionInstanceAdapter, ISessionAdapter, EmptyAdapter } from "./Adapters/SessionAdapter";
import SessionAdapter from "./Adapters/MemoryAdapter";

export default class Session {
    //private static _adapterType = "";
    private static _staticAdapter:ISessionAdapter = SessionAdapter;
    private _adapter:ISessionInstanceAdapter;
    constructor (public id:string){
        if(id && id.trim && id.trim()!=""){
            this._adapter = Session._staticAdapter.getAdapter(this);
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
    static setAdapter(staticAdapter:ISessionAdapter){
        Session._staticAdapter = staticAdapter;
    }
    static get(sessionId:string){
        return Session._staticAdapter.get(sessionId)
    }
}