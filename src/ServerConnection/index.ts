import { io, Socket } from "socket.io-client";
import * as socketioServer from 'socket.io';
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import { GenericObject, Service, Services, staticServices, addService, RemoteServerConfig, ioServerOverHttp, ioServerOverHttps, coreGatewayConfig, events } from "..";
import ClientRequest from "../ClientRequest";
import { makeid } from "../tools";
import {Express} from 'express-serve-static-core';
import { createProxyMiddleware } from 'http-proxy-middleware';

import axios from "axios";
import { hostname } from "os";

type PromiseDefinition = {
    resolve : Function,
    reject : Function,
    feedback?: Function,
    timeout? : NodeJS.Timeout,
    will:boolean    
}
type StaticPathDefinition = {
    method:string,
    path:string
};
type RemoteServerDefinition = {
    hostName:string, 
    passkey:string, 
    live:boolean,
    replica:boolean
}
export default class ServerConnection{
    public static remoteServers:Map<string,RemoteServerConfig> = new Map(); // FOR A GATEWAY, THOSE ARE ALL THE REMOTE SERVERS AVAILABLE
    public static gatewayServer:socketioServer.Socket[] = []; // FOR A REMOTE SERVER, IT'S THE CONNECTION(S) WITH THE GATEWAY
    private static _dictionaryChangedEventName?:string;
    private _connected:boolean = false;
    private _socket:Socket<DefaultEventsMap, DefaultEventsMap> | undefined;
    //private _api:GenericObject={};
    //private _apiDict:GenericObject={};
    //private _staticPaths:StaticPathDefinition[] = [];
    //private _remoteServers:RemoteServerDefinition [] = [];
    private _promises:Map<string, PromiseDefinition> = new Map<string, PromiseDefinition>();
    private _maxRequestTimeout = 0;
    private _app:Express;
    private _passkey;
    public live = false;
    public replica = false;
    private _ping_retry = 1;
    private _ping_max_retries = 3;
    private _lag1 = 0;
    private _lag2 = 0;
    private _keepAliveTimer:NodeJS.Timer|undefined = undefined;
    private _keepAliveInterval = 15000;
    private _keepAliveRetryInterval = 5000;
    private _handshaked = false;
    
