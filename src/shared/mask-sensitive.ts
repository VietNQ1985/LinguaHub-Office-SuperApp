export function maskSensitive(text:string){
  return text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[EMAIL]')
    .replace(/(?:\+?\d[\d ()-]{7,}\d)/g,value=>{
      const digits=value.replace(/\D/g,'')
      return digits.length>=9 && digits.length<=15?'[PHONE]':value
    })
}
