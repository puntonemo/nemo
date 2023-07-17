
import { GenericObject } from "../Types";

export const parseCookie = (str:string): GenericObject =>
  str
    .split(';')
    .map(v => v.split('='))
    .reduce((acc:GenericObject, v) => {
        if(v.length>1){
            acc[decodeURIComponent(v[0].trim())] = decodeURIComponent(v[1].trim());
        }
        return acc;
    }, {});

export const makeid = (length=10) => {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}