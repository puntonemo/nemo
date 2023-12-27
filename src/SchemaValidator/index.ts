import { GenericObject } from "../Types";

export type SchemaValidatorError = 
    GenericObject[]
export interface ISchemaValidator {
    validate(object:any,...params:any):Promise<any>
}

class SchemaValidator {
    private static _adapter:ISchemaValidator;
    static setAdapter(adapter:ISchemaValidator){
        SchemaValidator._adapter = adapter;
    }
    static async validate(object:any,...params:any){
        return SchemaValidator._adapter.validate(object, ...params)
    }
}

export const EmptySchemaValidator:ISchemaValidator = {
    async validate(object:any){
        if(object){
            return object;
        }else{
            return [{issue:`Object is undefined`}];
        }
    }
}

export default SchemaValidator;