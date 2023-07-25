import { IncomingHttpHeaders, IncomingMessage } from 'http';
import { GenericObject, ManagerType } from '../Types';
import { Socket } from 'socket.io';
import { parseCookie } from '../tools';
import { Request, Response } from 'express'
import ServerConnection from '../ServerConnection'
import * as ExpressCore from 'express-serve-static-core';
import * as Core from '..';


export default class ClientRequest {
    private _req:Request | IncomingMessage;
    private _lang:string[];
    private _headers:IncomingHttpHeaders;
    private _originalUrl: string;
    private _baseUrl: string;
    private _cookies: GenericObject | undefined;
    private _remoteAddress :string | string[] | undefined;
    private _origin : "ws" | "http" | "remote";
    private _socket: Socket | undefined;
    private _res: Response | undefined;
    private _tid: string | undefined;
    private _remoteRequest: GenericObject | undefined;
    private _remoteSetCookie: GenericObject[] | undefined;
    private _remoteRedirect: {url:string, status?:number} | undefined;
    private _session:Core.Session;
    private _remoteSession: GenericObject;
    public certificate?: GenericObject;
    constructor(
        invokator: Request | Socket,
        session: Core.Session | string | undefined,
        public serviceName: string | undefined,
        public type: ManagerType,
        public params: GenericObject,
        responseReference ?: Response | string,
        public remoteRequest?: GenericObject,
    ){
        this._remoteRequest = remoteRequest;
        if(typeof session == "string"){
            this._session = new Core.Session(session);
        }else{
            if(!session){
                this._session = new Core.Session("");
            }else{
                this._session = session
            }
        }
        this._remoteSession = remoteRequest ? remoteRequest.session : session;
        if(invokator instanceof Socket){
            this._origin = remoteRequest ? "remote" : "ws";
            this._socket = invokator;
            if(typeof responseReference === 'string') this._tid = responseReference;
            this._req = invokator.request;
            this._lang = remoteRequest ? remoteRequest.lang : invokator.request.headers['accept-language'] ? invokator.request.headers['accept-language']?.split(',').map(item=>item.trim()) : [];
            this._headers = remoteRequest ? remoteRequest.headers : invokator.request.headers;
            this._originalUrl = remoteRequest ? remoteRequest.originalUrl : `${invokator.request.headers.origin ?? invokator.request.headers.host}${invokator.request.url}`;
            this._baseUrl = remoteRequest ? remoteRequest.baseUrl : invokator.request.headers.origin ?? ""
            this._cookies = remoteRequest ? remoteRequest.cookies : invokator.handshake.headers.cookie ? parseCookie(invokator.handshake.headers.cookie) : undefined;
            this._remoteAddress = remoteRequest ? remoteRequest.remoteAddress : invokator.handshake.headers['x-forwarded-for'] || invokator.handshake.address;
            this.certificate = remoteRequest ? remoteRequest.certificate : this.certificate;
        }else{
            this._origin = remoteRequest ? "remote" : "http";
            this._req = invokator;
            if(typeof responseReference === 'object') this._res = responseReference;
            this._lang = remoteRequest ? remoteRequest.lang : invokator.acceptsLanguages();
            this._headers = remoteRequest ? remoteRequest.headers : invokator.headers;
            this._originalUrl = remoteRequest ? remoteRequest.originalUrl : `${invokator.protocol}://${invokator.headers.host}${invokator.originalUrl}`;
            this._baseUrl = remoteRequest ? remoteRequest.baseUrl : invokator.baseUrl;
            this._cookies = remoteRequest ? remoteRequest.cookies : invokator.headers?.cookie ? parseCookie(invokator.headers.cookie) : undefined;
            this._remoteAddress = remoteRequest ? remoteRequest.remoteAddress : invokator.headers['x-forwarded-for'] || invokator.socket.remoteAddress;
            this.certificate = remoteRequest ? remoteRequest.certificate : this.certificate;
        }
    }
    setCookie (cookieName:string, cookieValue:any, cookieMaxAge?:number) {
        if(this._origin == 'http' && this._res){
            const res = this._res;
            if(!res.headersSent){
                var cookieOptions:ExpressCore.CookieOptions = { sameSite:'strict' }
                if((this._req as Request).protocol == 'https') cookieOptions.secure = true;
                if(cookieMaxAge) cookieOptions.maxAge = cookieMaxAge;
                res.cookie(cookieName, cookieValue, cookieOptions);
            }
        }
        if(this._origin == 'ws' && this._socket){
            this._socket.emit('cookie', cookieName, cookieValue, cookieMaxAge);
        }
        if(this._origin == 'remote' && this._remoteRequest){
            if(!this._remoteSetCookie) this._remoteSetCookie = [];
            this._remoteSetCookie.push({cookieName, cookieValue, cookieMaxAge});
        }
    }
    willResolve (data:GenericObject) {
        if(this._origin == 'ws' && this._socket){
            this._socket.emit('will', this._tid, data);
        }
        if(this._origin == "remote" && this._remoteRequest?.socketId){
            this.emitToGateways('clientWill', this._remoteRequest?.socketId, 'will', this._remoteRequest?.tid, data);
        }
    }
    redirect (url:string, status?:number) {
        if(this._origin == 'http' && this._res){
            this._res.redirect(status ?? 302, url);
        }
        if(this._origin == 'ws' && this._socket){
            this._socket.emit('redirect', this._tid, url, status ?? 302);
        }
        if(this._origin == 'remote' && this._remoteRequest){
            this._remoteRedirect = {url, status};
        }
    }
    emit(ev:string, ...args:unknown[]){
        if(this._origin == "ws"){
            if(this._socket){
                this._socket.emit(ev, ...args);
            }else{
                
            }
        }
        if(this._origin == "remote" && this._remoteRequest?.socketId){
            console.log('Emiiting a message to remote socket id', this._remoteRequest?.socketId )
            this.emitToGateways('clientMsg', this._remoteRequest?.socketId, ev, ...args);
        }
    }
    invokeService (serviceName:string, params:GenericObject = {}) {
        return Core.invokeService(serviceName, this, params);
    }
    toGenericObject ():Promise<GenericObject> {
        return new Promise(resolve=>{
            let result:GenericObject = {};
            if(this._session){
                const sessionObject = this._session.toGenericObject().then(sessionObject=>{
                    result.session = sessionObject;
                    if (this._origin) result.origin = this._origin;
                    if (this.type) result.type = this.type;
                    if (this._lang) result.lang = this._lang;
                    if (this._cookies) result.cookies = this._cookies;
                    if (this._headers) result.headers = this._headers;
                    if (this._originalUrl) result.originalUrl = this._originalUrl;
                    if (this._baseUrl) result.baseUrl = this._baseUrl;
                    if (this.params) result.params = this.params;
                    if (this.certificate) result.certificate = this.certificate;
                    if (this._remoteAddress) result.remoteAddress = this._remoteAddress;
                    if (this._socket) result.socketId = this._socket.id;
                    if (this._tid) result.tid = this._tid;
                    resolve(result);
                })
            }else{
                if (this._origin) result.origin = this._origin;
                if (this.type) result.type = this.type;
                if (this._lang) result.lang = this._lang;
                if (this._cookies) result.cookies = this._cookies;
                if (this._headers) result.headers = this._headers;
                if (this._originalUrl) result.originalUrl = this._originalUrl;
                if (this._baseUrl) result.baseUrl = this._baseUrl;
                if (this.params) result.params = this.params;
                if (this.certificate) result.certificate = this.certificate;
                if (this._remoteAddress) result.remoteAddress = this._remoteAddress;
                if (this._socket) result.socket = this._socket.id;
                resolve(result);
            }
        })
    }
    private emitToGateways(sev:string, socketId:string, ev:string, ...args:unknown[]){
        ServerConnection.gatewayServer.forEach(gatewayServer=>{
            gatewayServer.emit(sev, socketId, ev, ...args)
        })
    }
    get session() {
        return this._session;
    }
    get req() { return this._req; }
    get res() { return this._res; }
    get lang() { return this._lang; }
    get headers() { return this._headers; }
    get originalUrl() { return this._originalUrl; }
    get baseUrl() { return this._baseUrl; }
    get cookies() { return this._cookies; }
    get remoteAddress() { return this._remoteAddress; }
    get origin() { return this._origin; }
    get socket() { return this._socket; }
    get remoteSetCookie() {return this._remoteSetCookie}
    get remoteRedirect() {return this._remoteRedirect}
    get fetch() { return Core.fetch}
}