    constructor(public hostName:string, public namespace:string, public options:Object, app:Express, passkey?:string, live?:boolean, replica?:boolean){
        const remoteServer = ServerConnection.remoteServers.get(hostName);
        if(remoteServer){
            remoteServer.serverConnection = this;
            this._passkey = remoteServer.passkey;
            this.live = remoteServer.live;
        }

        if(passkey) this._passkey = passkey;
        if(live) this.live = live;
        if(replica) this.replica = replica;
        if(!ServerConnection._dictionaryChangedEventName) ServerConnection._dictionaryChangedEventName = `dictionaryChangedEventName${makeid(10)}`;
        this._app = app;
    }
    connect(){
        return new Promise((resolve, reject)=>{
            console.log(`\x1b[32mConnecting server \x1b[34m${this.hostName}\x1b[32m\x1b[0m`);
            /* CONNECT VIA WS */
            if(this.live){
                this.liveConnection();
            }
            /* UPDATE LOCAL DICTIONARY WITH REMOTE DICTIONARY */
            this.getServerReplica().then((updates)=>{
                if(ServerConnection._dictionaryChangedEventName) events.emit(ServerConnection._dictionaryChangedEventName, updates)
                resolve(this);
            }).catch(error=>{
                reject(error);
            })
        })
    }
    keepConnectionAlive() {
        if(!this._handshaked) this.handshake();
        this.ping(this);
        this._keepAliveTimer = setInterval(this.ping, this._keepAliveInterval, this)
    }
    private handshake() {
        if(!this._handshaked){
            const handshakeUrl = `${this.hostName}/api/server/remoteServer`;
            const handshake = {
                hostName: this.hostName,
                passkey: this._passkey,
                live:this.live,
                replica:this.replica,
                dictionaryChangedEventName: ServerConnection._dictionaryChangedEventName
            }
            ServerConnection.request('POST', handshakeUrl, {'server-request':'true'}, {handshake}).then(_response=>{
                this._handshaked = true;
            }).catch(error=>{
                console.log('handshake error', error.message);
                this._handshaked = false;
            })
        }
    }
    private ping(that:ServerConnection){
        const pingUrl = `${that.hostName}/api/server/ping`;
        const _ping = Date.now();
        ServerConnection.request('GET', pingUrl, {'server-request':'true'}).then(pong=>{
            that._lag1 = Date.now() - _ping;
            that._lag2 = Date.now() - (pong as GenericObject).pong;
            that._ping_retry = 1;
        }).catch(error=>{
            console.log(`PING ERROR ${error.message} (${that._ping_retry} / ${that._ping_max_retries})`);
            that._ping_retry++;
            if(that._ping_retry <= that._ping_max_retries){
                setTimeout(that.ping, that._keepAliveRetryInterval, that);
            }else{
                console.log('SERVER NOT RESPONDING');
                clearInterval(that._keepAliveTimer);
                that._keepAliveTimer = undefined;
            }
            
        })
    }
    /**
     * CONNECTION ON THE GATEWAY SIDE
     */
    private liveConnection(){
        this._socket = io(`${this.hostName}/${this.namespace}`, this.options);
        this._socket.on('connect', ()=>{
            console.log('Server Live Connected:', this.hostName);
            this._socket?.emit('handshake', this.hostName, this._passkey, this.replica, ServerConnection._dictionaryChangedEventName);
            console.log('\x1b[32mhandshake sent to\x1b[0m', this._socket?.id);
            this._connected = true;
            if(this._keepAliveTimer){
                clearInterval(this._keepAliveTimer);
                this._keepAliveTimer = undefined;
            }
            /*
            this.getServerReplica().then(result=>{
                const {newServices, newStaticPaths} = result;
                console.log('\x1b[32mNew Services added:\x1b[0m', newServices.length);
                console.log('\x1b[32mNew static Paths added:\x1b[0m', newStaticPaths.length);
            });
            */
        });
        this._socket.on('disconnect', ()=>{
            console.log('Server Live DISCONNECTED:', this.hostName);
            this._connected = false;
            this.keepConnectionAlive();
        });
        this._socket.on('serverResponse', (tid, response)=>{
            const promise = this._promises.get(tid);
            clearTimeout(promise?.timeout);
            promise?.resolve(response);
            this._promises.delete(tid);
        });
        this._socket.on('response', (tid, response)=>{
            const promise = this._promises.get(tid);
            clearTimeout(promise?.timeout);
            promise?.resolve(response);
            this._promises.delete(tid);
        });
        this._socket.on('error', (tid, response)=>{
            console.log('error', response);
            const promise = this._promises.get(tid);
            clearTimeout(promise?.timeout);
            this._promises.delete(tid);
        });
        this._socket.on('will', (tid, response)=>{
            const promise = this._promises.get(tid);
            console.log('will', response);
            clearTimeout(promise?.timeout);
            this._promises.delete(tid);
        });
        this._socket.on('clientMsg', (socketId, ev, ...args)=>{     
            const socket = ioServerOverHttps.sockets.sockets.get(socketId) || ioServerOverHttp.sockets.sockets.get(socketId);
            if(socket) socket.emit(ev, ...args);
        })
        this._socket.on('clientWill', (socketId, ev, ...args)=>{     
            const socket = ioServerOverHttps.sockets.sockets.get(socketId) || ioServerOverHttp.sockets.sockets.get(socketId);
            if(socket) socket.emit(ev, ...args);
        })
    }
    private getServerReplica(){
        return ServerConnection.getServerReplica(this.hostName, this._app);
    }

