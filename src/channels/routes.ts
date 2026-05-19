import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  appendPublicSessionMessage,
  createPublicSession,
  publicChannelConfig,
  publicSessionMessages,
} from './index';
import type { Env } from '../env';
import { apiError } from '../lib/errors';

type PublicCtx = Context<{ Bindings: Env }>;

export const publicChannelsApp = new Hono<{ Bindings: Env }>();
export const publicSurfaceApp = new Hono<{ Bindings: Env }>();

const startSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().max(120).optional(),
  subject: z.string().max(180).optional(),
  message: z.string().min(1).max(5000),
  visitor_id: z.string().max(160).nullable().optional(),
  company: z.string().max(200).optional(),
});

const messageSchema = z.object({
  message: z.string().min(1).max(5000),
  company: z.string().max(200).optional(),
});

publicChannelsApp.options('*', (c) => withCors(c, c.body(null, 204)));

publicChannelsApp.get('/channels/:key/config', async (c) => {
  const result = await publicChannelConfig(c.env, c.req.param('key'), c.req.header('origin'));
  if (!result) return withCors(c, apiError(c, 'not_found', 'Channel not found.'));
  return withCors(c, c.json({ channel: result.config }));
});

publicChannelsApp.post('/channels/:key/sessions', async (c) => {
  const rateLimited = await checkRateLimit(c, `public:start:${c.req.param('key')}`);
  if (rateLimited) return withCors(c, rateLimited);
  const body = startSchema.parse(await c.req.json().catch(() => ({})));
  if (body.company?.trim()) return withCors(c, c.json({ ok: true }));
  try {
    const result = await createPublicSession(
      c.env,
      c.req.param('key'),
      {
        email: body.email,
        name: body.name,
        subject: body.subject,
        message: body.message,
        visitorId: body.visitor_id,
      },
      { origin: c.req.header('origin'), userAgent: c.req.header('user-agent') },
    );
    return withCors(
      c,
      c.json({
        session_id: result.sessionId,
        session_token: result.sessionToken,
        ticket_id: result.ticketId,
        message_id: result.messageId,
      }),
    );
  } catch (err) {
    return withCors(c, publicError(c, err));
  }
});

publicChannelsApp.get('/sessions/:id', async (c) => {
  const token = bearerToken(c.req.header('authorization')) ?? c.req.query('token') ?? '';
  try {
    const result = await publicSessionMessages(c.env, c.req.param('id'), token, {
      origin: c.req.header('origin'),
    });
    if (!result) return withCors(c, apiError(c, 'unauthorized', 'Invalid session token.'));
    return withCors(
      c,
      c.json({
        session: {
          id: result.session.id,
          ticket_id: result.session.ticket_id,
          requester_email: result.session.requester_email,
        },
        messages: result.messages,
      }),
    );
  } catch (err) {
    return withCors(c, publicError(c, err));
  }
});

publicChannelsApp.post('/sessions/:id/messages', async (c) => {
  const token = bearerToken(c.req.header('authorization')) ?? '';
  const rateLimited = await checkRateLimit(c, `public:message:${c.req.param('id')}`);
  if (rateLimited) return withCors(c, rateLimited);
  const body = messageSchema.parse(await c.req.json().catch(() => ({})));
  if (body.company?.trim()) return withCors(c, c.json({ ok: true }));
  try {
    const result = await appendPublicSessionMessage(
      c.env,
      c.req.param('id'),
      token,
      { message: body.message },
      { origin: c.req.header('origin') },
    );
    return withCors(c, c.json({ ok: true, ...result }));
  } catch (err) {
    return withCors(c, publicError(c, err));
  }
});

publicSurfaceApp.get('/forms/:key', async (c) => {
  const result = await publicChannelConfig(c.env, c.req.param('key'), null);
  if (!result || result.channel.kind !== 'form') return c.text('Form not found', 404);
  return c.html(
    formHtml(result.config.name, result.config.welcome_message, result.config.require_email),
  );
});

publicSurfaceApp.post('/forms/:key', async (c) => {
  const rateLimited = await checkFormRateLimit(c, `public:form:${c.req.param('key')}`);
  if (rateLimited) return rateLimited;
  const config = await publicChannelConfig(c.env, c.req.param('key'), null);
  if (!config || config.channel.kind !== 'form') return c.text('Form not found', 404);
  const parsed = await c.req.parseBody();
  const message = stringField(parsed.message);
  const email = stringField(parsed.email);
  const name = stringField(parsed.name);
  const subject = stringField(parsed.subject);
  const company = stringField(parsed.company);
  if (company) return c.html(formResultHtml('Thanks. Your request has been received.'));
  if (!message) return c.html(formResultHtml('Message is required.'), 400);
  try {
    await createPublicSession(
      c.env,
      c.req.param('key'),
      { email, name, subject, message, visitorId: null },
      { origin: null, userAgent: c.req.header('user-agent') },
    );
    return c.html(formResultHtml('Thanks. Your request has been received.'));
  } catch (err) {
    const message =
      err instanceof Error && err.message === 'email_required'
        ? 'Enter a valid email address.'
        : 'We could not submit the form.';
    return c.html(formResultHtml(message), 400);
  }
});

publicSurfaceApp.get('/widget/:asset', async (c) => {
  const asset = c.req.param('asset') ?? '';
  if (!asset.endsWith('.js')) return c.text('Widget not found', 404);
  const key = asset.slice(0, -3);
  return c.text(widgetScript(key), 200, {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': 'public, max-age=300',
  });
});

function withCors(c: PublicCtx, response: Response): Response {
  const origin = c.req.header('origin') ?? '*';
  response.headers.set('access-control-allow-origin', origin);
  response.headers.set('vary', 'origin');
  response.headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  response.headers.set('access-control-allow-headers', 'content-type,authorization');
  response.headers.set('access-control-max-age', '600');
  return response;
}

async function checkRateLimit(c: PublicCtx, key: string): Promise<Response | null> {
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
  const result = await c.env.RATE_LIMIT_INGEST?.limit({ key: `${key}:${ip}` }).catch(() => ({
    success: true,
  }));
  return result && !result.success ? apiError(c, 'rate_limited', 'Slow down.', 429) : null;
}

async function checkFormRateLimit(c: PublicCtx, key: string): Promise<Response | null> {
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
  const result = await c.env.RATE_LIMIT_INGEST?.limit({ key: `${key}:${ip}` }).catch(() => ({
    success: true,
  }));
  return result && !result.success
    ? c.html(formResultHtml('Please wait before submitting another request.'), 429)
    : null;
}

function publicError(c: PublicCtx, err: unknown): Response {
  if (err instanceof Error) {
    if (err.message === 'origin_not_allowed') {
      return apiError(c, 'forbidden', 'Origin not allowed.', 403);
    }
    if (err.message === 'email_required') {
      return apiError(c, 'validation_error', 'A valid email address is required.', 400);
    }
    if (err.message === 'message_required') {
      return apiError(c, 'validation_error', 'Message is required.', 400);
    }
    if (err.message === 'session_not_found') {
      return apiError(c, 'unauthorized', 'Invalid session token.', 401);
    }
    if (err.message === 'channel_not_found') {
      return apiError(c, 'not_found', 'Channel not found.', 404);
    }
  }
  throw err;
}

function bearerToken(value?: string | null): string | null {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function formHtml(name: string, welcome: string | null, requireEmail: boolean): string {
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

function formResultHtml(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Support request</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:40px;color:#111827}</style></head><body><p>${escapeHtml(message)}</p></body></html>`;
}

function widgetScript(key: string): string {
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
