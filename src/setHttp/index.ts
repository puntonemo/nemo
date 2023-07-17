import express from 'express';
import bodyParser from 'body-parser';
import fileUpload from 'express-fileupload';
import http from 'http';
import https from 'https';
import path from 'path';
import fs from 'fs';
import { EngineConfig } from '..';
import { Server } from "socket.io";

export const setHttp = (engineConfig:EngineConfig)  => {
    let httpsServer:https.Server|undefined = undefined;
    const expressApp = express();
    expressApp.disable('x-powered-by');
    expressApp.use(bodyParser.json({ limit: engineConfig?.MAX_BODY_SIZE || "2mb" }));
    expressApp.use(bodyParser.urlencoded({ limit: engineConfig.MAX_BODY_SIZE || "2mb", extended: true, parameterLimit: 50000 }))
    expressApp.use(fileUpload({createParentPath: true}));
    expressApp.use(express.json());

    if(engineConfig?.HTTPS){
        const optSsl = { 
            key: fs.readFileSync(engineConfig.HTTPS?.KEY_FILE ?? ""), 
            cert: fs.readFileSync(engineConfig.HTTPS?.CERT_FILE ?? ""),
            ca: fs.readFileSync(engineConfig.HTTPS?.CA_FILE ?? ""),
            passphrase: engineConfig.HTTPS?.PASSPHRASE,
            requestCert: false,
            rejectUnauthorized: false,
            ciphers: engineConfig.HTTPS?.CIPHERS
        }
        httpsServer = https.createServer(optSsl, expressApp);
    }
    //TODO : https://github.com/hunterloftis/stoppable
    const httpServer = http.createServer(expressApp);

    return {expressApp, httpServer, httpsServer};
}

export const setSocket = (httpServer:http.Server|https.Server, engineConfig:EngineConfig) => {
    const io = new Server(httpServer, engineConfig?.MAX_HTTP_BUFFER_SIZE ? {maxHttpBufferSize: engineConfig?.MAX_HTTP_BUFFER_SIZE}:undefined); // 1e8
    return io;
}