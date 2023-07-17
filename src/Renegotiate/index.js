/**
 * THIS PIECE OF CODE IS WRITTEN IN JavaScript BECAUSE TypeScript DOESN'T SUPPORT HTTPS RENEGOTIATION
 */
export const getPeerCertificate = (/** @type {{ connection: { renegotiate: (arg0: { requestCert: boolean; rejectUnauthorized: boolean; }, arg1: (err: any) => Promise<any>) => void; getPeerCertificate: () => any; }; }} */ req) => new Promise((resolve, reject)=>{
    console.log('Trying to renegotiate ...');
    try{
        req.connection.renegotiate({requestCert: true, rejectUnauthorized: false}, async (/** @type {any} */ err) => {
            if(!err){
                const cert = req.connection.getPeerCertificate() 
                resolve(cert);
                
            }else{
                console.log('error on TLS (1) renegotiation', err);
                reject(err);
            }   
        });
    }catch(error){
        console.log('error on TLS (2) renegotiation', error);
        reject(error);
    }
    
});