    private timeoutRequest (tid:string) {
        console.log('Request timeout %o', tid);
        const response504 = {   
            result  : "error",
            code    : 504,
            message : "Gateway Timeout"
        }
        const promise = this._promises.get(tid);
        promise?.reject(response504);
    }
    private emit(method:string, clientRequest:ClientRequest, feedback?:Function):Promise<Object> { 
        return new Promise((resolve,reject) => {
            const tid = makeid();
            clientRequest.toGenericObject().then(clientRequestObject=>{
                this._socket?.emit('serverRequest', method, clientRequestObject , tid);
                this._promises.set(tid, {
                    resolve : resolve,
                    reject : reject,
                    feedback: feedback,
                    //timeout : setTimeout(()=>{this.timeoutRequest(tid)}, this._maxRequestTimeout),
                    will:false
                });
            })
        });
    }
    public invoke(methodName:string, clientRequest:ClientRequest, feedback?:Function){
        return new Promise<GenericObject> ((resolve, reject)=>{
            //const method = this._apiDict[methodName];
            //if(method){
                if(this._connected && this._socket){
                    this.emit(methodName, clientRequest, feedback).then(response=>{
                        resolve(response)
                    }).catch(error=>reject(error));
                }else{
                    ServerConnection.remoteRequest(this.hostName, methodName, clientRequest).then(response=>{
                        resolve(response);
                    }).catch(error=>{
                        reject(error);
                    });
                }
            //}else{
            //    reject(`noService (${methodName})`);
            //}
        })
    }
    public static getServerReplica(hostName:string, app:Express, dictionaryChangedEventName?:string){
        return new Promise<GenericObject> ((resolve, reject) => {
            const dictionaryUrl = `${hostName}/api`;
            let newServices:GenericObject = {};
            let newStaticPaths:{
                method: string;
                path: string;
            }[] = [];
            ServerConnection.request('get', dictionaryUrl, {'server-request':'true'}).then((response:GenericObject)=>{
                if(response.remoteServers)  ServerConnection.registerRemoteServer(response.remoteServers);
                if(response.dict) newServices = ServerConnection.updateLocalDictionary(response["dict"], app, hostName);
                if(response.staticPaths) newStaticPaths = ServerConnection.proxyRemoteStaticPath(response.staticPaths, app, hostName);
                
                if(dictionaryChangedEventName){
                    events.on(dictionaryChangedEventName, (updates)=>{
                        ServerConnection.gatewayDictionaryChanged(updates, app, hostName);
                    })
                }
                resolve({newServices, newStaticPaths});
            }).catch(error=>{
                reject(error);
            })
        })
    }
    private static gatewayDictionaryChanged (updates:GenericObject, app:Express, hostName:string){
        const {newServices, newStaticPaths} = updates;
        ServerConnection.updateLocalDictionary(newServices, app, hostName);
        ServerConnection.proxyRemoteStaticPath(newStaticPaths, app, hostName);
    }
    private static updateLocalDictionary (methods:GenericObject, app:Express, hostName:string) {
        /**
         * ADD REMOTE Services TO LOCAL DICTIONARY
         */
        const newServices:GenericObject = {};
        Object.keys(methods).forEach(remoteServiceName=>{
            const remoteServiceItem = methods[remoteServiceName];
            let remoteService:Service = {
                name: remoteServiceName,
                parameters:remoteServiceItem.parameters,
                serviceType:remoteServiceItem.serviceType,
                requestCert:remoteServiceItem.requestCert,
                public:remoteServiceItem.public ?? true,
                serviceState:remoteServiceItem.serviceState,
                server:remoteServiceItem.server ?? hostName
            }
            if(remoteServiceItem.hasOwnProperty('get')) remoteService.get = remoteServiceItem.get;
            if(remoteServiceItem.hasOwnProperty('post')) remoteService.post = remoteServiceItem.post;
            if(remoteServiceItem.hasOwnProperty('put')) remoteService.put = remoteServiceItem.put;
            if(remoteServiceItem.hasOwnProperty('delete')) remoteService.delete = remoteServiceItem.delete;
            if(remoteServiceItem.hasOwnProperty('all')) remoteService.all = remoteServiceItem.all;
            if(remoteServiceItem.hasOwnProperty('use')) remoteService.use = remoteServiceItem.use;
            if(remoteServiceItem.hasOwnProperty('proxy')) remoteService.proxy = remoteServiceItem.proxy;
            if(remoteService.serviceType != 'render'){
                if(remoteService.name){
                    const Service = Services.get(remoteService.name);
                    if(Service){
                        //Service already exists
                        console.log(`Service \x1b[33m${Service.name}\x1b[0m already exists on this server`);
                    }else{
                        addService(undefined, remoteService) // TODO HERE moduleName set to Undefined
                        Object.assign(newServices, Object.fromEntries(new Map([[remoteServiceName,remoteService]])))
                        //newServices.push(Object.fromEntries(new Map([[remoteServiceName,remoteService]])));
                        console.log(`Service \x1b[34m${remoteService.name}\x1b[0m added to this server`);
                    }
                }
            }else{   
                console.log(`Adding Reverse Proxy for service \x1b[34m${remoteService.name}\x1b[0m to \x1b[34m${hostName}\x1b[0m`);
                if(remoteService.get) app.get(remoteService.get, createProxyMiddleware({ target: hostName, changeOrigin: true }));
                if(remoteService.all) app.all(remoteService.all, createProxyMiddleware({ target: hostName, changeOrigin: true }));
                if(remoteService.use) app.use(remoteService.use, createProxyMiddleware({ target: hostName, changeOrigin: true }));
            
            }
        });
        return newServices;
    }
    private static proxyRemoteStaticPath (staticPaths:StaticPathDefinition[], app:Express, hostName:string) {
        /**
         * PROXY FOR REMOTE STATIC PATHS
         */
        let newStaticPaths:{
            method: string;
            path: string;
        }[] = [];
        for(const route of staticPaths){
            const staticPathExisting = staticServices.find(staticService=>staticService.path==route.path);
            if(!staticPathExisting){
                const staticPath = {method:route.method, path:route.path};
                staticServices.push(staticPath);
                newStaticPaths.push(staticPath);
                switch(route.method){   
                    case 'get':
                        app.get(route.path, createProxyMiddleware([route.path], { target: `${hostName}`, changeOrigin: true }));
                        break;
                    case 'all':
                        app.all(route.path, createProxyMiddleware([route.path], { target: `${hostName}`, changeOrigin: true }));
                        break;
                    case 'use':
                    default:
                        app.use(route.path, createProxyMiddleware([route.path], { target: `${hostName}`, changeOrigin: true }));
                        break;
                }
            };
        }
        return newStaticPaths;
    }
    private static registerRemoteServer(remoteServers:RemoteServerDefinition[]){
        for (const remoteServer of remoteServers){
            if(!ServerConnection.remoteServers.has(remoteServer.hostName)){
                console.log(`Registering server \x1b[34m${remoteServer.hostName}\x1b[0m`)
                ServerConnection.remoteServers.set(remoteServer.hostName, {
                    passkey: remoteServer.passkey,
                    live:remoteServer.live,
                    replica: remoteServer.replica
                })
            }else{
                console.log(`Server \x1b[33m${remoteServer.hostName}\x1b[0m already registered`);
            }
        }
    }
    private static request (method:string, url:string, headers = {}, data?:any):Promise<Object> {
        return new Promise((resolve, reject) => {
            var config = {
                method,
                maxBodyLength: Infinity,
                url,
                headers,
                data
            };        
            axios(config).then(function (response) {
                resolve(response.data);
            }).catch(function (error) {
                reject(error);
            });
        });
    }
    public static async requestServerConnection (remoteHost:string, localHost:string, passkey:string) {
        const config = {
            method:'POST',
            maxBodyLength: Infinity,
            url : `${remoteHost}/api/server/remoteServer`,
            data : {localHost, passkey}
        };
    
        axios(config).then(response => {
            console.log(`\x1b[32mWaiting for a gateway connection ...\x1b[0m`, response.data);
            return;
        }).catch(error => {
            console.log('\x1b[30mError Requesting Server Connection\x1b[0m', error.message, error.code);
            return;
        });
    }
    public static  getGatewayService (fullServiceName:string):Promise<Service> {
        return new Promise((resolve, reject)=>{
            const remoteHost = coreGatewayConfig?.REMOTE_HOST;
            const localHost = coreGatewayConfig?.LOCAL_HOST;
            const passkey = coreGatewayConfig?.PASSKEY;
            if(remoteHost && localHost && passkey){
                const config = {
                    method:'POST',
                    maxBodyLength: Infinity,
                    url : `${remoteHost}/api/server/service`,
                    data : {localHost, passkey, fullServiceName}
                };
        
                axios(config).then(response => {
                    console.log(`getGatewayService`, response.data);
                    resolve(response.data);
                }).catch(error => {
                    console.log('Error Requesting Gateway Service Info: ', error.message, error.code);
                    reject(error);
                });
            }else{
                reject('getGatewayService :: bad gateway')
            }
        })
    }
    public static remoteRequest (hostName:string, methodName:string, clientRequest:ClientRequest) {
        return new Promise<GenericObject> ((resolve, reject)=>{
            
            const httpMethod = 'POST';
            const httpUrl = `${hostName}/api/server/remoteRequest`;

            clientRequest.toGenericObject().then(clientRequestObject => {
                const data = {
                    methodName,
                    clientRequest: clientRequestObject
                }
                ServerConnection.request(httpMethod, httpUrl, {'server-request':'true'}, data).then(res => {
                    const rr = res as GenericObject
                    if(rr.hasOwnProperty('remoteSetCookie')){
                        const remoteSetCookie = rr.remoteSetCookie;
                        for(const setCookie of remoteSetCookie){
                            clientRequest.setCookie(setCookie.cookieName, setCookie.cookieValue, setCookie.cookieMaxAge);
                        }       
                    }
                    if(rr.hasOwnProperty('remoteRedirect')){
                        clientRequest.redirect(rr.remoteRedirect.url, rr.remoteRedirect.status);
                    }
                    if(rr.hasOwnProperty('remoteResponse')){
                        resolve(rr.remoteResponse);
                    }
                    //resolve(res)
                }).catch(error=>{
                    if(error.response && error.response.data) reject(error.response.data);
                    if(error.response && !error.response.data) reject(error.response);
                    if(!error.response) reject(error);
                });
            })
        })
    };
    public static connect = (hostName:string, app:Express, passkey?:string, live?:boolean, replica?:boolean):Promise<RemoteServerConfig> => new Promise((resolve, reject)=>{
        let remoteServer = ServerConnection.remoteServers.get(hostName);
        if(!remoteServer){
            if(!passkey){
                console.log('\x1b[31mServerConnection.connect :: Passkey is required to connect a remote server\x1b[0m');
                throw('ServerConnection.connect :: Passkey is required to connect a remote server');
            }else{
                ServerConnection.remoteServers.set(hostName, {
                    passkey,
                    live:live ?? false,
                    replica: replica ?? false
                })
                remoteServer = ServerConnection.remoteServers.get(hostName);
            }
        }
        //if(remoteServer?.serverConnection){
        //    console.log(`\x1b[33mServer \x1b[32m${hostName}\x1b[33m already connected\x1b[0m`);
        //    resolve(remoteServer);
        //}else{
            if(remoteServer){
                remoteServer.serverConnection = new ServerConnection(hostName, 'servers', {transports: ['websocket']}, app, remoteServer.passkey, remoteServer.live, remoteServer.replica);
                remoteServer.serverConnection.connect().then(()=>{
                    console.log(`\x1b[32mServer \x1b[34m${hostName}\x1b[32m connected successfully\x1b[0m`);
                    
                    if(remoteServer) {
                        if(!remoteServer.serverConnection?.live) remoteServer.serverConnection?.keepConnectionAlive();
                        resolve(remoteServer);
                    }
                }).catch(error=>{
                    console.log(`\x1b[32mError connecting server \x1b[34m${hostName}\x1b[32m : \x1b[33m${error.message}\x1b[0m`);
                    if(remoteServer) remoteServer.serverConnection = undefined
                    reject(error);
                })
            }else{
                console.log('\x1b[33mServerConnection.connect :: \x1b[1mno remoteServer?\x1b[0m')
            }
        //}
    })
}