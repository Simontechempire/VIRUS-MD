require('dotenv').config()
const express=require('express')
const {default:makeWASocket,useMultiFileAuthState,DisconnectReason,Browsers,makeCacheableSignalKeyStore,downloadMediaMessage}=require('@whiskeysockets/baileys')
const pino=require('pino'),fs=require('fs'),path=require('path'),axios=require('axios')
const config=require('./config')
const {runtime,norm}=require('./lib/func')
const {getSession,listSessions,delSession}=require('./session')

const app=express()
app.use(express.static('public'))
app.use(express.json())
const PORT=process.env.PORT||3000

let SETTINGS={mode:'public',sudo:[],antilink:{},antispam:{},antibad:{},antitag:{},antibot:{},antifake:{},antidelete:{},warns:{},filters:{},welcome:{},goodbye:{},autoread:false,autotype:false,autoonline:false,autorec:false,autoreact:false,autostatus:false,autolike:false,thumb:config.BOT_PFP,menu:'default'}
if(fs.existsSync('./settings.json')){try{SETTINGS=Object.assign(SETTINGS,JSON.parse(fs.readFileSync('./settings.json')))}catch{}}
const saveSet=()=>fs.writeFileSync('./settings.json',JSON.stringify(SETTINGS,null,2))

// FIXED MAP - NO CRASH
const fancyMap={a:'\u1D00',b:'\u0299',c:'\u1D04',d:'\u1D05',e:'\u1D07',f:'\uA730',g:'\u0262',h:'\u029C',i:'\u026A',j:'\u1D0A',k:'\u1D0B',l:'\u029F',m:'\u1D0D',n:'\u0274',o:'\u1D0F',p:'\u1D18',q:'\u01EB',r:'\u0280',s:'\uA731',t:'\u1D1B',u:'\u1D1C',v:'\u1D20',w:'\u1D21',x:'x',y:'\u028F',z:'\u1D22',A:'\u1D00',B:'\u0299',C:'\u1D04',D:'\u1D05',E:'\u1D07',F:'\uA730',G:'\u0262',H:'\u029C',I:'\u026A',J:'\u1D0A',K:'\u1D0B',L:'\u029F',M:'\u1D0D',N:'\u0274',O:'\u1D0F',P:'\u1D18',Q:'\u01EB',R:'\u0280',S:'\uA731',T:'\u1D1B',U:'\u1D1C',V:'\u1D20',W:'\u1D21',X:'x',Y:'\u028F',Z:'\u1D22'}
const fancy=t=>String(t||'').split('').map(c=>fancyMap[c]||fancyMap[c.toLowerCase()]||c).join('')

app.get('/pair',async(req,res)=>{
let number=(req.query.number||'').replace(/[^0-9]/g,'')
if(!number)return res.json({error:'?number=234... required'})
if(listSessions().includes(number)){
try{let {state}=await getSession(number);if(state.creds.registered)return res.json({error:'+'+number+' already paired! Delete first'})}catch{}
}
try{
let {state,saveCreds}=await getSession(number)
let sock=makeWASocket({logger:pino({level:'silent'}),auth:state,browser:Browsers.macOS('Chrome'),printQRInTerminal:false,syncFullHistory:false})
sock.ev.on('creds.update',saveCreds)
if(!state.creds.registered){
try{let code=await sock.requestPairingCode(number);res.json({code})}catch(e){res.json({error:e.message.includes('closed')?'Connection Closed - Wait 20 sec':e.message})}
setTimeout(()=>{try{sock.ws.close()}catch{}},8000)
}else{res.json({error:'Already paired'});try{sock.ws.close()}catch{}}
}catch(e){res.json({error:e.message})}
})
app.get('/sessions',(req,res)=>{let l=listSessions();res.json({count:l.length,sessions:l})})
app.get('/delete-session',(req,res)=>{let n=(req.query.number||'').replace(/[^0-9]/g,'');delSession(n);res.json({deleted:n})})
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public/index.html')))
app.listen(PORT,()=>console.log('VIRUS MD running on '+PORT))

