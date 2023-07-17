import Session from "../..";
import { GenericObject, SessionValue } from "../../../Types";
import { ISessionAdapterStatic, ISessionAdapter } from "../SessionAdapter";
import { redisClient } from "../../..";
import { error } from "console";

export const _id = 'id';

export const StaticRedisAdapter:ISessionAdapterStatic = {
    async get(sessionId:string): Promise<Session> {
        if(redisClient){ 
            const redisSessionId = `session:${sessionId}`;
            const hlen = await redisClient.hLen(redisSessionId);
            if(hlen==0){
                const newSession = new Session(sessionId);
                await newSession.setValue(_id, sessionId);
                return newSession;
            }else{
                return new Session(sessionId);
            }
        }else{
            throw "Redis not enabled";
        }
    }
}
export class RedisAdapter extends ISessionAdapter{
    private _redisSessionId;
    constructor(session:Session){
        if(redisClient){
            super(session);
            this._redisSessionId = `session:${session.id}`;
        }else{
            throw "Redis not enabled";
        }

    }

    override async getValue (key:string):Promise<SessionValue>{
        if(redisClient){
            const value = await redisClient.hGet(this._redisSessionId, key);
            if(value) 
                return JSON.parse(value) 
            else
                return undefined;
        }else{
            throw "Redis not enabled";
        }
        
        
    }
    override async setValue (key:string, value:SessionValue):Promise<void>{
        if(redisClient){
            if(value)
                await redisClient.hSet(this._redisSessionId, key, JSON.stringify(value));
            else
                await redisClient.hDel(this._redisSessionId, key);
        }else{
            throw "Redis not enabled";
        }
        
    }
    override async delValue (key:string):Promise<void> {
        if(redisClient){
            await redisClient.hDel(this._redisSessionId, key);
        }else{
            throw "Redis not enabled";
        }
    }
    override async toGenericObject () : Promise<GenericObject> {
        if(redisClient){
            try{

                const values = await redisClient.hGetAll(this._redisSessionId);
                const result:GenericObject = {};
                for(const key of Object.keys(values)){
                    result[key] = JSON.parse(values[key]);
                }
                return result;
            }catch(error){
                console.log(error);
                throw error;
            }
        }else{
            throw "Redis not enabled";
        }
    }
}