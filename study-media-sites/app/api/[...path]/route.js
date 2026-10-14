import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {handle} from '../../../lib/social-api.mjs';
export const dynamic='force-dynamic';
const run=req=>handle(req,{env,getChatGPTUser});
export const GET=run;export const POST=run;
