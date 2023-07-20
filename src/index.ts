import express, {Request, Response} from 'express'
import { Service, Module, GenericObject, ModuleConfig, ResponseManager, RemoteServerConfig, GatewayConfig, EngineConfig, EngineGatewayConfig, EngineServersConfig, ServiceState, EngineRedisConfig} from './Types';
import ClientRequest from './ClientRequest';
import { NextFunction } from 'express-serve-static-core';
import { parseCookie, makeid, fetch } from './tools';
import { Socket } from 'socket.io';
import path from 'path';
import * as ExpressCore from 'express-serve-static-core';
import { getPeerCertificate } from './Renegotiate'
import { setHttp, setSocket } from './setHttp';
import EventEmitter2 from 'eventemitter2';
import { initRedis } from './Redis';
import Session from './Session';
import { RedisClientType } from 'redis';
import ServerConnection from './ServerConnection';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Server } from "socket.io";

export {Request, Response, Socket, Service, GenericObject, ClientRequest, Session, RemoteServerConfig, GatewayConfig, EngineConfig, EngineGatewayConfig, EngineServersConfig, EngineRedisConfig, ServerConnection, fetch};

export const ServerVersion = '3.0.15';
export const ServerBuildNumber = 16898500; // Date.parse('2023-07-20').valueOf()/100000
const sessionIdParamName = 'sid';
const deviceIdParamName = 'did';
const defaultServiceState:ServiceState = "stateful";

var app:ExpressCore.Express;

type InternalService = Service & {moduleName?:string}

export var ioServerOverHttp:Server;
export var ioServerOverHttps:Server;
export const events = new EventEmitter2();
export var Services:Map<string, InternalService> = new Map();
export var staticServices:{method:string, path:string}[] = [];
export var redisClient:RedisClientType | undefined;
export var redisClientEnabled:boolean;

export var config:EngineConfig;
export var gatewayConfig:EngineGatewayConfig | undefined;
export var serversConfig:EngineServersConfig[] | undefined;
export var redisConfig:EngineRedisConfig | undefined;
//export var coreProcessRoot = process.argv.length>0 ? process.argv[1].split('/').slice(0,-1).join('/') : process.env.PWD;

var modules:Map<string, ModuleConfig> = new Map();

const bootstrap = (processEnv:NodeJS.ProcessEnv, dirname:string) => {
    const {config, gatewayConfig, serversConfig, redisConfig} = configureEngine(processEnv, dirname);
    
    startEngine(config, gatewayConfig, serversConfig, redisConfig);
}

