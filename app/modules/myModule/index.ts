
import { Service, ClientRequest, GenericObject, responseError } from "nemo3";

/**
 * MODULE INIT FUNCTION
 */
export const init = () => {
    console.log('My Module Init');
}

/**
 * SERVICE HANDLER
 * @param request 
 * @returns 
 */
const myService = (request:ClientRequest):Promise<GenericObject> => new Promise(async (resolve, reject)=>{
	//... your code 
	if(true){      
        await request.session.setValue('foo', 'bar');
        //await asyncFunc();
        resolve({result:'ok'});
    }else{
        reject(responseError(404));
    }
});


/**
 * EXPORT THE SERVICE
 */
export const Services:Service[] = [
    {
        name: "myService",
        get : "/api/myService",
        manager:myService,
        serviceType:'json'
    }
]