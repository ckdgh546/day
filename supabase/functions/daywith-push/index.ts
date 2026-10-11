// DayWith 6.4 - Supabase Edge Function (Deno/WebCrypto)
// This function uses NO OpenAI service or developer key.
// Deploy with JWT verification disabled: security is enforced for each route below.
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { sendPushNotification } from 'npm:@mmmike/web-push@1.0.1/send';

const dbUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const subject = Deno.env.get('VAPID_SUBJECT') || 'https://ckdgh546.github.io';
const cronKey = Deno.env.get('DAYWITH_CRON_TOKEN') || '';
const webOrigin = 'https://ckdgh546.github.io';
const corsHeaders = {
  'Access-Control-Allow-Origin': webOrigin,
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Vary': 'Origin',
};
const db = createClient(dbUrl, serviceKey, { auth: { persistSession:false, autoRefreshToken:false }});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...corsHeaders, 'Content-Type':'application/json', 'Cache-Control':'no-store' }
});

async function currentUser(req: Request) {
  const bearer = req.headers.get('authorization') || '';
  if (!bearer.startsWith('Bearer ')) return null;
  const token = bearer.slice(7);
  const {data,error} = await db.auth.getUser(token);
  return error ? null : (data?.user?.id || null);
}

function validPushHost(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') return false;
    const h = url.hostname.toLowerCase();
    return h === 'fcm.googleapis.com' || h === 'updates.push.services.mozilla.com' ||
      h.endsWith('.push.services.mozilla.com') || h === 'web.push.apple.com' ||
      h.endsWith('.push.apple.com') || h.endsWith('.push.services.mozilla.com');
  } catch {return false;}
}

async function sendToUser(userId: string, payload: {title:string;body:string;destination?:string;tag?:string}) {
  const {data:subs,error} = await db.from('daywith_push_subscriptions')
    .select('id,endpoint,p256dh,auth_key').eq('user_id',userId).limit(20);
  if(error) throw error;
  let successes=0, failures=0;
  for(const s of subs || []) {
    if(!validPushHost(s.endpoint)) {failures++;continue;}
    try {
      const ok = await sendPushNotification(
        {endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth_key}},
        {title:payload.title,body:payload.body,url:payload.destination||'/day/',tag:payload.tag||'daywith-reminder'},
        {publicKey,privateKey,subject},
        {ttl:3600,timeoutMs:10000}
      );
      if(ok) successes++;
      else { // push service responded that subscription is gone (404/410)
        await db.from('daywith_push_subscriptions').delete().eq('id',s.id);
      }
    } catch (err) {
      failures++;
      // Do not log subscription endpoints: they are bearer capabilities.
      console.warn('push delivery rejected:',err instanceof Error?err.name:'Unknown');
    }
  }
  return {successes,failures,total:(subs||[]).length};
}

export default {
  fetch: async (req: Request) => {
    if(req.method==='OPTIONS')return new Response('',{headers:corsHeaders});
    if(req.headers.get('origin') && req.headers.get('origin')!==webOrigin) return json({error:'origin not allowed'},403);
    if(!publicKey||!privateKey||!serviceKey||!dbUrl)return json({error:'푸시 서버 설정이 완료되지 않았어.'},503);
    try {
      const mode = new URL(req.url).searchParams.get('mode') || 'config';
      if(mode==='config'&&req.method==='GET')return json({publicKey,ready:true});
      if(mode==='test'&&req.method==='POST'){
        const userId = await currentUser(req);
        if(!userId)return json({error:'로그인이 필요해.'},401);
        const r = await sendToUser(userId,{title:'DayWith · 진동 알림 테스트', body:'휴대폰이 잠겨 있어도 이 알림을 확인할 수 있는지 시험해봐 🌿',tag:'daywith-test'});
        return json({ok:true,...r});
      }
      if(mode==='run'&&req.method==='POST'){
        if(!cronKey || req.headers.get('x-daywith-cron')!==cronKey)return json({error:'cron secret mismatch'},403);
        const {data:jobs,error} = await db.rpc('daywith_claim_push_jobs',{max_jobs:30});
        if(error)throw error;
        let sent=0,failed=0;
        for (const job of jobs||[]) {
          try {
            const r=await sendToUser(job.user_id,{title:job.title,body:job.body,destination:job.destination,tag:job.job_key});
            // Accepted by push service is not proof that the phone displayed it.
            const outcome=r.successes>0?'sent':r.total===0?'failed':'pending';
            await db.from('daywith_push_jobs').update({status:outcome,sent_at:r.successes>0?new Date().toISOString():null}).eq('id',job.id);
            if(r.successes>0)sent++;else failed++;
          }catch{
            failed++;
            await db.from('daywith_push_jobs').update({status:job.attempts>=3?'failed':'pending'}).eq('id',job.id);
          }
        }
        return json({ok:true,claimed:(jobs||[]).length,sent,failed});
      }
      return json({error:'unknown route'},404);
    } catch(err) {
      console.error('DayWith push function failure:',err instanceof Error?err.message:'unknown');
      return json({error:'푸시 서버 처리 중 문제가 발생했어.'},500);
    }
  }
};