export const startEngine = (engineConfig:EngineConfig, engineGatewayConfig?:EngineGatewayConfig, engineServersConfig?:EngineServersConfig[], engineRedisConfig?:EngineRedisConfig) => {
    config = engineConfig;
    gatewayConfig = engineGatewayConfig;
    serversConfig = engineServersConfig;
    redisConfig = engineRedisConfig;
    //https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
    console.log(`\x1b[32m================================================================ \x1b[0m`)
    console.log(`\x1b[32m SERVER \x1b[1m\x1b[34mv.${ServerVersion}\x1b[0m\x1b[32m Build \x1b[1m\x1b[34m${ServerBuildNumber}\x1b[0m`);
    console.log(`\x1b[32m Config Name: \x1b[1m\x1b[34m${config.CONFIG_NAME} \x1b[0m`);
    console.log(`\x1b[32m================================================================ \x1b[0m`)
    const {expressApp, httpServer, httpsServer} = setHttp(config);
    app = expressApp;
    ioServerOverHttp = setSocket(httpServer, config);
    if(httpsServer) ioServerOverHttps = setSocket(httpsServer, config);
    ioServerOverHttp.of("/servers").on("connection", manageWSServerConnection);
    if(httpsServer) ioServerOverHttps.of("/servers").on("connection", manageWSServerConnection);
    ioServerOverHttp.on('connection', manageWSClientConnection);
    if(httpsServer) ioServerOverHttps.on('connection', manageWSClientConnection);
    /**
     * REDIS CONNECTION
     */
    startRedis().then(()=>{
        /**
         * LOAD MODULES
         */
        importModules().then(()=>{
            /**
             * CONNECT TO GATEWAY / REMOTE SERVERS
             */
            startRemotes().then(()=>{
                addService(undefined, {
                    get:'/api',
                    serviceType: 'json',
                    public:false,
                    excludeFromReplicas:true,
                    serviceState: "stateless",
                    manager: getApiDictionary
                })
                addService(undefined, {
                    post:'/api/server/remoteRequest',
                    serviceType: 'json',
                    public:false,
                    serviceState: "stateless",
                    excludeFromReplicas:true,
                    manager: manageRemoteRequest
                })
                addService(undefined, {
                    post:'/api/server/remoteServer',
                    serviceType: 'json',
                    excludeFromReplicas:true,
                    public:false,
                    serviceState: "stateless",
                    manager: manageRemoteServer
                })
                addService(undefined,{
                    get:'/api/server/ping',
                    serviceType: 'json',
                    public: false,
                    excludeFromReplicas:true,
                    serviceState: "stateless",
                    manager: aliveServerManager
                });
                addService(undefined,{
                    post:'/api/server/service',
                    serviceType:'json',
                    excludeFromReplicas:true,
                    public:false,
                    serviceState: "stateless",
                    manager:getGatewayServiceManager
                });
                httpServer.listen(config.PORT);
                console.log(`\x1b[32mListening on port \x1b[34m${config.PORT}\x1b[0m`);
                if(httpsServer && config.HTTPS_PORT){
                    httpsServer.listen(config.HTTPS_PORT);
                    console.log(`\x1b[32mListening on port \x1b[34m${config.HTTPS_PORT}\x1b[0m`);
                }
                console.log(`\x1b[32m================================================================\x1b[0m`)
                events.emit('serverReady');
            })
        })
    })
}
export const configureEngine = (processEnv:NodeJS.ProcessEnv, dirname:string) => {
    var config = {
        "CONFIG_NAME" : processEnv.CONFIG_NAME || "default",
        "PORT" : processEnv.PORT ? Number.parseInt(processEnv.PORT, 10) : 3000,
        "HTTPS_PORT" : processEnv.HTTPS_PORT ? Number.parseInt(processEnv.HTTPS_PORT, 10) : undefined,
        "HTTPS_KEY_FILE" : processEnv.HTTPS_KEY_FILE ? path.join(dirname, processEnv.HTTPS_KEY_FILE) : undefined,
        "HTTPS_CERT_FILE" : processEnv.HTTPS_CERT_FILE ? path.join(dirname, processEnv.HTTPS_CERT_FILE) : undefined,
        "HTTPS_CA_FILE" : processEnv.HTTPS_CA_FILE ? path.join(dirname, processEnv.HTTPS_CA_FILE) : undefined,
        "HTTPS_PASSPHRASE" : processEnv.HTTPS_PASSPHRASE,
        "HTTPS_CIPHERS" : processEnv.HTTPS_CIPHERS,
        "MAX_BODY_SIZE" : processEnv.MAX_BODY_SIZE || "2mb",
        "MAX_HTTP_BUFFER_SIZE" : processEnv.MAX_HTTP_BUFFER_SIZE ? Number.parseInt(processEnv.MAX_HTTP_BUFFER_SIZE) : 100000000,
        "MODULES_PATH" : processEnv.MODULES_PATH ? path.join(dirname, processEnv.MODULES_PATH) : "./modules",
        "MODULES" : processEnv.MODULES ? processEnv.MODULES.split(',').map((item:string)=>item.trim()) : [],
        "GATEWAY_KEEP_ALIVE_INTERVAL" : processEnv.GATEWAY_KEEP_ALIVE_INTERVAL ? Number.parseInt(processEnv.GATEWAY_KEEP_ALIVE_INTERVAL, 10) : 15000,
        "GATEWAY_KEEP_ALIVE_RETRY_INTERVAL" : processEnv.GATEWAY_KEEP_ALIVE_RETRY_INTERVAL ? Number.parseInt(processEnv.GATEWAY_KEEP_ALIVE_RETRY_INTERVAL, 10) : 5000,
        "GATEWAY_KEEP_ALIVE_MAX_RETRIES" : processEnv.GATEWAY_KEEP_ALIVE_MAX_RETRIES ? Number.parseInt(processEnv.GATEWAY_KEEP_ALIVE_MAX_RETRIES, 10) : 3,
        "GATEWAY_AUTO_ATTACH_PASSKEY" : processEnv.GATEWAY_AUTO_ATTACH_PASSKEY
    }
    
    var gatewayConfig = undefined;
    if (processEnv.REMOTE_HOST){ // CONNECT TO A GATEWAY
        if(processEnv.REMOTE_HOST && processEnv.LOCAL_HOST && processEnv.PASSKEY){
            gatewayConfig = {
                REMOTE_HOST : processEnv.REMOTE_HOST,
                LOCAL_HOST : processEnv.LOCAL_HOST,
                PASSKEY : processEnv.PASSKEY,
                REPLICA : processEnv.REPLICA ? (processEnv.REPLICA?.toLowerCase?.() === 'true') : false,
                AUTO_ATTACH_PASSKEY : processEnv.AUTO_ATTACH_PASSKEY
            }
        }else{
            gatewayConfig = undefined;
            console.log('BAD GATEWAY CONFIGURATION');
            console.log('REMOTE_HOST, LOCAL_HOST and PASSKEY are required');
        }
    }
    
    var serversConfig:EngineServersConfig[] = [];
    
    const addServerConfig = (index?:number) => {
        if(index === undefined) index = 0;
        const ServerHost = `SERVER_${index}_HOST`;
        const ServerName = `SERVER_${index}_NAME`;
        const ServerPasskey = `SERVER_${index}_PASSKEY`;
        const ServerLive = `SERVER_${index}_LIVE`;
        const ServerReplica = `SERVER_${index}_REPLICA`;
        if(processEnv[ServerHost]){
            if(processEnv[ServerHost] && processEnv[ServerPasskey]){
                serversConfig.push({
                    HOST : processEnv[ServerHost] ?? "",
                    NAME : processEnv[ServerName] ?? "",
                    PASSKEY : processEnv[ServerPasskey] ?? "",
                    LIVE : processEnv[ServerLive] ? (processEnv[ServerLive]?.toLowerCase?.() === 'true') : false,
                    REPLICA : processEnv[ServerReplica] ? (processEnv[ServerReplica]?.toLowerCase?.() === 'true') : false
                })
            }
            addServerConfig(index+1);
        }
    }
    
    addServerConfig();


    let redisConfig:EngineRedisConfig|undefined = undefined; 
    if(processEnv.REDIS){
        redisConfig = {
            HOST: processEnv.REDIS?.toLowerCase?.() === 'true' ? true : processEnv.REDIS,
            PASSWORD:processEnv.REDIS_PASSWORD
        }
    } 

    return ({config, gatewayConfig, serversConfig, redisConfig});
}
/**
 * LIVE CONNECTION ON THE RemoteServer SIDE
 * @param socket 
 */
