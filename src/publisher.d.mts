export interface PublisherEnv {USAGE_ENDPOINT?:string;USAGE_TOKEN?:string}
export function health(request:Request,path:string,app:string,revision:string):Response|null;
export function publish(env:PublisherEnv,context:{waitUntil(promise:Promise<unknown>):void}|undefined,request:Request,event:string,send?:typeof fetch):void;
export function pageEvent(request:Request,response:Response,base?:string):string|null;
