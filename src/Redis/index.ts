import { createClient } from "redis";
import { events } from '..'
import crypto from 'crypto';
import base64url from "base64url";

const pubChannel ='platformEvents';

export const initRedis = async (clientConfig:string|boolean) => {
    const serverIdentity = randomIdentity(16);
    const client = createClient(typeof clientConfig == 'string' ? {url:clientConfig} : undefined);
    client.on('error', err => console.log('Redis Client Error', err));
    const subscriber = client.duplicate();
    subscriber.on('error', err => console.error(err));
    await client.connect();
    await subscriber.connect();
    await subscriber.subscribe(pubChannel, (messageString)=>{
        const message = JSON.parse(messageString);
        if(message.serverIdentity!=serverIdentity){           
            if(Array.isArray(message.values)){
                message.values.push({__self:serverIdentity});
                events.emit(message.event, ...message.values);
            }
        }
    });
    events.onAny(async (event, ...values)=>{
        let __self = values.find(item=>item?.__self == serverIdentity) ? true : false;
        if(!__self){
            try{
                const message = JSON.stringify({event, values, serverIdentity});
                client.publish(pubChannel, message).then(()=>{
                    //console.log('message pusblished', event, message);
                }).catch(error=>{
                    console.log('error publishing message', error);
                });
            }catch(error){
                console.log('error publishing message', error);
            }
        }else{
            //console.log('event received discarded');
        }
    })
    return client;
}
const randomIdentity = (len:number) => {
    len = len || 32;

    let buff = crypto.randomBytes(len);

    return base64url(buff);
}