const manageWSServerConnection = (socket:Socket) => {
    console.log(`\x1b[34mGateway\x1b[0m is live \x1b[34m${socket.id}\x1b[0m`);
    events.emit('serverConnection', socket.id);
    socket.on('serverRequest', (ServiceName, clientRequest, tid) => {
        console.log(`You're requesting (3) ${ServiceName} via WS-REMOTE-API`, tid);
        const Service = Services.get(ServiceName);
        if(Service){
            manageWSRemoteRequest(socket, Service, clientRequest.params, tid, clientRequest);
        }
    });
    socket.on('disconnect', ()=>{
        console.log(`\x1b[34mGateway\x1b[33m disconnected\x1b[0m`);
    })
    socket.on('handshake', (host, passkey, replica, dictionaryChangedEventName)=>{
        if(host==gatewayConfig?.LOCAL_HOST && passkey==gatewayConfig?.PASSKEY){
            if(gatewayConfig?.REMOTE_HOST){
                console.log('\x1b[34mGateway\x1b[0m handshake finished\x1b[0m');
                const gatewayConnected = ServerConnection.gatewayServer.find(gatewaySocket=>gatewaySocket.id == socket.id);
                if(!gatewayConnected){
                    ServerConnection.gatewayServer.push(socket);
                    if(gatewayConfig?.REPLICA === true || replica === true){
                        ServerConnection.getServerReplica(gatewayConfig?.REMOTE_HOST, app, dictionaryChangedEventName).then(()=>{
                            console.log('\x1b[32mTHIS SERVER IS NOW A REPLICA\x1b[0m');                            
                        })
                    }
                }
            }else{
                console.log('GATEWAY COULD NOT BE REGISTERED');
            }
        }else{
            console.log(`Server Handshake :: Bad passkey for ${host}`);
            socket.disconnect();
        }
    });
}
const manageWSClientConnection = (socket:Socket) => {
    const cookies = socket.handshake.headers.cookie ? parseCookie(socket.handshake.headers.cookie) : undefined;
    console.log('New connection (WS)', socket.id, socket.nsp.name);
    events.emit('connection', socket.id, cookies);
    socket.on('request', (ServiceName, ServiceParams, tid) => {
        console.log(`You're requesting (1) ${ServiceName} via WS-API`, ServiceParams, tid);

        const Service = Services.get(ServiceName);
        if(Service){
            manageWSService(socket, Service, ServiceParams, tid);
        }
    });
}
const startRedis = ():Promise<void> => new Promise(resolve=>{
    if(redisConfig){
        initRedis().then(client=>{
            redisClient = client as RedisClientType;
            redisClientEnabled = true;
            console.log('\x1b[32mREDIS \x1b[34mENABLED\x1b[0m');
            Session.setAdapterType('redis');
            resolve();
        })
    }else{
        redisClientEnabled = false;
        redisClient = undefined;
        Session.setAdapterType('memory');
        resolve();
    }
})
const importModules = ():Promise<void> => new Promise(resolve=>{
    const modulePromises:Promise<void>[] = []
    if(config.MODULES && config.MODULES.length>0){
        config.MODULES.forEach(async (module) => {
            modulePromises.push(importModule(module.trim()));
        })
    }

    Promise.all(modulePromises).then(()=>{
        console.log('\x1b[32mModules ready\x1b[0m');
        resolve();
    })
})
const startRemotes = ():Promise<void> => new Promise(resolve=>{
    const remotesPromises:Promise<void|RemoteServerConfig>[] = []
    if(gatewayConfig){
        remotesPromises.push(ServerConnection.requestServerConnection(gatewayConfig.REMOTE_HOST, gatewayConfig.LOCAL_HOST, gatewayConfig.PASSKEY, gatewayConfig.AUTO_ATTACH_PASSKEY, gatewayConfig.LIVE, gatewayConfig.REPLICA));
    }
    if(serversConfig && serversConfig.length>0){
        
        for(const serverHost of serversConfig){
            //ServerConnection.remoteServers.set(serverHost.HOST, {passkey:serverHost.PASSKEY, live:serverHost.LIVE ?? false,  serverConnection:undefined});
            //remotesPromises.push(connectServer(serverHost.HOST, serverHost.PASSKEY, app, serverHost.LIVE));
            remotesPromises.push(ServerConnection.connect(serverHost.HOST, app, serverHost.PASSKEY, serverHost.LIVE, serverHost.REPLICA, serverHost.NAME));
        }
    }
    Promise.all(remotesPromises).then(()=>{
        if(serversConfig && serversConfig.length>0){
            console.log('\x1b[32mGateway ready\x1b[0m');
        }
        if(gatewayConfig){
            console.log('\x1b[32mNode ready\x1b[0m');
        }
        resolve();
    }).catch(_error=>{
        if(serversConfig && serversConfig.length>0){
            console.log('\x1b[32mGateway ready. \x1b[33mSome servers were not ready\x1b[0m');
        }
        if(gatewayConfig){
            console.log('\x1b[32mGateway not connected\x1b[0m');
        }
        resolve();
    })
    events.on('ServerNotResponding', (hostName, name)=>{
        manageServerNotResponding(hostName, name);
    });
})
export const importModule = async (module:string) => {
    console.log(`\x1b[32mModule: \x1b[34m${module}\x1b[0m`);
    const pathName = path.join(config.MODULES_PATH || './', module);
    const moduleItem = require(pathName) as Module;
    let moduleConfig:ModuleConfig = {};
    if(moduleItem.init) await moduleItem.init();
    if(moduleItem.renderer) moduleConfig.renderer = moduleItem.renderer;
    if(moduleItem.requestManager) moduleConfig.requestManager = moduleItem.requestManager;
    if(moduleItem.responseManager) moduleConfig.responseManager = moduleItem.responseManager;

    modules.set(module, moduleConfig);

    if(moduleItem.Services){
        for (const Service of moduleItem.Services) {
            
            if(Service.serviceType !== 'static') addService(module, Service);
            if(Service.serviceType === 'static') addStaticService(module, Service);
        }
    }
}
/**
 * 
 * @param name Service name
 * @param Service Service definition
 */
