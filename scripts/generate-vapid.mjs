import fs from 'node:fs';
import webpush from 'web-push';
const path='.vapid.env';
if(fs.existsSync(path)){console.log(`${path} already exists; leaving it unchanged.`);process.exit(0)}
const keys=webpush.generateVAPIDKeys();
const output=['# LOCAL ONLY — DO NOT COMMIT','# Copy these values into Vercel Environment Variables.','# Replace VAPID_SUBJECT with a contact URI you control.',`VAPID_PUBLIC_KEY=${keys.publicKey}`,`VAPID_PRIVATE_KEY=${keys.privateKey}`,'VAPID_SUBJECT=mailto:admin@example.com',''].join('\n');
fs.writeFileSync(path,output,{mode:0o600});
console.log('Created .vapid.env locally. The private key was not printed.');
