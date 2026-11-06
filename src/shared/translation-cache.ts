export class TranslationCache<T=string> {
  private entries=new Map<string,{value:T;expires:number}>()
  constructor(private capacity=50,private ttlMs=600000){}
  get(model:string,text:string,now=Date.now(),scope=''):T|undefined{
    const key=JSON.stringify([model,scope,text]),entry=this.entries.get(key)
    if(!entry)return undefined
    if(entry.expires<=now){this.entries.delete(key);return undefined}
    this.entries.delete(key);this.entries.set(key,entry)
    return entry.value
  }
  set(model:string,text:string,value:T,now=Date.now(),scope=''){
    const key=JSON.stringify([model,scope,text])
    this.entries.delete(key);this.entries.set(key,{value,expires:now+this.ttlMs})
    while(this.entries.size>this.capacity){const oldest=this.entries.keys().next().value;if(oldest===undefined)break;this.entries.delete(oldest)}
  }
  clear(){this.entries.clear()}
}
