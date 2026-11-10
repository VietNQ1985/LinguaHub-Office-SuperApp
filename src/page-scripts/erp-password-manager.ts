const PROPOSAL_KEY = '__linguahub_erp_credential_proposal_v1'

export function buildErpPasswordManagerScript(): string {
  return `(()=>{
  const root=document.documentElement;
  if(location.protocol!=='https:'||root.hasAttribute('data-lh-erp-credential-manager'))return;
  root.setAttribute('data-lh-erp-credential-manager','installed');
  const key='${PROPOSAL_KEY}';
  const visible=input=>!input.disabled&&!input.readOnly&&(input.offsetWidth||input.offsetHeight||input.getClientRects().length);
  const capture=event=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement))return;
    const passwords=Array.from(form.querySelectorAll('input[type="password"]')).filter(visible);
    if(passwords.length!==1)return;
    const password=passwords[0];
    if(password.autocomplete==='new-password'||!password.value||password.value.length>2560)return;
    const users=Array.from(form.querySelectorAll('input[autocomplete="username"],input[type="email"],input[type="text"],input[type="tel"]'))
      .filter(input=>visible(input)&&/user|email|login|account|phone/i.test((input.name||'')+' '+(input.id||'')+' '+input.autocomplete));
    const user=users.length===1?users[0]:form.querySelector('input[autocomplete="username"]');
    try{
      sessionStorage.setItem(key,JSON.stringify({origin:location.origin,createdAt:Date.now(),username:user&&typeof user.value==='string'?user.value.trim().slice(0,1024):'',password:password.value}));
    }catch{}
  };
  document.addEventListener('submit',capture,true);
})()`
}