export const addService = (moduleName:string | undefined, Service:Service) => {
    var internalService:InternalService = {...Service, ...{moduleName}};
    if(!Service.name){
        Service.name = `service${Date.now()}`;
        Service.public = false;
    }
    if(!Service.serviceState) Service.serviceState = defaultServiceState;

    var serviceLabel = moduleName && Service.name ? `${moduleName}.${Service.name}` : Service.name;
    internalService.public = Service.public ?? true;
    console.log(`Adding service ${internalService.serviceType} ${serviceLabel} - ${internalService.public ? 'public' : 'private'} - ${internalService.excludeFromReplicas ? 'excluded from replica' : 'replicable'}`,);
    Services.set(serviceLabel, internalService);

    if(['json','form','render'].includes(Service.serviceType)){
        if (Service.get) app.get(Service.get, (req, res, next) => manageHttpService(req, res, internalService, next));
        if (Service.post) app.post(Service.post, (req, res, next) => manageHttpService(req, res, internalService, next));
        if (Service.put) app.put(Service.put, (req, res, next) => manageHttpService(req, res, internalService, next));
        if (Service.delete) app.delete(Service.delete, (req, res, next) => manageHttpService(req, res, internalService, next));
        if (Service.all) app.all(Service.all, (req, res, next) => manageHttpService(req, res, internalService, next));
        if (Service.use) app.use(Service.use, (req, res, next) => manageHttpService(req, res, internalService, next));
    }
    if (Service.serviceType == 'proxy'){
        if(!Service.proxy) throw "proxy services requires 'proxy' attributes";
        let method:string = "use";
        if (Service.get) method = "get";
        if (Service.post) method = "post";
        if (Service.put) method = "put";
        if (Service.delete) method = "delete";
        if (Service.all) method = "all";
        if (Service.use) method = "use";
        const path = (Service as GenericObject)[method];
        const context = Service.proxyContext || (Service as GenericObject)[method];
        if(!Service?.proxy?.pathRewrite) Service.proxy.pathRewrite = true;
        if(!Service?.proxy?.changeOrigin) Service.proxy.changeOrigin = true;
        if(Service?.proxy?.pathRewrite === true){
            const pathRewriteLabel = `^${path}`
            const pathRewrite:GenericObject = {}
            pathRewrite[pathRewriteLabel] = '';
            Service.proxy.pathRewrite = pathRewrite
        }
        const proxy = createProxyMiddleware(context, Service.proxy as GenericObject);
        switch(method){
            case "get":
                app.get(path, proxy);
                break;
            case "post":
                app.post(path, proxy);
                break;
            case "put":
                app.put(path, proxy);
                break;
            case "delete":
                app.delete(path, proxy);
                break;
            case "all":
                app.all(path, proxy);
                break;
            case "use":
                app.use(path, proxy);
            default:
                break;
        }
    }
}
export const addStaticService = (_moduleName:string, Service:Service) => {
    
    if (Service.get && Service.path) {
        app.get(Service.get, express.static(Service.path, {"etag" : false }));
        staticServices.push({method:'get', path:Service.get});
    }
    if (Service.all && Service.path) {
        app.all(Service.all, express.static(Service.path, {"etag" : false }));
        staticServices.push({method:'all', path:Service.all});
    }
    if (Service.use && Service.path) {
        app.use(Service.use, express.static(Service.path, {"etag" : false }));
        staticServices.push({method:'use', path:Service.use});
    }
}
export const addStaticRoute = (route:string, staticPath:string) => {
    app.use(route, express.static(staticPath, {"etag" : false }));
    staticServices.push({method:'use', path:staticPath});
}
export const invokeService = (ServiceName:string, request:ClientRequest, params?:GenericObject) => new Promise((resolve, reject)=>{
    if(params) request.params = params;

    const Service = Services.get(ServiceName);

    if(Service) {
        invokeLocalService(Service, request).then(response=>{
            if(Service.server){
                resolve(remoteResponseManager(response, request));
            }else{
                resolve(response)

            }
        }).catch(error=>reject(error));
    }else{
        /**
         * WHEN THE SERVICE IS NOT IN THE LOCAL DICTIONARY, AND THIS INSTANCE IS CONNECTED TO A GATEWAY 
         * THEN RETRIEVE SERVICE INFO FROM GATEWAY AND ADD THE SERVICE TO THE LOCAL DICTIONARY FOR FUTURE USE 
         **/
        if(gatewayConfig){
            ServerConnection.getGatewayService(ServiceName).then((serviceInfo)=>{
                //CACHE THIS SERVICE
                const serverHost = serviceInfo.server || gatewayConfig?.REMOTE_HOST;
                if(serverHost){
                    ServerConnection.remoteRequest(serverHost, ServiceName, request).then((remoteResponse)=>{
                        resolve(remoteResponse)
                    }).catch((_error:any)=>{
                        reject('invokeRemoteService error');
                    });
                }
            }).catch(error=>{
                reject({
                    result  : "error",
                    code    : 500,
                    message : error.message || `invokeService :: Service ${ServiceName} not implemented (2)`
                });
            })
        }else{
            reject({
                result  : "error",
                code    : 500,
                message : `invokeService :: Service ${ServiceName} not implemented (1)`
            });
        }
    }
})
/**
 * 
 * @param Service Service
 * @param request Request
 * @returns response
 */
