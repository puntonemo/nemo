
//sudo npm link nemo3

import startEngine, { EngineConfig, EngineGatewayConfig, EngineServersConfig, ioServerOverHttps} from 'nemo3';
import path from 'path';


type ServerConfig = {
    CONFIG_NAME: string,
    HTTPS?:{
        PORT: number,
        KEY_FILE : string,
        CERT_FILE : string,
        CA_FILE: string,
        PASSPHRASE: string,
        CIPHERS: string
    },
    HTTP:{
        PORT:number
    }
    MAX_BODY_SIZE?: string,
    MAX_HTTP_BUFFER_SIZE?: number,
    MODULES_PATH: string,
    MODULES: string[],
    SERVERS: EngineServersConfig[],
    REDIS?:string|boolean,
    GATEWAY?:EngineGatewayConfig
}

var configName = 'default';

if(process.argv.length > 2){
    configName = process.argv[2];
}

const CONFIG = require(`./config/${configName}.json`) as ServerConfig;

const engineConfig:EngineConfig = {
    CONFIG_NAME: CONFIG.CONFIG_NAME,
    HTTP : CONFIG.HTTP,
    MAX_BODY_SIZE: CONFIG.MAX_BODY_SIZE,
    MAX_HTTP_BUFFER_SIZE: CONFIG.MAX_HTTP_BUFFER_SIZE,
    MODULES_PATH : path.join(__dirname, CONFIG.MODULES_PATH),
    MODULES : CONFIG.MODULES
}


if(CONFIG.HTTPS){
    engineConfig.HTTPS = {
        "PORT" : process.env.PORT && Number.isInteger(process.env.PORT) ? Number.parseInt(process.env.PORT) : CONFIG.HTTPS.PORT,
        "KEY_FILE" : path.join(__dirname, CONFIG.HTTPS.KEY_FILE),
        "CERT_FILE" : path.join(__dirname, CONFIG.HTTPS.CERT_FILE),
        "CA_FILE" : path.join(__dirname, CONFIG.HTTPS.CA_FILE),
        "PASSPHRASE" : CONFIG.HTTPS.PASSPHRASE,
        "CIPHERS" : CONFIG.HTTPS.CIPHERS
    }
}


let engineGatewayConfig:EngineGatewayConfig | undefined = undefined;
let engineServersConfig:EngineServersConfig[] | undefined = undefined;

if(CONFIG.GATEWAY){
    engineGatewayConfig = {
        REMOTE_HOST: CONFIG.GATEWAY.REMOTE_HOST,
        LOCAL_HOST: CONFIG.GATEWAY.LOCAL_HOST,
        PASSKEY: CONFIG.GATEWAY.PASSKEY,
        REPLICA: CONFIG.GATEWAY.REPLICA
    }
}

if(CONFIG.SERVERS){
    engineServersConfig = CONFIG.SERVERS
}

const redisConfig = CONFIG.REDIS;

startEngine(engineConfig, engineGatewayConfig, engineServersConfig, redisConfig);