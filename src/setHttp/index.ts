import express from 'express';
import bodyParser from 'body-parser';
import fileUpload from 'express-fileupload';
import cors from "cors";
import http from 'http';
import https from 'https';
import fs from 'fs';
import { EngineConfig } from '..';
import { Server } from "socket.io";

export const setHttp = (config:EngineConfig)  => {
    let httpsServer:https.Server|undefined = undefined;
    const expressApp = express();
    expressApp.disable('x-powered-by');
    expressApp.use(bodyParser.json({ limit: config?.MAX_BODY_SIZE || "2mb" }));
    expressApp.use(bodyParser.urlencoded({ limit: config.MAX_BODY_SIZE || "2mb", extended: true, parameterLimit: 50000 }))
    expressApp.use(fileUpload({createParentPath: true}));
    expressApp.use(express.json());
    expressApp.use(cors());
    if(config?.HTTPS_PORT){
        const optSsl = { 
            key: config.HTTPS_KEY_FILE ? fs.readFileSync(config.HTTPS_KEY_FILE) : undefined,
            cert: config.HTTPS_CERT_FILE ? fs.readFileSync(config.HTTPS_CERT_FILE) : undefined,
            ca: config.HTTPS_CA_FILE ? fs.readFileSync(config.HTTPS_CA_FILE) : undefined,
            passphrase: config.HTTPS_PASSPHRASE,
            requestCert: false,
            rejectUnauthorized: false,
            secureProtocol: config.HTTPS_SECURE_PROTOCOL,
            ciphers: config.HTTPS_CIPHERS
        }
        httpsServer = https.createServer(optSsl, expressApp);
    }
    //TODO : https://github.com/hunterloftis/stoppable
    const httpServer = http.createServer(expressApp);

    return {expressApp, httpServer, httpsServer};
}

export const setSocket = (httpServer:http.Server|https.Server, config:EngineConfig) => {
    const io = new Server(httpServer, config?.MAX_HTTP_BUFFER_SIZE ? {maxHttpBufferSize: config?.MAX_HTTP_BUFFER_SIZE}:undefined); // 1e8
    return io;
}