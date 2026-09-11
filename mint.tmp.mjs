import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const EMAIL = process.argv[2];
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter(l => l.includes("=") && !l.trimStart().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]; }));
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const REF = new URL(URL_).hostname.split(".")[0];
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
if (error) throw error;
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: v, error: e2 } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
if (e2) throw e2;
const payload = `base64-${Buffer.from(JSON.stringify(v.session)).toString("base64")}`;
const chunks = []; for (let i=0;i<payload.length;i+=3180) chunks.push(payload.slice(i,i+3180));
// Emit JS that sets the cookies from inside the page.
console.log(chunks.map((c,i) => `document.cookie=${JSON.stringify(`sb-${REF}-auth-token.${i}=${c}; path=/; SameSite=Lax`)};`).join("\n"));
