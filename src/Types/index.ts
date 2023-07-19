import ClientRequest from '../ClientRequest';
import ServerConnection from '../ServerConnection';
import { Request, Response } from 'express';
import { Socket } from 'socket.io';

export type ServiceState = "stateful" | "stateless"
export type Renderer = (response:GenericObject, lang:string|string[]|undefined) => string | undefined;
export type Manager = (request: ClientRequest) => Promise<Object>;
export type RequestManager = (request:ClientRequest) => ClientRequest;
export type ResponseManager = (response:GenericObject, request:ClientRequest, res?:Response) => GenericObject|undefined;

export { ClientRequest };

export type Module = {
    init: Function
    Services:Service[],
    renderer: (response:GenericObject, lang:string|string[]|undefined) => string | undefined,
    requestManager?: (request:ClientRequest) => ClientRequest,
    responseManager?: ResponseManager
}
export type ModuleConfig = {
    renderer?: (response:GenericObject, lang:string|string[]|undefined) => string | undefined
    requestManager?: (request:ClientRequest) => ClientRequest
    responseManager?: ResponseManager
}
export type GenericObject = {[k: string]: any};

export type SessionValue = string|number|boolean|GenericObject|undefined;

export type ManagerType = 'json' | 'form' | 'render' | 'static' | 'proxy';

export type ServiceProxyOptions = {
    changeOrigin?:boolean,
    secure?:boolean,
    pathFilter?:string|string[]|((path:string, req:Request)=>boolean),
    target:string,
    pathRewrite?:boolean|{[k: string]: string}|((path:string, req:Request)=>string),
    router?:()=>string|{protocol:"http:"|"https:", host:string, port:number}
}

export type Service = {
    name?: string,                  // Service Name
    path?:string,                   // Local path for 'static' services
    get?: string,                   // Route to GET method
    post?: string,                  // Route to POST method
    put?: string,                   // Route to PUT method
    delete?: string,                // Route to DELETE method
    all?: string,                   // Route to ALL methods
    use?: string,                   // Route to USE method
    serviceType: ManagerType,       // Service Type
    public?: boolean,               // Only 'public' services are exposed in the client API
    manager?: Manager,
    renderer?: Renderer,
    parameters?:string,
    requestCert?:boolean,           // Request to renegotiate for a Client Certificate
    server?:string,                 // Internal use to set the remote server where de service is allocated
    requestManager?: RequestManager,
    responseManager?: ResponseManager
    proxy?: ServiceProxyOptions,    // Proxy Options. 'target' is required
    proxyContext?:string            // Proxy Context. default is the same service path
    excludeFromReplicas?:boolean,   // Exclude this service from remote replicas
    serviceState?:ServiceState 
}
export type EngineConfig = {
    CONFIG_NAME:string,
    PORT : number,
    HTTPS_PORT? : number,
    HTTPS_KEY_FILE? : string,
    HTTPS_CERT_FILE? : string,
    HTTPS_CA_FILE? : string,
    HTTPS_PASSPHRASE? : string,
    HTTPS_CIPHERS? : string
    MAX_BODY_SIZE?: string,
    MAX_HTTP_BUFFER_SIZE?: number,
    MODULES_PATH? : string,
    MODULES? : string[],
    GATEWAY_KEEP_ALIVE_INTERVAL? : number,
    GATEWAY_KEEP_ALIVE_RETRY_INTERVAL? : number,
    GATEWAY_KEEP_ALIVE_MAX_RETRIES? : number,
    GATEWAY_AUTO_ATTACH_PASSKEY? : string
}
export type EngineServersConfig = {
    HOST:string,
    PASSKEY:string,
    LIVE?:boolean
    REPLICA?:boolean,
    NAME?:string
}
export type EngineGatewayConfig = {
    REMOTE_HOST:string,
    LOCAL_HOST:string,
    PASSKEY:string,
    REPLICA?:boolean,
    LIVE?:boolean,
    AUTO_ATTACH_PASSKEY? : string   
}

export type RemoteServerConfig = {
    passkey:string,
    live:boolean,
    replica: boolean,
    serverConnection?:ServerConnection|undefined,
    name?:string
}

export type GatewayConfig = RemoteServerConfig & {
    socket?:Socket
}