const invokeLocalService = (Service:Service, request:ClientRequest) => new Promise<GenericObject>((resolve, reject)=>{
    if(Service.server === undefined){
        if(Service.manager){
            Service.manager(request).then(response=>{
                resolve(response); // TODO: Check This
            }).catch(error=>{
                reject(error);
            })
        }else{
            resolve({});
        }
    }else{
        if(Service.server === ''){
            reject(responseError(504, `Remote server for service ${Service.name} is disconnected`));
        }else{
            if(gatewayConfig && Service.name){
                
                const serverHost = Service.server || gatewayConfig?.REMOTE_HOST;
                if(serverHost){
                    ServerConnection.remoteRequest(serverHost, Service.name, request).then((remoteResponse)=>{
                        resolve(remoteResponse)
                    }).catch((_error:any)=>{
                        reject('invokeRemoteService error');
                    });
                }
            
            }else{
                //It's a remote Service

                const remoteServer = ServerConnection.remoteServers.get(Service.server);
                if(remoteServer){
                    const serverConnection = remoteServer.serverConnection;
                    if(serverConnection && Service.name){
                        serverConnection.invoke(Service.name, request, (feedback:GenericObject)=>{
                            request.willResolve(feedback)
                        }).then(remoteResponse=>{
                            resolve(remoteResponse)
                        }).catch(error=>{
                            //reject(responseError(505, error.message || error));
                            reject(error)
                        });
                    }else{
                        console.log(`invokeLocalService :: RemoteServer ${Service.server} has no ServerConnection made`);
                        reject(`invokeLocalService :: RemoteServer ${Service.server} has no ServerConnection made`);
                    }
                }else{
                    //TODO: This should not happen, but manage this error. Remote Server not found
                    reject(`invokeLocalService :: Server ${Service.server} not registered! `)
                }
            }
        }
    }
})

export const responseError = (status:number, info?:Object | unknown, data?:Object):GenericObject => {
    let message
    switch (status){
        case 400:
            message = "Bad request";
            break;
        case 401:
            message = "Unauthorized";
            break;
        case 403:
            message = "Forbidden";
            break;
        case 404:
            message = "Not Found";
            break;
        case 500:
            message = "Internal server error";
            break;
        default:
            message = "Unknown error";
    }
    let response = {
        result : "error",
        status,
        message,
        info,
        data
    }
    return response;
}
/**
 * 
 * @param req Express Request
 * @param res Express Response
 * @param Service Service
 * @param next Next Function
 */
const manageHttpService = async (req: Request, res:Response, Service:InternalService, next: NextFunction) =>{
    const request = await manageHttpRequest(req, res, Service);
    const requestManager = Service.requestManager || (Service.moduleName ? modules.get(Service.moduleName) : undefined)?.requestManager || defaultRequestManager;
    const responseManager = Service.responseManager || (Service.moduleName ? modules.get(Service.moduleName) : undefined)?.responseManager || defaultResponseManager;
    
    const managedRequest = requestManager(request);
    if(Service.requestCert && req){

        getPeerCertificate(req).then((cert:Object)=>{
            managedRequest.certificate = cert;
            invokeHttpService(Service, managedRequest, responseManager, res, next);
        }).catch((error:any)=>{
            console.log('error getting certificate (https)', error);
            if(['json', 'form'].includes(Service.serviceType)) resolveJsonServiceDefault(false, res, error);
            if(Service.serviceType == 'render') resolveRenderServiceDefault(Service, res, error, request.lang);
            managedRequest.toGenericObject().then(managedRequestGO=>{
                events.emit('invokeServiceError', managedRequestGO, error, Service.name, Service.serviceType);
            })
        })
    }else{
        invokeHttpService(Service, managedRequest, responseManager, res, next);
    }
}
/**
 * 
 * @param req Express Request
 * @param res Express Response
 * @param Service Service
 * @returns request
 */