async function startBot(number){
let {state,saveCreds}=await getSession(number)
let sock=makeWASocket({
logger:pino({level:'silent'}),auth:{creds:state.creds,keys:makeCacheableSignalKeyStore(state.keys,pino({level:'silent'}))},
browser:Browsers.macOS('Chrome'),printQRInTerminal:false,syncFullHistory:false,markOnlineOnConnect:true,shouldSyncHistoryMessage:()=>false,
getMessage:async()=>{return {conversation:'VIRUS MD'}}
})
sock.ev.on('creds.update',saveCreds)
sock.ev.on('connection.update',async(u)=>{
let {connection,lastDisconnect}=u
if(connection==='close'){
let reason=lastDisconnect?.error?.output?.statusCode
if(reason===DisconnectReason.loggedOut){delSession(number)}
else if(reason!==DisconnectReason.connectionReplaced){setTimeout(()=>startBot(number),3000)}
}
if(connection==='open'){
console.log('CONNECTED: '+number)
if(number===config.OWNER_NUMBER.replace(/[^0-9]/g,'')){
try{await sock.sendMessage(sock.user.id,{image:{url:SETTINGS.thumb||config.BOT_PFP},caption:fancy('VIRUS MD CONNECTED\nOwner: '+config.OWNER_NAME+'\nPaired: '+listSessions().length)})}catch{}
}
}
})

sock.ev.on('messages.upsert',async(o)=>{
try{
const m=o.messages[0];if(!m?.message)return
if(m.key.remoteJid==='status@broadcast'){
if(SETTINGS.autostatus||SETTINGS.autolike){try{await sock.readMessages([m.key]);if(SETTINGS.autolike)await sock.sendMessage(m.key.remoteJid,{react:{text:'❤️',key:m.key}})}catch{}}
return
}
let from=m.key.remoteJid,isGroup=from.endsWith('@g.us'),sender=m.key.participant||m.key.remoteJid,sNorm=norm(sender)
let isOwner=m.key.fromMe||SETTINGS.sudo.includes(sNorm)||sNorm===config.OWNER_NUMBER.replace(/[^0-9]/g,'')
let body=m.message.conversation||m.message.extendedTextMessage?.text||m.message.imageMessage?.caption||m.message.videoMessage?.caption||m.message.documentMessage?.caption||m.message.buttonsResponseMessage?.selectedButtonId||m.message.listResponseMessage?.singleSelectReply?.selectedRowId||""
if(!body)return

if(isGroup){
if(SETTINGS.antilink[from]&&/chat.whatsapp.com|wa.me|t.me|discord.gg/i.test(body)){
try{let meta=await sock.groupMetadata(from);let admin=meta.participants.find(p=>norm(p.id)===sNorm)?.admin;let botAdmin=meta.participants.find(p=>norm(p.id)===norm(sock.user.id))?.admin;if(!admin&&botAdmin){await sock.sendMessage(from,{delete:m.key});await sock.groupParticipantsUpdate(from,[sender],'remove')}}catch{}
}
}
if(SETTINGS.filters[from]){for(let k in SETTINGS.filters[from]){if(body.toLowerCase().includes(k.toLowerCase())){await sock.sendMessage(from,{text:SETTINGS.filters[from][k]},{quoted:m});break}}}
if(SETTINGS.autoread)try{await sock.readMessages([m.key])}catch{}
if(SETTINGS.autotype)try{await sock.sendPresenceUpdate('composing',{to:from})}catch{}
if(SETTINGS.autoonline)try{await sock.sendPresenceUpdate('available',{to:from})}catch{}
if(SETTINGS.autorec)try{await sock.sendPresenceUpdate('recording',{to:from})}catch{}
if(SETTINGS.autoreact)try{await sock.sendMessage(from,{react:{text:'❤️',key:m.key}})}catch{}

if(!body.startsWith(config.PREFIX))return
try{await sock.sendMessage(from,{react:{text:'⏳',key:m.key}})}catch{}

let args=body.slice(config.PREFIX.length).trim().split(/\s+/),cmd=args.shift().toLowerCase(),q=args.join(" ")
const reply=async(t)=>{await sock.sendMessage(from,{text:fancy(t)},{quoted:m})}
const replyPfp=async(t)=>{await sock.sendMessage(from,{image:{url:SETTINGS.thumb||config.BOT_PFP},caption:t},{quoted:m})}
const done=async()=>{try{await sock.sendMessage(from,{react:{text:'💀',key:m.key}})}catch{}}
const getQuoted=()=>m.message.extendedTextMessage?.contextInfo?.quotedMessage

// ===== YOUR EXACT RAW MENU - ADDED - NO TOUCH - WITH PFP =====
if(['menu','help'].includes(cmd)){
let up=runtime(process.uptime())
// THIS IS YOUR RAW MENU EXACTLY AS YOU SENT
let rawMenu=`┌ ─ 〔 ᴠɪʀᴜꜱ ᴍᴅ 〕
│ ᴄʀᴇᴀᴛᴏʀ ϟ ${config.OWNER_NAME}
│ ɴᴜᴍʙᴇʀ ϟ ${config.OWNER_NUMBER}
│ ʙᴏᴛ ɴᴀᴍᴇ ϟ ᴠɪʀᴜꜱ ᴍᴅ
│ ᴍᴏᴅᴇ ʙᴏᴛ ϟ ${SETTINGS.mode}
│ ᴘʀᴇꜰɪx ϟ ${config.PREFIX}
│ ᴠᴇʀꜱɪᴏɴ ϟ ${config.VERSION}
│ ʀᴜɴ ᴛɪᴍᴇ ϟ ${up}
│ ᴘᴀɪʀᴇᴅ ϟ ${listSessions().length}
└

┌ ─ 〔 ᴏᴡɴᴇʀ 〕
│ • .ᴏᴡɴᴇʀ
│ • .ꜱᴇᴛᴏᴡɴᴇʀ
│ • .ꜱᴇᴛᴘʀᴇꜰɪx
│ • .ꜱᴇᴛɴᴀᴍᴇ
│ • .ꜱᴇᴛʙɪᴏ
│ • .ꜱᴇᴛᴘᴘ
│ • .ʀᴇꜱᴛᴀʀᴛ
│ • .ꜱʜᴜᴛᴅᴏᴡɴ
│ • .ʙʀᴏᴀᴅᴄᴀꜱᴛ
│ • .ʙʟᴏᴄᴋ
│ • .ᴜɴʙʟᴏᴄᴋ
│ • .ʙᴀɴ
│ • .ᴜɴʙᴀɴ
│ • .ᴇᴠᴀʟ
│ • .ᴇxᴇᴄ
│ • .ᴊᴏɪɴ
│ • .ʟᴇᴀᴠᴇ
│ • .ᴘᴜʙʟɪᴄ
│ • .ᴘʀɪᴠᴀᴛᴇ
│ • .ᴄʟᴇᴀʀꜱᴇꜱꜱɪᴏɴ
│ • .ꜱᴇᴛᴍᴏᴅᴇ
│ • .ꜱᴇᴛᴛʜᴜᴍʙ
│ • .ꜱᴇᴛᴍᴇɴᴜ
└

┌ ─ 〔 ɢʀᴏᴜᴘ 〕
│ • .ɢʀᴏᴜᴘɪɴꜰᴏ
│ • .ɢʀᴏᴜᴘʟɪɴᴋ
│ • .ʀᴇᴠᴏᴋᴇ
│ • .ᴛᴀɢᴀʟʟ
│ • .ʜɪᴅᴇᴛᴀɢ
│ • .ᴇᴠᴇʀʏᴏɴᴇ
│ • .ʟɪꜱᴛᴏɴʟɪɴᴇ
│ • .ʟɪꜱᴛᴍᴇᴍʙᴇʀ
│ • .ᴀᴅᴅ
│ • .ʀᴇᴍᴏᴠᴇ
│ • .ᴘʀᴏᴍᴏᴛᴇ
│ • .ᴅᴇᴍᴏᴛᴇ
│ • .ᴋɪᴄᴋ
│ • .ᴡᴇʟᴄᴏᴍᴇ
│ • .ɢᴏᴏᴅʙʏᴇ
│ • .ᴏᴘᴇɴ
│ • .ᴄʟᴏꜱᴇ
│ • .ꜱᴇᴛɴᴀᴍᴇɢᴄ
│ • .ꜱᴇᴛᴅᴇꜱᴄ
│ • .ᴡᴀʀɴ
│ • .ᴡᴀʀɴɪɴɢꜱ
│ • .ᴅᴇʟᴡᴀʀɴ
│ • .ᴍᴜᴛᴇ
│ • .ᴜɴᴍᴜᴛᴇ
│ • .ᴀɴᴛɪʟɪɴᴋ
│ • .ᴀɴᴛɪꜱᴘᴀᴍ
│ • .ᴀɴᴛɪʙᴀᴅᴡᴏʀᴅ
│ • .ᴀɴᴛɪᴛᴀɢ
│ • .ᴀɴᴛɪʙᴏᴛ
│ • .ᴀɴᴛɪꜰᴀᴋᴇ
│ • .ᴀɴᴛɪᴅᴇʟᴇᴛᴇ
│ • .ꜰɪʟᴛᴇʀ
│ • .ᴜɴꜰɪʟᴛᴇʀ
│ • .ᴅᴇʟᴇᴛᴇ
│ • .ᴘᴜʀɢᴇ
│ • .ᴘɪɴ
│ • .ᴜɴᴘɪɴ
│ • .ʟᴏᴄᴋɢᴄ
│ • .ᴜɴʟᴏᴄᴋɢᴄ
└

┌ ─ 〔 ᴀᴜᴛᴏ 〕
│ • .ᴀᴜᴛᴏʀᴇᴀᴅ
│ • .ᴀᴜᴛᴏᴛʏᴘɪɴɢ
│ • .ᴀᴜᴛᴏᴏɴʟɪɴᴇ
│ • .ᴀᴜᴛᴏʀᴇᴄᴏʀᴅɪɴɢ
│ • .ᴀᴜᴛᴏʀᴇᴀᴄᴛ
│ • .ᴀᴜᴛᴏʀᴇᴘʟʏ
│ • .ᴀᴜᴛᴏꜱᴛɪᴄᴋᴇʀ
│ • .ᴀᴜᴛᴏᴠɪᴇᴡ
│ • .ᴀᴜᴛᴏʙɪᴏ
│ • .ᴀᴜᴛᴏʟɪᴋᴇꜱᴛᴀᴛᴜꜱ
│ • .ᴀᴜᴛᴏᴠɪᴇᴡꜱᴛᴀᴛᴜꜱ
│ • .ᴀᴜᴛᴏᴅᴏᴡɴʟᴏᴀᴅ
│ • .ᴀᴜᴛᴏᴡᴇʟᴄᴏᴍᴇ
│ • .ᴀᴜᴛᴏɢᴏᴏᴅʙʏᴇ
└

┌ ─ 〔 ᴄᴏɴᴠᴇʀᴛᴇʀ 〕
│ • .ꜱᴛɪᴄᴋᴇʀ
│ • .ꜱ
│ • .ᴛᴏɪᴍɢ
│ • .ᴛᴏᴠɪᴅᴇᴏ
│ • .ᴛᴏɢɪꜰ
│ • .ᴛᴀᴋᴇ
│ • .ꜱᴛᴇᴀʟ
│ • .ᴇᴍᴏᴊɪᴍɪx
│ • .ꜱᴍᴇᴍᴇ
│ • .ᴀᴛᴛᴘ
│ • .ᴛᴛᴘ
│ • .ʙʀᴀᴛ
│ • .ǫᴄ
│ • .ᴄɪʀᴄʟᴇ
│ • .ᴄʀᴏᴘ
│ • .ᴡᴀɴᴛᴇᴅ
│ • .ᴛʀɪɢɢᴇʀ
│ • .ʙʟᴜʀ
│ • .ʀᴇᴍᴏᴠᴇʙɢ
└

┌ ─ 〔 ᴅᴏᴡɴʟᴏᴀᴅᴇʀ 〕
│ • .ᴘʟᴀʏ
│ • .ꜱᴏɴɢ
│ • .ᴠɪᴅᴇᴏ
│ • .ʏᴛᴍᴘ3
│ • .ʏᴛᴍᴘ4
│ • .ᴛɪᴋᴛᴏᴋ
│ • .ꜰᴀᴄᴇʙᴏᴏᴋ
│ • .ɪɴꜱᴛᴀɢʀᴀᴍ
│ • .ᴛᴡɪᴛᴛᴇʀ
│ • .ꜱᴘᴏᴛɪꜰʏ
│ • .ᴍᴇᴅɪᴀꜰɪʀᴇ
│ • .ɢᴅʀɪᴠᴇ
│ • .ᴘɪɴᴛᴇʀᴇꜱᴛ
│ • .ᴛʜʀᴇᴀᴅꜱ
│ • .ᴄᴀᴘᴄᴜᴛ
│ • .ᴀᴘᴋ
│ • .ɪᴍᴀɢᴇ
│ • .ʟʏʀɪᴄꜱ
│ • .ꜱᴏᴜɴᴅᴄʟᴏᴜᴅ
└

┌ ─ 〔 ꜱᴇᴀʀᴄʜ 〕
│ • .ɢᴏᴏɢʟᴇ
│ • .ʙɪɴɢ
│ • .ᴡɪᴋɪᴘᴇᴅɪᴀ
│ • .ᴡᴇᴀᴛʜᴇʀ
│ • .ɴᴇᴡꜱ
│ • .ᴅᴇꜰɪɴᴇ
│ • .ᴛʀᴀɴꜱʟᴀᴛᴇ
│ • .ɢɪᴛʜᴜʙ
│ • .ɴᴘᴍ
│ • .ᴍᴏᴠɪᴇ
│ • .ᴀɴɪᴍᴇ
│ • .ᴍᴀɴɢᴀ
│ • .ᴡᴀʟʟᴘᴀᴘᴇʀ
│ • .ʙᴏᴏᴋ
│ • .ᴄᴜʀʀᴇɴᴄʏ
│ • .ᴛɪᴍᴇᴢᴏɴᴇ
│ • .ǫʀᴄᴏᴅᴇ
│ • .ꜱʜᴏʀᴛᴜʀʟ
└

┌ ─ 〔 ꜰᴜɴ 〕
│ • .ᴊᴏᴋᴇ
│ • .ᴍᴇᴍᴇ
│ • .ǫᴜᴏᴛᴇ
│ • .ꜰᴀᴄᴛ
│ • .ᴛʀᴜᴛʜ
│ • .ᴅᴀʀᴇ
│ • .ꜱʜɪᴘ
│ • .ʟᴏᴠᴇ
│ • .ᴄʜᴀʀᴀᴄᴛᴇʀ
│ • .ᴄᴏᴍᴘʟɪᴍᴇɴᴛ
│ • .ɪɴꜱᴜʟᴛ
│ • .ꜰʟɪᴘ
│ • .ᴅɪᴄᴇ
│ • .ʀɪᴅᴅʟᴇ
│ • .ǫᴜɪᴢ
│ • .ʜᴀᴄᴋ
│ • .ᴍᴏᴛɪᴠᴀᴛᴇ
└

┌ ─ 〔 ʙᴏᴛ ɪɴꜰᴏ 〕
│ • .ᴘɪɴɢ
│ • .ᴀʟɪᴠᴇ
│ • .ʀᴜɴᴛɪᴍᴇ
│ • .ᴜᴘᴛɪᴍᴇ
│ • .ʙᴏᴛɪɴꜰᴏ
│ • .ᴏᴡɴᴇʀɪɴꜰᴏ
│ • .ꜱᴘᴇᴇᴅ
│ • .ꜱʏꜱᴛᴇᴍ
│ • .ʀᴇᴘᴏ
│ • .ꜱᴜᴘᴘᴏʀᴛ
│ • .ɢᴇᴛᴘᴘ
│ • .ꜱᴇᴛᴘᴘʙᴏᴛ
└

┌ ─ 〔 ᴠɪᴇᴡᴏɴᴄᴇ 〕
│ • .ᴠᴠ
│ • .ᴠᴠ2
│ • .ᴠᴠ3
│ • .ᴠɪᴇᴡᴏɴᴄᴇ
│ • .ꜱᴀᴠᴇ
│ • .ǫᴜᴏᴛᴇᴅ
│ • .ɢᴇᴛᴍꜱɢ
│ • .ɢᴇᴛᴍᴇᴅɪᴀ
└

> Power by virus Multiple devices`

await sock.sendMessage(from,{image:{url:SETTINGS.thumb||config.BOT_PFP},caption:rawMenu},{quoted:m})
await done();return
}

// REST OF YOUR COMMANDS - UNTOUCHED
if(cmd==='owner'||cmd==='ownerinfo'){await replyPfp('Owner: '+config.OWNER_NAME+'\nNumber: '+config.OWNER_NUMBER+'\nBot: VIRUS MD\nMode: '+SETTINGS.mode+'\nPaired: '+listSessions().length);await done();return}
if(cmd==='setowner'){if(!isOwner)return;let n=q.replace(/[^0-9]/g,'');SETTINGS.sudo.push(n);saveSet();await replyPfp('Added sudo: '+n);await done();return}
if(cmd==='setprefix'){if(!isOwner)return;config.PREFIX=q;await replyPfp('Prefix: '+q);await done();return}
if(cmd==='setname'){if(!isOwner)return;await sock.updateProfileName(q);await replyPfp('Done');await done();return}
if(cmd==='setbio'){if(!isOwner)return;await sock.updateProfileStatus(q);await replyPfp('Done');await done();return}
if(cmd==='setpp'||cmd==='setppbot'){if(!isOwner)return;let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.updateProfilePicture(sock.user.id,b);await replyPfp('PP Updated');await done();return}
if(cmd==='restart'){if(!isOwner)return;await replyPfp('Restarting...');await done();process.exit(0)}
if(cmd==='public'){if(!isOwner)return;SETTINGS.mode='public';saveSet();await replyPfp('Mode Public');await done();return}
if(cmd==='private'){if(!isOwner)return;SETTINGS.mode='private';saveSet();await replyPfp('Mode Private');await done();return}
if(cmd==='clearsession'){if(!isOwner)return;let n=q.replace(/[^0-9]/g,'')||number;delSession(n);await replyPfp('Deleted: '+n);await done();return}
if(cmd==='block'){if(!isOwner)return;let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q+'@s.whatsapp.net';await sock.updateBlockStatus(j,'block');await replyPfp('Blocked');await done();return}
if(cmd==='unblock'){if(!isOwner)return;let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q+'@s.whatsapp.net';await sock.updateBlockStatus(j,'unblock');await replyPfp('Unblocked');await done();return}
if(cmd==='grouplink'){let c=await sock.groupInviteCode(from);await replyPfp('https://chat.whatsapp.com/'+c);await done();return}
if(cmd==='tagall'||cmd==='everyone'){let meta=await sock.groupMetadata(from);let txt='Tag '+(q||'')+'\n'+meta.participants.map(p=>'@'+p.id.split('@')[0]).join('\n');await sock.sendMessage(from,{text:fancy(txt),mentions:meta.participants.map(p=>p.id)},{quoted:m});await done();return}
if(cmd==='hidetag'){let meta=await sock.groupMetadata(from);await sock.sendMessage(from,{text:fancy(q||'Hidetag'),mentions:meta.participants.map(p=>p.id)},{quoted:m});await done();return}
if(cmd==='kick'||cmd==='remove'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';await sock.groupParticipantsUpdate(from,[j],'remove');await replyPfp('Kicked');await done();return}
if(cmd==='add'){let j=q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';await sock.groupParticipantsUpdate(from,[j],'add');await done();return}
if(cmd==='promote'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];await sock.groupParticipantsUpdate(from,[j],'promote');await replyPfp('Promoted');await done();return}
if(cmd==='demote'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];await sock.groupParticipantsUpdate(from,[j],'demote');await replyPfp('Demoted');await done();return}
if(cmd==='open'){await sock.groupSettingUpdate(from,'not_announcement');await replyPfp('Group Opened');await done();return}
if(cmd==='close'){await sock.groupSettingUpdate(from,'announcement');await replyPfp('Group Closed');await done();return}
if(cmd==='delete'||cmd==='del'){try{let ctx=m.message.extendedTextMessage.contextInfo;let k={remoteJid:from,fromMe:false,id:ctx.stanzaId,participant:ctx.participant};await sock.sendMessage(from,{delete:k})}catch{await reply('Reply to msg')}await done();return}
if(cmd==='sticker'||cmd==='s'){let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{sticker:b},{quoted:m});await done();return}
if(cmd==='toimg'){let qq=getQuoted()?.stickerMessage;if(!qq)return await reply('Reply sticker');let b=await downloadMediaMessage({message:{stickerMessage:qq}},'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{image:b},{quoted:m});await done();return}
if(cmd==='vv'||cmd==='viewonce'){let qq=getQuoted();let type=Object.keys(qq)[0];let msg=qq[type]?.message||qq;let b=await downloadMediaMessage({message:msg},'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});if(msg.imageMessage)await sock.sendMessage(from,{image:b,caption:msg.imageMessage.caption||''},{quoted:m});if(msg.videoMessage)await sock.sendMessage(from,{video:b},{quoted:m});await done();return}
if(cmd==='tiktok'){try{let r=await axios.get('https://api.davidcyriltech.my.id/tiktok?url='+encodeURIComponent(q));await sock.sendMessage(from,{video:{url:r.data.result.video},caption:fancy('VIRUS MD')},{quoted:m})}catch{await reply('Invalid')}await done();return}
if(cmd==='ytmp3'||cmd==='play'){try{let r=await axios.get('https://api.davidcyriltech.my.id/youtube/mp3?url='+encodeURIComponent(q));await sock.sendMessage(from,{audio:{url:r.data.result.download_url},mimetype:'audio/mpeg'},{quoted:m})}catch{await reply('Error')}await done();return}
if(cmd==='ytmp4'||cmd==='video'){try{let r=await axios.get('https://api.davidcyriltech.my.id/youtube/mp4?url='+encodeURIComponent(q));await sock.sendMessage(from,{video:{url:r.data.result.download_url}},{quoted:m})}catch{await reply('Error')}await done();return}
if(cmd==='getpp'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||sender;let url=await sock.profilePictureUrl(j,'image').catch(()=>SETTINGS.thumb||config.BOT_PFP);await sock.sendMessage(from,{image:{url}},{quoted:m});await done();return}
if(cmd==='qrcode'){let url='https://api.qrserver.com/v1/create-qr-code/?size=400x400&data='+encodeURIComponent(q);await sock.sendMessage(from,{image:{url},caption:fancy(q)},{quoted:m});await done();return}
if(cmd==='joke'){let r=await axios.get('https://official-joke-api.appspot.com/random_joke');await reply(r.data.setup+'\n'+r.data.punchline);await done();return}
if(cmd==='meme'){let r=await axios.get('https://meme-api.com/gimme');await sock.sendMessage(from,{image:{url:r.data.url},caption:fancy(r.data.title)},{quoted:m});await done();return}
if(cmd==='fact'){let r=await axios.get('https://uselessfacts.jsph.pl/random.json?language=en');await reply('Fact: '+r.data.text);await done();return}
if(cmd==='eval'){if(!isOwner)return;try{let ev=await eval(q);await reply(String(ev))}catch(e){await reply(e.message)}await done();return}
if(cmd==='exec'){if(!isOwner)return;require('child_process').exec(q,(e,o)=>reply(e?e.message:o).then(done));return}

await done();
}catch(e){
console.log('[MSG ERROR] '+e.message)
try{await sock.sendMessage(o.messages[0].key.remoteJid,{react:{text:'💀',key:o.messages[0].key}})}catch{}
}
})
}

let main=config.OWNER_NUMBER.replace(/[^0-9]/g,'')
async function bootAll(){
console.log('[VIRUS MD] Booting '+listSessions().length+' devices...')
for(let n of listSessions()){
console.log('[BOOT] '+n)
try{await startBot(n)}catch(e){console.log('[BOOT FAIL] '+n+': '+e.message)}
await new Promise(r=>setTimeout(r,2500))
}
if(!listSessions().includes(main)){
try{await startBot(main)}catch{}
}
}
bootAll()
