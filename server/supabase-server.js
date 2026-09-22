'use strict';
const {createClient}=require('@supabase/supabase-js');
function serverConfig(){const url=process.env.SUPABASE_URL;const serviceKey=process.env.SUPABASE_SERVICE_KEY;if(!url||!serviceKey){const e=new Error('Server database configuration unavailable');e.status=503;throw e}return{url,serviceKey}}
function createAuthClient(){const{url,serviceKey}=serverConfig();return createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
function createAdminClient(){const{url,serviceKey}=serverConfig();return createClient(url,serviceKey,{global:{headers:{Authorization:`Bearer ${serviceKey}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
function bearerToken(req){const h=String(req.headers.authorization||'');if(!h.startsWith('Bearer ')){const e=new Error('Authentication required');e.status=401;throw e}const token=h.slice(7).trim();if(!token){const e=new Error('Authentication required');e.status=401;throw e}return token}
async function requireUser(req){const token=bearerToken(req);const client=createAuthClient();const{data,error}=await client.auth.getUser(token);const user=data&&data.user;if(error||!user||!user.id){const e=new Error('Invalid session');e.status=401;throw e}return user}
async function requireAdmin(req){const user=await requireUser(req);const adminClient=createAdminClient();const{data,error}=await adminClient.from('profiles').select('id,role').eq('id',user.id).single();if(error||!data||data.role!=='admin'){const e=new Error('Admin access required');e.status=403;throw e}return{user,adminClient}}
function isSameOrigin(req){const origin=String(req.headers.origin||'');const host=String(req.headers.host||'');if(!origin||!host)return false;try{const parsed=new URL(origin);return parsed.protocol==='https:'&&parsed.host===host}catch(_){return false}}
function requireSameOrigin(req){if(!isSameOrigin(req)){const e=new Error('Origin rejected');e.status=403;throw e}}
function securityHeaders(res){res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('X-Content-Type-Options','nosniff')}
function sendError(res,error,fallback='Request failed'){const status=Number(error&&error.status)||500;const message=status>=500?fallback:String(error&&error.message||fallback);if(status>=500)console.error('[server]',error);return res.status(status).json({error:message})}
module.exports={createAdminClient,requireUser,requireAdmin,requireSameOrigin,securityHeaders,sendError};