const manageHttpRequest = async (req: Request, res:Response, Service:Service): Promise<ClientRequest> =>{
    let cookies = req.headers?.cookie ? parseCookie(req.headers.cookie) : undefined;
    let sessionId = cookies ? cookies[sessionIdParamName] : undefined;
    let deviceId = cookies ? cookies[deviceIdParamName] : '';
    let refererAllowed = false;
    let session:Session|string|undefined = sessionId;

    ///TODO: MANAGE REFERERS (JS BLOCK)
    //if(req.headers['referer'] && process.env.SECURITY && process.env.SECURITY.ALLOWED_REFERERS){
    //    if(Array.isArray(process.env.SECURITY.ALLOWED_REFERERS)){
    //        refererAllowed = process.env.SECURITY.ALLOWED_REFERERS.includes(req.headers['referer'])
    //    }
    //}
    

    //MANAGE RESPONSE
    const stateless = req.headers['server-request'] == 'true' || Service.serviceState == "stateless"
    if(!stateless){
        //#region Send SessionId cookie
        if(!res.headersSent){
            if(!req.headers['sec-fetch-site'] || refererAllowed || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site']!='cross-site')){
                if(!sessionId){
                    sessionId = makeid(20);
                    console.log(`Creating a new sessionId (1) \x1b[33m${sessionId}\x1b[0m for service \x1b[33m${Service.name}\x1b[0m`)
                    if(req.protocol == 'https')
                        res.cookie(sessionIdParamName, sessionId, { sameSite: 'strict', secure: true});
                    else
                        res.cookie(sessionIdParamName, sessionId, { sameSite: 'strict' });
                }
                if(!deviceId){
                    deviceId = makeid(20);
                    console.log(`Creating a new deviceId \x1b[33m${deviceId}\x1b[0m`)
                    if(req.protocol == 'https')
                        res.cookie(deviceIdParamName, deviceId, { maxAge: 9999999999999, sameSite: 'strict', secure: true});
                    else
                        res.cookie(deviceIdParamName, deviceId, { maxAge: 9999999999999, sameSite: 'strict'});
                }
            }else{
                //console.log('manageHttpRequest :: request refused', req.originalUrl, req.headers);
            }
        }
        //#endregion
        
        if(!sessionId){
            sessionId = makeid(20);
            console.log(`Creating a new sessionId (2) \x1b[33m${sessionId}\x1b[0m for service \x1b[33m${Service.name}\x1b[0m`)
            if(!res.headersSent){
                if(req.protocol == 'https')
                        res.cookie(sessionIdParamName, sessionId, { sameSite: 'strict', secure: true});
                    else
                        res.cookie(sessionIdParamName, sessionId, { sameSite: 'strict' });
            }
        }
        //let session = getSession(sessionId);
        session = await Session.get(sessionId)
        //session.deviceId = deviceId;
        //session.id = sessionId;
        await session.setValue(deviceIdParamName, deviceId);
        //sessionId.setValue("id", sessionId);
        if(req.headers[sessionIdParamName]) sessionId = req.headers[sessionIdParamName];
    }
    var clientRequest = new ClientRequest(req, session, Service.serviceType, {}, res);
    if(req.params){
        for (var [key, value1] of Object.entries(req.params)){
            clientRequest.params[key] = value1;
        }
    }
    if(req.body){
        for (var [key, value2] of Object.entries(req.body)){
            clientRequest.params[key] = value2;
        }
    }
    if(req.query){
        for (var [key, value3] of Object.entries(req.query)){
            clientRequest.params[key] = value3;
        }
    }
    if(req.files){
        for (var [key, value4] of Object.entries(req.files)){
            clientRequest.params[key] = value4;
        }
    }
    clientRequest.toGenericObject().then(clientRequestGO=>{
        events.emit('clientRequest', clientRequestGO, Service.name, Service.serviceType);
    })
    return clientRequest;
}
const invokeHttpService = (Service:InternalService, managedRequest:ClientRequest, responseManager: ResponseManager, res:Response, next: NextFunction) => {
    managedRequest.toGenericObject().then(managedRequestGO=>{
        events.emit('manageService', managedRequestGO, Service.name, Service.serviceType);
        invokeLocalService(Service, managedRequest).then(response=>{
            let responseManaged:GenericObject|undefined = undefined;
            if(Service.server){
                //responseManaged = remoteHttpResponseManager(response, managedRequest, res)
                responseManaged = remoteResponseManager(response, managedRequest);
            }
            responseManaged = responseManager(responseManaged || response, managedRequest, res);
            if(responseManaged && ['json', 'form'].includes(Service.serviceType)) resolveJsonServiceDefault(true, res, responseManaged);
            if(responseManaged && Service.serviceType == 'render') resolveRenderServiceDefault(Service, res, responseManaged, managedRequest.lang);
            events.emit('invokeServiceSuccess', managedRequestGO, responseManaged, Service.name, Service.serviceType);
            if(!res.headersSent && next) next();
        }).catch(error=>{
            //#region MANAGE ERROR
            events.emit('invokeServiceError', managedRequestGO, error, Service.name, Service.serviceType);
            if(['json', 'form'].includes(Service.serviceType)) resolveJsonServiceDefault(false, res, error);
            if(Service.serviceType == 'render') resolveRenderServiceDefault(Service, res, error, managedRequest.lang);
            if(!res.headersSent && next) next();
            //#endregion
        })
    })
}
const manageWSService = async (socket:Socket, Service:InternalService, ServiceParams:any, tid:string, serverRequest?:GenericObject) => {
    
    const isServerRequest = serverRequest ? true : false;
    
    if(isServerRequest){
        console.log('Its a server request');
    }

    const request = await manageWSRequest(socket, Service, ServiceParams ?? {}, tid, serverRequest);

    //if(!isServerRequest){
        const requestManager = Service.requestManager || (Service.moduleName ? modules.get(Service.moduleName) : undefined)?.requestManager || defaultRequestManager;
        const responseManager = Service.responseManager || (Service.moduleName ? modules.get(Service.moduleName) : undefined)?.responseManager || defaultResponseManager;
    //}
    
    if(request){      
        const managedRequest = requestManager(request);

        if(Service.requestCert && socket.request){
            const req = socket.request as Request;
            
            managedRequest.willResolve({status:'renegotiating'});
            getPeerCertificate(req).then((cert:Object)=>{
                managedRequest.certificate = cert;
                invokeWSService(Service, managedRequest, responseManager, socket, tid);
            }).catch(error=>{
                console.log('error getting certificate (wss)', error);
                socket.emit('error', tid, error);
                managedRequest.toGenericObject().then(managedRequestGO=>{
                    events.emit('invokeServiceError', managedRequestGO, error, Service.name, Service.serviceType);
                })
            })
            
        }else{
            invokeWSService(Service, managedRequest, responseManager, socket, tid);
        }
    }
}
const manageWSRequest = async (socket:Socket, Service:Service, ServiceParams:any, tid:string, serverRequest?:GenericObject) => {
    let session:Session;
    if(!serverRequest){
        let cookies = socket.handshake.headers.cookie ? parseCookie(socket.handshake.headers.cookie) : undefined;
        let sessionId = cookies ? cookies[sessionIdParamName] : '';
        let deviceId = cookies ? cookies[deviceIdParamName] : '';
        if(!sessionId) {
            sessionId = makeid(20);
            socket.emit('cookie', sessionIdParamName, sessionId);
        }
        if(!deviceId) {
            deviceId = makeid(20);
            socket.emit('cookie', deviceIdParamName, deviceId, 9999999999999);
        }

        session = await Session.get(sessionId);
        socket.join(`${sessionIdParamName}:${sessionId}`);

        await session.setValue(deviceIdParamName, deviceId);
        await session.setValue(sessionIdParamName, sessionId);
    }else{
        session = await Session.get(serverRequest.session.id);
    }
    var clientRequest = new ClientRequest(socket, session, Service.serviceType, ServiceParams, tid, serverRequest);
    clientRequest.toGenericObject().then(clientRequestGO=>{
        events.emit('clientRequest', clientRequestGO, Service.name, Service.serviceType);
    })
    return clientRequest;
    
}
const invokeWSService = (Service:InternalService, managedRequest:ClientRequest, responseManager: ResponseManager, socket:Socket, tid:string) => {
    managedRequest.toGenericObject().then(managedRequestGO=>{
        events.emit('manageService', managedRequestGO, Service.name, Service.serviceType);
    
        invokeLocalService(Service, managedRequest).then(response=>{
            let responseManaged:GenericObject|undefined = undefined;
            if(Service.server){
                responseManaged = remoteResponseManager(response, managedRequest);
            }
            responseManaged = responseManager(responseManaged || response, managedRequest);
            socket.emit('response', tid, responseManaged);
            events.emit('invokeServiceSuccess', managedRequestGO, responseManaged, Service.name, Service.serviceType);
        }).catch(error=>{
            socket.emit('error', tid, error);
            events.emit('invokeServiceError', managedRequestGO, error, Service.name, Service.serviceType);
        })
    })
}
const remoteResponseManager = (response:GenericObject, clientRequest:ClientRequest) => {
    if(response.hasOwnProperty('remoteSetCookie')){
        const remoteSetCookie = response.remoteSetCookie;    
        for(const setCookie of remoteSetCookie){
            clientRequest.setCookie(setCookie.cookieName, setCookie.cookieValue, setCookie.cookieMaxAge);
        }
    }
    if(response.hasOwnProperty('remoteRedirect')){
        clientRequest.redirect(response.remoteRedirect.url, response.remoteRedirect.status ?? 302);
    }
    if(response.hasOwnProperty('remoteResponse')){
        return response.remoteResponse;
    }else{
        return response;
    }
}


