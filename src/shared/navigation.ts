export function isWorkspaceUrl(service:'whatsapp'|'teams'|'zoom'|'meet'|'zalo'|'outlook'|'telegram',value:string){
  try{
    const url=new URL(value)
    if(url.protocol!=='https:' || url.username || url.password)return false
    // zoom.us redirects to zoom.com, so both must be allowed.
    // Zoom sign-in redirects through Google's accounts host when the account uses Google.
    // Google sign-in also hops through accounts.google.<country> and accounts.youtube.com to store the session.
    const googleSignIn=url.hostname==='accounts.youtube.com'||/^accounts\.google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(url.hostname)
    if(service==='zoom')return /(^|\.)zoom\.(us|com)$/.test(url.hostname)||googleSignIn
    // Meet needs Google sign-in (accounts.google.com) as well as meet.google.com.
    if(service==='meet')return url.hostname==='meet.google.com'||googleSignIn
    // jr is the HTTPS authentication handoff observed after mobile approval.
    if(service==='zalo')return !url.port&&['chat.zalo.me','id.zalo.me','jr.zaloapp.com','jr.chat.zalo.me'].includes(url.hostname)
    // Telegram Web (K and A clients); sign-in happens on the same host.
    if(service==='telegram')return url.hostname==='web.telegram.org'&&!url.port
    // Outlook on the web (work and personal) plus Microsoft sign-in.
    if(service==='outlook')return /(^|\.)(outlook\.com|office\.com|office365\.com|office\.net|microsoft\.com|microsoftonline\.com|live\.com|cloud\.microsoft)$/.test(url.hostname)
    return (service==='whatsapp'?/(^|\.)whatsapp\.com$/:/(^|\.)(microsoft\.com|microsoftonline\.com|live\.com|cloud\.microsoft)$/).test(url.hostname)
  }catch{return false}
}

export function isSafeExternalWebUrl(value:string){
  try{
    const url=new URL(value)
    if(url.protocol!=='https:'||url.username||url.password)return false
    const host=url.hostname.toLowerCase().replace(/\.$/,'')
    if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.includes(':'))return false
    const parts=host.split('.').map(Number)
    const isIpv4=parts.length===4&&parts.every(part=>Number.isInteger(part)&&part>=0&&part<=255)
    if(isIpv4){
      const [first,second]=parts
      if(first===0||first===10||first===127||first>=224||first===169&&second===254||first===172&&second>=16&&second<=31||first===192&&second===168)return false
    }
    return true
  }catch{return false}
}

export function isZaloStorageRequest(permission:string,top:string,origin:string,owned:boolean){
 const storageOrigin=(value:string)=>{try{const url=new URL(value);return isWorkspaceUrl('zalo',value)&&['chat.zalo.me','id.zalo.me'].includes(url.hostname)}catch{return false}}
 return owned&&(permission==='storage-access'||permission==='top-level-storage-access')&&storageOrigin(top)&&storageOrigin(origin)
}
