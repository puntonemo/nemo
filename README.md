# Initial Setup

## Basic setup
Create a new App and init folder
```bash
mkdir myModule
cd myModule
npm init -y
touch index.ts
```

### Configuration
Import __nemo3__ module, create an EngineConfig object and start the engine:

```typescript
import startEngine from 'nemo3';
import path from 'path';

const config = {
    "CONFIG_NAME" : "myModule",
    "HTTP" : {
        "PORT" : 3000
    },
    "HTTPS" : {
        "PORT" : 4443,
        "KEY_FILE" : path.join(__dirname, "./ssl/keyfile.key"),
        "CERT_FILE" :path.join(__dirname, "./ssl/certfile.crt"),
        "CA_FILE" : path.join(__dirname, "./ssl/cafile.csr"),
        "PASSPHRASE" : "***certpassphrase***",
        "CIPHERS" : "ECDH+AESGCM:DH+AESGCM:ECDH+AES256:DH+AES256:ECDH+AES128:DH+AES:ECDH+3DES:DH+3DES:RSA+AESGCM:RSA+AES:RSA+3DES:!aNULL:!MD5:!DSS"
    },
    "MAX_BODY_SIZE" : "50mb",
    "MODULES_PATH" : path.join(__dirname, "./modules"),
    "MODULES":["myModule"]
}

startEngine(config);

```
For this sample, we are setting up a new module named __test__ on the app folder __/modules__, so we need to create the a new file in the path __/modules/myModule/index.ts__

### Create a new module
#### Importing core, config and exporting init function

Create a new folder under the “app” folder

/modules/test/index.ts
```typescript
import { Service, ClientRequest, GenericObject, responseError } from "nemo3";

export const init = () => {
    console.log('My Module Init');
}
```

#### Create a Service

create a new function with the Nemo3 pattern:
```typescript
const myService = (request:ClientRequest):Promise<GenericObject> => new Promise(async (resolve, reject)=>{
    //... your code goes here
    if(true){
        resolve({result:'ok'});
    }else{
        reject(responseError(404));
    }
});
```
#### Export the Service
```typescript
export const Services:Service[] = [
    {
        name: "myService",
        get : "/api/myService",
        manager:myService,
        serviceType:'json'
    }
]
```
Run the app
```bash
npm start
```
Open a new browser an go to:
http://localhost:3000/api/myService
