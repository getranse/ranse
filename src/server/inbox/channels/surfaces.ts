// Hosted form + embeddable widget rendering. The form is a server-rendered
// HTML page; the widget is a single JS file the customer's site loads via
// <script async src="/widget/<key>.js">. Both are intentionally dependency-
// free so they can be served from a Worker with no build step.

export function formHtml(name: string, welcome: string | null, requireEmail: boolean): string {
  const emailRequired = requireEmail ? ' required' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(name)}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#f8fafc;color:#111827}
main{max-width:640px;margin:40px auto;padding:0 20px}
form{display:grid;gap:12px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px}
label{display:grid;gap:4px;font-size:13px;color:#4b5563}
input,textarea{font:inherit;border:1px solid #d1d5db;border-radius:6px;padding:10px}
textarea{min-height:140px;resize:vertical}
button{border:0;border-radius:6px;background:#111827;color:#fff;padding:10px 14px;font:inherit;cursor:pointer}
.hp{position:absolute;left:-10000px}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(name)}</h1>
${welcome ? `<p>${escapeHtml(welcome)}</p>` : ''}
<form method="post">
<label>Name<input name="name" autocomplete="name"></label>
<label>Email<input${emailRequired} name="email" type="email" autocomplete="email"></label>
<label>Subject<input name="subject"></label>
<label>Message<textarea required name="message"></textarea></label>
<label class="hp">Company<input name="company" tabindex="-1" autocomplete="off"></label>
<button type="submit">Send</button>
</form>
</main>
</body>
</html>`;
}

export function formResultHtml(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Support request</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:40px;color:#111827}</style></head><body><p>${escapeHtml(message)}</p></body></html>`;
}

export function widgetScript(key: string): string {
  const safeKey = JSON.stringify(key);
  return `(function(){
var key=${safeKey};
var base=(document.currentScript&&new URL(document.currentScript.src).origin)||location.origin;
var storeKey='ranse_public_session_'+key;
var visitorKey=storeKey+'_visitor';
var state={open:false,config:null,session:null,messages:[]};
function el(tag,attrs){var n=document.createElement(tag);if(attrs){Object.keys(attrs).forEach(function(k){if(k==='text')n.textContent=attrs[k];else n.setAttribute(k,attrs[k]);});}return n;}
function request(path,opts){opts=opts||{};opts.headers=Object.assign({'content-type':'application/json'},opts.headers||{});return fetch(base+path,opts).then(function(r){if(!r.ok)return r.json().catch(function(){return{};}).then(function(e){throw new Error(e.message||'Request failed');});return r.json();});}
function save(){try{localStorage.setItem(storeKey,JSON.stringify(state.session));}catch(e){}}
function clearSaved(){state.session=null;try{localStorage.removeItem(storeKey);}catch(e){}}
function loadSaved(){try{state.session=JSON.parse(localStorage.getItem(storeKey)||'null');}catch(e){}}
function visitorId(){try{var id=localStorage.getItem(visitorKey);if(!id){id='vis_'+Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem(visitorKey,id);}return id;}catch(e){return undefined;}}
var root=el('div');root.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111827';
var button=el('button',{text:'Support'});button.style.cssText='border:0;border-radius:999px;background:#111827;color:white;padding:12px 16px;box-shadow:0 8px 24px rgba(0,0,0,.18);cursor:pointer';
var panel=el('div');panel.style.cssText='display:none;width:340px;max-width:calc(100vw - 36px);height:460px;max-height:calc(100vh - 96px);background:white;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 20px 48px rgba(0,0,0,.22);overflow:hidden';
root.appendChild(panel);root.appendChild(button);function mount(){if(!root.parentNode&&document.body)document.body.appendChild(root);}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
function render(){
panel.innerHTML='';
var head=el('div',{text:(state.config&&state.config.name)||'Support'});head.style.cssText='padding:12px 14px;background:#111827;color:white;font-weight:600';
var msgs=el('div');msgs.style.cssText='height:270px;overflow:auto;padding:12px;display:grid;gap:8px;background:#f8fafc';
state.messages.forEach(function(m){var bubble=el('div',{text:m.body||m.preview||''});bubble.style.cssText='padding:8px 10px;border-radius:8px;max-width:86%;font-size:14px;white-space:pre-wrap;'+(m.direction==='inbound'?'justify-self:end;background:#111827;color:white':'justify-self:start;background:white;border:1px solid #e5e7eb');msgs.appendChild(bubble);});
var form=el('form');form.style.cssText='display:grid;gap:8px;padding:12px;background:white';
if(!state.session){var name=el('input');name.name='name';name.placeholder='Name';name.style.cssText=inputCss();var email=el('input');email.name='email';email.type='email';email.placeholder='Email';email.required=!!(state.config&&state.config.require_email);email.style.cssText=inputCss();var subject=el('input');subject.name='subject';subject.placeholder='Subject';subject.style.cssText=inputCss();form.appendChild(name);form.appendChild(email);form.appendChild(subject);}
var textarea=el('textarea');textarea.name='message';textarea.placeholder='How can we help?';textarea.required=true;textarea.style.cssText=inputCss()+'height:64px;resize:none';var send=el('button',{text:'Send'});send.style.cssText='border:0;border-radius:6px;background:#111827;color:white;padding:9px 12px;cursor:pointer';form.appendChild(textarea);form.appendChild(send);
form.onsubmit=function(ev){ev.preventDefault();var fd=new FormData(form);var message=String(fd.get('message')||'').trim();if(!message)return;send.disabled=true;if(!state.session){request('/public/channels/'+key+'/sessions',{method:'POST',body:JSON.stringify({name:fd.get('name')||undefined,email:fd.get('email')||undefined,subject:fd.get('subject')||undefined,message:message,visitor_id:visitorId()})}).then(function(res){if(!res.session_id||!res.session_token)return;state.session={id:res.session_id,token:res.session_token};save();return loadMessages();}).then(render).catch(alert).finally(function(){send.disabled=false;});}else{request('/public/sessions/'+state.session.id+'/messages',{method:'POST',headers:{authorization:'Bearer '+state.session.token},body:JSON.stringify({message:message})}).then(loadMessages).then(render).catch(alert).finally(function(){send.disabled=false;});}};
panel.appendChild(head);panel.appendChild(msgs);panel.appendChild(form);msgs.scrollTop=msgs.scrollHeight;
}
function inputCss(){return 'font:inherit;border:1px solid #d1d5db;border-radius:6px;padding:8px;box-sizing:border-box;width:100%';}
function loadMessages(){if(!state.session)return Promise.resolve();return request('/public/sessions/'+state.session.id,{headers:{authorization:'Bearer '+state.session.token}}).then(function(res){state.messages=res.messages||[];});}
function poll(){if(state.open&&state.session)loadMessages().then(render).catch(function(){clearSaved();render();});setTimeout(poll,6000);}
button.onclick=function(){state.open=!state.open;panel.style.display=state.open?'block':'none';button.textContent=state.open?'Close':'Support';if(state.open)loadMessages().catch(function(){clearSaved();}).then(render);};
loadSaved();
request('/public/channels/'+key+'/config').then(function(res){state.config=res.channel;render();poll();}).catch(function(){root.style.display='none';});
})();`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}