/**
 * 
 * @param res Express Response object
 * @param response Service response
 */
const resolveJsonServiceDefault = (success:boolean,res:Response, response:GenericObject)=>{
    if(success){
        if(!res.headersSent) res.status(200).send(response);
    }else{
        if(!res.headersSent) res.status(500).send(response);
    }
}
const resolveRenderServiceDefault = (Service:InternalService, res:Response, response:GenericObject, lang?:string|string[])=>{
    let content: string | undefined = undefined;

    let moduleRenderer = (Service.moduleName ? modules.get(Service.moduleName) : undefined)?.renderer;
    
    let renderer = moduleRenderer || Service.renderer;
    
    if(renderer) {
        content = renderer(response, lang);
        
        if(!res.headersSent && !res.closed && content){
            res.status(response?.status || 200).send(content || response);
        }

        //if(success){
        //    if(!res.headersSent && response){
        //        const viewsPath = path.join(PROCESS_ROOT, '../views');
        //        const filePath = path.join(viewsPath, 'index.html');
        //        const content = fs.readFileSync(filePath, {encoding : 'utf8'});
        //        res.status(200).send(content);
        //    }
        //}else{
        //    res.status(500).send(response);
        //}
        //if(res.headersSent) res.render('index', response);
    }
}
const defaultRequestManager = (request:ClientRequest) => {
    return request;
}
const defaultResponseManager = (response:GenericObject, _request:ClientRequest, _res?:Response) => {
    return response;
}
const getApiDictionary = (request:ClientRequest):Promise<Object> => new Promise((resolve, reject)=>{
    if(request && Services) {
        var dict:GenericObject = {};
        const serverRequest = request.headers['server-request']==='true';
        const remoteServersList:GenericObject[] = [];
        Services.forEach((value: Service, key: string) => {
            let includeInDictionary = true;
            if(serverRequest && value.excludeFromReplicas) includeInDictionary = false;
            if(!serverRequest && value.public === false)includeInDictionary = false;
            if(includeInDictionary) {
                
                dict[key] = {
                    serviceType: value.serviceType,
                };
                if(serverRequest) dict[key].name = value.name;
                if(serverRequest) dict[key].public = value.public ?? true;
                if(value.get) dict[key].get = value.get;
                if(value.post) dict[key].post = value.post;
                if(value.put) dict[key].put = value.put;
                if(value.delete) dict[key].delete = value.delete;
                if(serverRequest){
                    if(value.all) dict[key].all = value.all;
                    if(value.use) dict[key].use = value.use;
                }else{
                    if(value.all) dict[key].get = value.all;
                    if(value.use) dict[key].get = value.use;
                }
                if(value.parameters) dict[key].parameters = value.parameters;
                if(value.requestCert && serverRequest) dict[key].requestCert = value.requestCert;
                if(value.serviceState && serverRequest) dict[key].serviceState = value.serviceState;
                if(value.server && serverRequest) dict[key].server = value.server;
                if(value.serviceType == 'proxy' && serverRequest){
                    dict[key].proxy = value.proxy
                }
            
            }
        })
        if(serverRequest){
            ServerConnection.remoteServers.forEach((remoteServerConfig: RemoteServerConfig, hostName:string)=>{
                remoteServersList.push({
                    hostName,
                    passkey:remoteServerConfig.passkey,
                    replica:remoteServerConfig.replica
                });
            })
        }
        const response = {
            dict, 
            staticPaths: serverRequest ? staticServices : undefined,
            remoteServers: serverRequest ? remoteServersList : undefined,
            pid:process.pid,
        }
        resolve(response);
    }else{
        reject(undefined);
    }
})
const aliveServerManager = (_request:ClientRequest):Promise<Object> => new Promise((resolve, _reject)=>{
    resolve({pong:Date.now()})
})
const getGatewayServiceManager = (request:ClientRequest):Promise<Object> => new Promise((resolve, reject)=>{
    const {localHost, passkey, fullServiceName} = request.params;
    
    const remoteServer = ServerConnection.remoteServers.get(localHost);

    if(remoteServer && remoteServer.passkey == passkey){
        const service = Services.get(fullServiceName);
        if(service){
            const {
                name,
                path,
                get,
                post,
                put,
                all,
                use,
                serviceType,
                parameters,
                requestCert,
                server
            } = service;
            const deleteParam = service.delete;
            const publicParam = service.public;
            resolve({
                    name,
                    path,
                    get,
                    post,
                    put,
                    delete:deleteParam,
                    all,
                    use,
                    serviceType,
                    public:publicParam,
                    parameters,
                    requestCert,
                    server
                }
            )
        }else{
            reject(responseError(404));
        }
    }else{
        reject(responseError(401));
    }
});
const manageWSRemoteRequest = async (socket:Socket, Service:InternalService, ServiceParams:any, tid:string, serverRequest?:GenericObject) => {
    const proxiedClientRequest = await manageWSRequest(socket, Service, ServiceParams ?? {}, tid, serverRequest);
    if(proxiedClientRequest){
        proxiedClientRequest.toGenericObject().then(proxiedClientRequestGO=>{
            invokeLocalService(Service, proxiedClientRequest).then(remoteResponse=>{
                const response = {
                    remoteResponse,
                    remoteSetCookie: proxiedClientRequest.remoteSetCookie, 
                    remoteRedirect: proxiedClientRequest.remoteRedirect
                }
                socket.emit('serverResponse', tid, response);
                events.emit('invokeServiceSuccess', proxiedClientRequestGO, response, Service.name, Service.serviceType);
            }).catch(error=>{
                events.emit('invokeServiceError', proxiedClientRequestGO, error, Service.name, Service.serviceType);
                socket.emit('error', tid, error);
            })
        })
    }
}
const manageRemoteRequest = (request:ClientRequest):Promise<Object> => new Promise((resolve, reject)=>{
    const {methodName, clientRequest} = request.params;
    if(Services.has(methodName)){
        const Service = Services.get(methodName);
        if(Service){
            const proxiedClientRequest = new ClientRequest(
                request.req as Request, clientRequest.session.id,
                Service.serviceType, 
                clientRequest.params, 
                request.res, 
                clientRequest
            );
            proxiedClientRequest.toGenericObject().then((proxiedClientRequestGO:GenericObject)=>{
                events.emit('clientRequest', proxiedClientRequestGO, Service.name, Service.serviceType);
            })
            if(Service?.manager){
                Service?.manager(proxiedClientRequest).then(remoteResponse => {
                    resolve({remoteResponse, remoteSetCookie: proxiedClientRequest.remoteSetCookie, remoteRedirect:proxiedClientRequest.remoteRedirect});
                }).catch(error=>{
                    reject(error);
                })
            }else{
                console.log(`${methodName} has no way to manage it`)
                console.log(Service)
                reject(responseError(500, `${methodName} has no way to manage it`));
            }
        }else{
            reject(responseError(500, `${methodName} not available on this server`));
        }
    }else{
        reject(responseError(500, `${methodName} not available on this server`));
    }
})
const manageRemoteServer = (request:ClientRequest):Promise<Object> => new Promise((resolve, reject)=>{
    const {localHost, passkey, handshake, autoAttachPasskey, live, replica, configName} = request.params;
    // ON  THE GATEWAY SIDE
    if(localHost && passkey){
        //const server = serversConfig.find(server=>server.HOST == localHost)
        const serverConnection = ServerConnection.remoteServers.get(localHost);
        if(serverConnection){
            serverConnection.live = serverConnection.live ?? live
            serverConnection.name = configName;
            if(serverConnection?.passkey == passkey){
                ServerConnection.connect(localHost, app).then(()=>{
                    resolve({result:'ok'});
                }).catch(error=>{
                    reject(error);
                })
            }else{
                reject({code:403, message:`invalid passkey for host ${localHost}`});
            }
        }else{
            if (autoAttachPasskey && config.GATEWAY_AUTO_ATTACH_PASSKEY && autoAttachPasskey === config.GATEWAY_AUTO_ATTACH_PASSKEY){
                ServerConnection.remoteServers.set(localHost, {
                    'live' : live,
                    'replica' : replica,
                    'passkey' : passkey
                })
                console.log('here 2');
                ServerConnection.connect(localHost, app).then(()=>{
                    resolve({result:'ok', autoAttached:true});
                }).catch(error=>{
                    reject(error);
                })
            }else{
                reject({error:`host ${localHost} not allowed`});
            }
        }
    }
    // ON THE SERVER SIDE
    if(handshake){
        if(gatewayConfig){
            console.log('\x1b[32mGATEWAY SUCCESSFULLY CONNECTED (HTTP)\x1b[0m');
            if(gatewayConfig && handshake.passkey == gatewayConfig.PASSKEY && gatewayConfig?.REPLICA === true || handshake.replica === true){
                ServerConnection.getServerReplica(gatewayConfig.REMOTE_HOST, app, handshake.dictionaryChangedEventName).then(()=>{
                    console.log('\x1b[32mTHIS SERVER IS NOW A REPLICA\x1b[0m');
                    resolve({result:'replica'});
                })
            }else{
                resolve({result:'ok'});
            }
        }else{
            reject(responseError(500))
        }
    }
});
const manageServerNotResponding = (hostName:string, name?:string) => {
    console.log(`\x1b[31mServerNotResponding \x1b[34m${name || hostName}\x1b[0m`);
    for (const service of Services.values()) {
        if(service.server == hostName){
            console.log(`\x1b[31m${service.name}\x1b[0m is down for host \x1b[34m${service.server}\x1b[0m`);
            service.server = "";
        }
      }
}
export default bootstrap;