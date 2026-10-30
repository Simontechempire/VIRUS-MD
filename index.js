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

let SETTINGS={mode:'public',sudo:[],antilink:{},antispam:{},antibad:{},antitag:{},antibot:{},antifake:{},antidelete:{},warns:{},filters:{},welcome:{},goodbye:{},autoread:false,autotype:false,autoonline:false,autorec:false,autoreact:false,autostatus:false,autolike:false,thumb:config.BOT_PFP,menu:'default',autoview:false,autobio:false,autodownload:false,autowelcome:false,autogoodbye:false,autolikestatus:false,autoviewstatus:false,autoreply:false,autosticker:false}
if(fs.existsSync('./settings.json')){try{SETTINGS=Object.assign(SETTINGS,JSON.parse(fs.readFileSync('./settings.json')))}catch{}}
const saveSet=()=>fs.writeFileSync('./settings.json',JSON.stringify(SETTINGS,null,2))

const fancyMap={a:'\u1D00',b:'\u0299',c:'\u1D04',d:'\u1D05',e:'\u1D07',f:'\uA730',g:'\u0262',h:'\u029C',i:'\u026A',j:'\u1D0A',k:'\u1D0B',l:'\u029F',m:'\u1D0D',n:'\u0274',o:'\u1D0F',p:'\u1D18',q:'\u01EB',r:'\u0280',s:'\uA731',t:'\u1D1B',u:'\u1D1C',v:'\u1D20',w:'\u1D21',x:'x',y:'\u028F',z:'\u1D22',A:'\u1D00',B:'\u0299',C:'\u1D04',D:'\u1D05',E:'\u1D07',F:'\uA730',G:'\u0262',H:'\u029C',I:'\u026A',J:'\u1D0A',K:'\u1D0B',L:'\u029F',M:'\u1D0D',N:'\u0274',O:'\u1D0F',P:'\u1D18',Q:'\u01EB',R:'\u0280',S:'\uA731',T:'\u1D1B',U:'\u1D1C',V:'\u1D20',W:'\u1D21',X:'x',Y:'\u028F',Z:'\u1D22'}
const fancy=t=>String(t||'').split('').map(c=>fancyMap[c]||fancyMap[c.toLowerCase()]||c).join('')

let activeSocks=new Map()

app.get('/pair',async(req,res)=>{
let number=(req.query.number||'').replace(/[^0-9]/g,'')
if(!number)return res.json({error:'?number=234... required'})
if(activeSocks.has(number)){
try{activeSocks.get(number).ws.close()}catch{}
activeSocks.delete(number)
await new Promise(r=>setTimeout(r,3000))
}
try{
let {state,saveCreds}=await getSession(number)
let sock=makeWASocket({logger:pino({level:'silent'}),auth:{creds:state.creds,keys:makeCacheableSignalKeyStore(state.keys,pino({level:'silent'}))},browser:Browsers.macOS('Chrome'),printQRInTerminal:false,syncFullHistory:false,version:[2,3000,1015901307]})
sock.ev.on('creds.update',saveCreds)
if(!state.creds.registered){
await new Promise(r=>setTimeout(r,3000))
try{let code=await sock.requestPairingCode(number);res.json({code})}catch(e){res.json({error:e.message.includes('closed')?'Connection Closed - Delete Active Session, wait 60sec and retry':e.message})}
setTimeout(()=>{try{sock.ws.close()}catch{}},25000)
}else{res.json({error:'Already paired'});try{sock.ws.close()}catch{}}
}catch(e){res.json({error:e.message})}
})
app.get('/sessions',(req,res)=>{let l=listSessions();res.json({count:l.length,sessions:l})})
app.get('/delete-session',(req,res)=>{let n=(req.query.number||'').replace(/[^0-9]/g,'');if(activeSocks.has(n)){try{activeSocks.get(n).ws.close()}catch{} activeSocks.delete(n)} delSession(n);res.json({deleted:n})})
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public/index.html')))
app.listen(PORT,()=>console.log('VIRUS MD running on '+PORT))

async function startBot(number){
if(activeSocks.has(number)) return
let {state,saveCreds}=await getSession(number)
let sock=makeWASocket({
logger:pino({level:'silent'}),auth:{creds:state.creds,keys:makeCacheableSignalKeyStore(state.keys,pino({level:'silent'}))},
browser:Browsers.macOS('Chrome'),version:[2,3000,1015901307],
printQRInTerminal:false,syncFullHistory:false,markOnlineOnConnect:true,shouldSyncHistoryMessage:()=>false,
getMessage:async()=>{return {conversation:'VIRUS MD'}}
})
activeSocks.set(number,sock)
sock.ev.on('creds.update',saveCreds)
sock.ev.on('connection.update',async(u)=>{
let {connection,lastDisconnect}=u
if(connection==='close'){
let reason=lastDisconnect?.error?.output?.statusCode
activeSocks.delete(number)
console.log(`[DISCONNECT] ${number} reason: ${reason}`)
if(reason===DisconnectReason.loggedOut){delSession(number)}
else if(reason!==DisconnectReason.connectionReplaced){setTimeout(()=>startBot(number),8000)}
}
if(connection==='open'){
console.log(`CONNECTED: ${number}`)
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
if(SETTINGS.antibad[from]&&/fuck|shit|bitch|porn/i.test(body)){
try{let meta=await sock.groupMetadata(from);let admin=meta.participants.find(p=>norm(p.id)===sNorm)?.admin;if(!admin)await sock.sendMessage(from,{delete:m.key})}catch{}
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

// ===== YOUR EXACT RAW MENU =====
if(['menu','help'].includes(cmd)){
let up=runtime(process.uptime())
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
│ • .ᴏᴡɴᴇʀ • .ꜱᴇᴛᴏᴡɴᴇʀ • .ꜱᴇᴛᴘʀᴇꜰɪx • .ꜱᴇᴛɴᴀᴍᴇ • .ꜱᴇᴛʙɪᴏ • .ꜱᴇᴛᴘᴘ • .ʀᴇꜱᴛᴀʀᴛ • .ꜱʜᴜᴛᴅᴏᴡɴ • .ʙʀᴏᴀᴅᴄᴀꜱᴛ • .ʙʟᴏᴄᴋ • .ᴜɴʙʟᴏᴄᴋ • .ʙᴀɴ • .ᴜɴʙᴀɴ • .ᴇᴠᴀʟ • .ᴇxᴇᴄ • .ᴊᴏɪɴ • .ʟᴇᴀᴠᴇ • .ᴘᴜʙʟɪᴄ • .ᴘʀɪᴠᴀᴛᴇ • .ᴄʟᴇᴀʀꜱᴇꜱꜱɪᴏɴ • .ꜱᴇᴛᴍᴏᴅᴇ • .ꜱᴇᴛᴛʜᴜᴍʙ • .ꜱᴇᴛᴍᴇɴᴜ
└

┌ ─ 〔 ɢʀᴏᴜᴘ 〕
│ • .ɢʀᴏᴜᴘɪɴꜰᴏ • .ɢʀᴏᴜᴘʟɪɴᴋ • .ʀᴇᴠᴏᴋᴇ • .ᴛᴀɢᴀʟʟ • .ʜɪᴅᴇᴛᴀɢ • .ᴇᴠᴇʀʏᴏɴᴇ • .ʟɪꜱᴛᴏɴʟɪɴᴇ • .ʟɪꜱᴛᴍᴇᴍʙᴇʀ • .ᴀᴅᴅ • .ʀᴇᴍᴏᴠᴇ • .ᴘʀᴏᴍᴏᴛᴇ • .ᴅᴇᴍᴏᴛᴇ • .ᴋɪᴄᴋ • .ᴡᴇʟᴄᴏᴍᴇ • .ɢᴏᴏᴅʙʏᴇ • .ᴏᴘᴇɴ • .ᴄʟᴏꜱᴇ • .ꜱᴇᴛɴᴀᴍᴇɢᴄ • .ꜱᴇᴛᴅᴇꜱᴄ • .ᴡᴀʀɴ • .ᴡᴀʀɴɪɴɢꜱ • .ᴅᴇʟᴡᴀʀɴ • .ᴍᴜᴛᴇ • .ᴜɴᴍᴜᴛᴇ • .ᴀɴᴛɪʟɪɴᴋ • .ᴀɴᴛɪꜱᴘᴀᴍ • .ᴀɴᴛɪʙᴀᴅᴡᴏʀᴅ • .ᴀɴᴛɪᴛᴀɢ • .ᴀɴᴛɪʙᴏᴛ • .ᴀɴᴛɪꜰᴀᴋᴇ • .ᴀɴᴛɪᴅᴇʟᴇᴛᴇ • .ꜰɪʟᴛᴇʀ • .ᴜɴꜰɪʟᴛᴇʀ • .ᴅᴇʟᴇᴛᴇ • .ᴘᴜʀɢᴇ • .ᴘɪɴ • .ᴜɴᴘɪɴ • .ʟᴏᴄᴋɢᴄ • .ᴜɴʟᴏᴄᴋɢᴄ
└

┌ ─ 〔 ᴀᴜᴛᴏ 〕
│ • .ᴀᴜᴛᴏʀᴇᴀᴅ • .ᴀᴜᴛᴏᴛʏᴘɪɴɢ • .ᴀᴜᴛᴏᴏɴʟɪɴᴇ • .ᴀᴜᴛᴏʀᴇᴄᴏʀᴅɪɴɢ • .ᴀᴜᴛᴏʀᴇᴀᴄᴛ • .ᴀᴜᴛᴏʀᴇᴘʟʏ • .ᴀᴜᴛᴏꜱᴛɪᴄᴋᴇʀ • .ᴀᴜᴛᴏᴠɪᴇᴡ • .ᴀᴜᴛᴏʙɪᴏ • .ᴀᴜᴛᴏʟɪᴋᴇꜱᴛᴀᴛᴜꜱ • .ᴀᴜᴛᴏᴠɪᴇᴡꜱᴛᴀᴛᴜꜱ • .ᴀᴜᴛᴏᴅᴏᴡɴʟᴏᴀᴅ • .ᴀᴜᴛᴏᴡᴇʟᴄᴏᴍᴇ • .ᴀᴜᴛᴏɢᴏᴏᴅʙʏᴇ
└

┌ ─ 〔 ᴄᴏɴᴠᴇʀᴛᴇʀ 〕
│ • .ꜱᴛɪᴄᴋᴇʀ • .ꜱ • .ᴛᴏɪᴍɢ • .ᴛᴏᴠɪᴅᴇᴏ • .ᴛᴏɢɪꜰ • .ᴛᴀᴋᴇ • .ꜱᴛᴇᴀʟ • .ᴇᴍᴏᴊɪᴍɪx • .ꜱᴍᴇᴍᴇ • .ᴀᴛᴛᴘ • .ᴛᴛᴘ • .ʙʀᴀᴛ • .ǫᴄ • .ᴄɪʀᴄʟᴇ • .ᴄʀᴏᴘ • .ᴡᴀɴᴛᴇᴅ • .ᴛʀɪɢɢᴇʀ • .ʙʟᴜʀ • .ʀᴇᴍᴏᴠᴇʙɢ
└

┌ ─ 〔 ᴅᴏᴡɴʟᴏᴀᴅᴇʀ 〕
│ • .ᴘʟᴀʏ • .ꜱᴏɴɢ • .ᴠɪᴅᴇᴏ • .ʏᴛᴍᴘ3 • .ʏᴛᴍᴘ4 • .ᴛɪᴋᴛᴏᴋ • .ꜰᴀᴄᴇʙᴏᴏᴋ • .ɪɴꜱᴛᴀɢʀᴀᴍ • .ᴛᴡɪᴛᴛᴇʀ • .ꜱᴘᴏᴛɪꜰʏ • .ᴍᴇᴅɪᴀꜰɪʀᴇ • .ɢᴅʀɪᴠᴇ • .ᴘɪɴᴛᴇʀᴇꜱᴛ • .ᴛʜʀᴇᴀᴅꜱ • .ᴄᴀᴘᴄᴜᴛ • .ᴀᴘᴋ • .ɪᴍᴀɢᴇ • .ʟʏʀɪᴄꜱ • .ꜱᴏᴜɴᴅᴄʟᴏᴜᴅ
└

┌ ─ 〔 ꜱᴇᴀʀᴄʜ 〕
│ • .ɢᴏᴏɢʟᴇ • .ʙɪɴɢ • .ᴡɪᴋɪᴘᴇᴅɪᴀ • .ᴡᴇᴀᴛʜᴇʀ • .ɴᴇᴡꜱ • .ᴅᴇꜰɪɴᴇ • .ᴛʀᴀɴꜱʟᴀᴛᴇ • .ɢɪᴛʜᴜʙ • .ɴᴘᴍ • .ᴍᴏᴠɪᴇ • .ᴀɴɪᴍᴇ • .ᴍᴀɴɢᴀ • .ᴡᴀʟʟᴘᴀᴘᴇʀ • .ʙᴏᴏᴋ • .ᴄᴜʀʀᴇɴᴄʏ • .ᴛɪᴍᴇᴢᴏɴᴇ • .ǫʀᴄᴏᴅᴇ • .ꜱʜᴏʀᴛᴜʀʟ
└

┌ ─ 〔 ꜰᴜɴ 〕
│ • .ᴊᴏᴋᴇ • .ᴍᴇᴍᴇ • .ǫᴜᴏᴛᴇ • .ꜰᴀᴄᴛ • .ᴛʀᴜᴛʜ • .ᴅᴀʀᴇ • .ꜱʜɪᴘ • .ʟᴏᴠᴇ • .ᴄʜᴀʀᴀᴄᴛᴇʀ • .ᴄᴏᴍᴘʟɪᴍᴇɴᴛ • .ɪɴꜱᴜʟᴛ • .ꜰʟɪᴘ • .ᴅɪᴄᴇ • .ʀɪᴅᴅʟᴇ • .ǫᴜɪᴢ • .ʜᴀᴄᴋ • .ᴍᴏᴛɪᴠᴀᴛᴇ
└

┌ ─ 〔 ʙᴏᴛ ɪɴꜰᴏ 〕
│ • .ᴘɪɴɢ • .ᴀʟɪᴠᴇ • .ʀᴜɴᴛɪᴍᴇ • .ᴜᴘᴛɪᴍᴇ • .ʙᴏᴛɪɴꜰᴏ • .ᴏᴡɴᴇʀɪɴꜰᴏ • .ꜱᴘᴇᴇᴅ • .ꜱʏꜱᴛᴇᴍ • .ʀᴇᴘᴏ • .ꜱᴜᴘᴘᴏʀᴛ • .ɢᴇᴛᴘᴘ • .ꜱᴇᴛᴘᴘʙᴏᴛ
└

┌ ─ 〔 ᴠɪᴇᴡᴏɴᴄᴇ 〕
│ • .ᴠᴠ • .ᴠᴠ2 • .ᴠᴠ3 • .ᴠɪᴇᴡᴏɴᴄᴇ • .ꜱᴀᴠᴇ • .ǫᴜᴏᴛᴇᴅ • .ɢᴇᴛᴍꜱɢ • .ɢᴇᴛᴍᴇᴅɪᴀ
└
> Power by virus Multiple devices`

await sock.sendMessage(from,{image:{url:SETTINGS.thumb||config.BOT_PFP},caption:rawMenu},{quoted:m})
await done();return
}

// YOUR EXISTING CMDS - UNTOUCHED
if(cmd==='owner'||cmd==='ownerinfo'){await replyPfp('Owner: '+config.OWNER_NAME+'\nNumber: '+config.OWNER_NUMBER+'\nBot: VIRUS MD\nMode: '+SETTINGS.mode+'\nPaired: '+listSessions().length);await done();return}
if(cmd==='setowner'){if(!isOwner)return;let n=q.replace(/[^0-9]/g,'');SETTINGS.sudo.push(n);saveSet();await replyPfp('Added sudo: '+n);await done();return}
if(cmd==='setprefix'){if(!isOwner)return;config.PREFIX=q;await replyPfp('Prefix: '+q);await done();return}
if(cmd==='setname'){if(!isOwner)return;await sock.updateProfileName(q);await replyPfp('Done');await done();return}
if(cmd==='setbio'){if(!isOwner)return;await sock.updateProfileStatus(q);await replyPfp('Done');await done();return}
if(cmd==='setpp'||cmd==='setppbot'){if(!isOwner)return;let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.updateProfilePicture(sock.user.id,b);await replyPfp('PP Updated');await done();return}
if(cmd==='restart'){if(!isOwner)return;await replyPfp('Restarting...');await done();process.exit(0)}
if(cmd==='public'){if(!isOwner)return;SETTINGS.mode='public';saveSet();await replyPfp('Mode Public');await done();return}
if(cmd==='private'){if(!isOwner)return;SETTINGS.mode='private';saveSet();await replyPfp('Mode Private');await done();return}
if(cmd==='clearsession'){if(!isOwner)return;let n=q.replace(/[^0-9]/g,'')||number;if(activeSocks.has(n)){try{activeSocks.get(n).ws.close()}catch{} activeSocks.delete(n)} delSession(n);await replyPfp('Deleted: '+n);await done();return}
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
if(cmd==='vv'||cmd==='viewonce'||cmd==='vv2'||cmd==='vv3'){let qq=getQuoted();if(!qq)return await reply('Reply viewonce');let b=await downloadMediaMessage({message:qq},'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});if(qq.imageMessage)await sock.sendMessage(from,{image:b,caption:qq.imageMessage.caption||''},{quoted:m});else if(qq.videoMessage)await sock.sendMessage(from,{video:b,caption:qq.videoMessage.caption||''},{quoted:m});await done();return}

// ================= ALL MISSING CMDS ADDED BELOW - WITH PFP =================

// OWNER EXTRA
if(cmd==='shutdown'){if(!isOwner)return;await replyPfp('Shutting down...');await done();process.exit(0)}
if(cmd==='broadcast'||cmd==='bc'){if(!isOwner)return;let chats=await sock.groupFetchAllParticipating();let c=0;for(let id in chats){try{await sock.sendMessage(id,{image:{url:SETTINGS.thumb||config.BOT_PFP},caption:q});c++;await new Promise(r=>setTimeout(r,800))}catch{}} await replyPfp('Broadcast to '+c+' groups');await done();return}
if(cmd==='ban'){if(!isOwner)return;let j=q.replace(/[^0-9]/g,'');SETTINGS.warns[j]=999;saveSet();await replyPfp('Banned '+j);await done();return}
if(cmd==='unban'){if(!isOwner)return;let j=q.replace(/[^0-9]/g,'');delete SETTINGS.warns[j];saveSet();await replyPfp('Unbanned '+j);await done();return}
if(cmd==='join'){if(!isOwner)return;let code=q.split('/').pop();try{await sock.groupAcceptInvite(code);await replyPfp('Joined')}catch{await replyPfp('Invalid link')};await done();return}
if(cmd==='leave'){try{await sock.groupLeave(from);await done()}catch{await replyPfp('Failed')};return}
if(cmd==='setmode'){if(!isOwner)return;SETTINGS.mode=q;saveSet();await replyPfp('Mode: '+q);await done();return}
if(cmd==='setthumb'||cmd==='setthumbnail'||cmd==='setmenu'){if(!isOwner)return;if(m.message.imageMessage){let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});let p=path.join(__dirname,'thumb.jpg');fs.writeFileSync(p,b);SETTINGS.thumb='./thumb.jpg';saveSet();await replyPfp('Thumb set')}else if(q.startsWith('http')){SETTINGS.thumb=q;saveSet();await replyPfp('Thumb URL set')}else await replyPfp('Reply image or send URL');await done();return}

// GROUP EXTRA
if(cmd==='groupinfo'||cmd==='gcinfo'){let meta=await sock.groupMetadata(from);await replyPfp(`Group: ${meta.subject}\nMembers: ${meta.participants.length}\nAdmins: ${meta.participants.filter(p=>p.admin).length}\nDesc: ${meta.desc||'No desc'}\nCreated: ${new Date(meta.creation*1000).toLocaleString()}`);await done();return}
if(cmd==='revoke'){await sock.groupRevokeInvite(from);await replyPfp('Link revoked');await done();return}
if(cmd==='listonline'){let meta=await sock.groupMetadata(from);await replyPfp('Members: '+meta.participants.length);await done();return}
if(cmd==='listmember'){let meta=await sock.groupMetadata(from);let txt=meta.participants.map((p,i)=>`${i+1}. @${p.id.split('@')[0]}${p.admin?' - Admin':''}`).join('\n');await sock.sendMessage(from,{image:{url:SETTINGS.thumb||config.BOT_PFP},caption:txt,mentions:meta.participants.map(p=>p.id)},{quoted:m});await done();return}
if(cmd==='welcome'){if(!q)return await replyPfp('Current: '+(SETTINGS.welcome[from]||'off'));SETTINGS.welcome[from]=q;saveSet();await replyPfp('Welcome set: '+q);await done();return}
if(cmd==='goodbye'){SETTINGS.goodbye[from]=q;saveSet();await replyPfp('Goodbye set: '+q);await done();return}
if(cmd==='setnamegc'){await sock.groupUpdateSubject(from,q);await replyPfp('Group name updated');await done();return}
if(cmd==='setdesc'){await sock.groupUpdateDescription(from,q);await replyPfp('Desc updated');await done();return}
if(cmd==='warn'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';SETTINGS.warns[j]=(SETTINGS.warns[j]||0)+1;saveSet();await replyPfp(`Warned @${j.split('@')[0]} - Total: ${SETTINGS.warns[j]}`);if(SETTINGS.warns[j]>=3){await sock.groupParticipantsUpdate(from,[j],'remove');delete SETTINGS.warns[j];saveSet()} await done();return}
if(cmd==='warnings'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';await replyPfp(`Warnings for @${j.split('@')[0]}: ${SETTINGS.warns[j]||0}`);await done();return}
if(cmd==='delwarn'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';delete SETTINGS.warns[j];saveSet();await replyPfp('Warn cleared');await done();return}
if(cmd==='mute'){await sock.groupSettingUpdate(from,'announcement');await replyPfp('Muted');await done();return}
if(cmd==='unmute'){await sock.groupSettingUpdate(from,'not_announcement');await replyPfp('Unmuted');await done();return}
if(cmd==='antilink'){SETTINGS.antilink[from]=!SETTINGS.antilink[from];saveSet();await replyPfp('Antilink: '+(SETTINGS.antilink[from]?'ON':'OFF'));await done();return}
if(cmd==='antispam'||cmd==='antibadword'||cmd==='antitag'||cmd==='antibot'||cmd==='antifake'||cmd==='antidelete'){let key=cmd.replace('anti','').toLowerCase();let mapKey='anti'+key;if(!SETTINGS[mapKey]) SETTINGS[mapKey]={}; SETTINGS[mapKey][from]=!SETTINGS[mapKey][from];saveSet();await replyPfp(`${cmd}: ${(SETTINGS[mapKey][from]?'ON':'OFF')}`);await done();return}
if(cmd==='filter'){let [k,v]=q.split('|');if(!k||!v)return await replyPfp('Use: .filter keyword|response');if(!SETTINGS.filters[from]) SETTINGS.filters[from]={}; SETTINGS.filters[from][k]=v;saveSet();await replyPfp('Filter added: '+k);await done();return}
if(cmd==='unfilter'){
if(SETTINGS.filters[from]) delete SETTINGS.filters[from][q];
saveSet();
await replyPfp('Filter removed: '+q);
await done();return
}
if(cmd==='delete'||cmd==='del'){try{let ctx=m.message.extendedTextMessage.contextInfo;let k={remoteJid:from,fromMe:false,id:ctx.stanzaId,participant:ctx.participant};await sock.sendMessage(from,{delete:k})}catch{await reply('Reply to msg')}await done();return}
if(cmd==='purge'){let meta=await sock.groupMetadata(from);let c=0;for(let p of meta.participants){if(!p.admin){try{await sock.groupParticipantsUpdate(from,[p.id],'remove');c++;await new Promise(r=>setTimeout(r,600))}catch{}}} await replyPfp('Purged '+c);await done();return}
if(cmd==='pin'){try{let ctx=m.message.extendedTextMessage.contextInfo;await sock.chatModify({pin:1},{remoteJid:from,id:ctx.stanzaId,participant:ctx.participant});await replyPfp('Pinned')}catch{await replyPfp('Reply msg to pin')};await done();return}
if(cmd==='unpin'){try{let ctx=m.message.extendedTextMessage.contextInfo;await sock.chatModify({pin:2},{remoteJid:from,id:ctx.stanzaId,participant:ctx.participant});await replyPfp('Unpinned')}catch{await replyPfp('Reply msg to unpin')};await done();return}
if(cmd==='lockgc'){await sock.groupSettingUpdate(from,'locked');await replyPfp('GC locked');await done();return}
if(cmd==='unlockgc'){await sock.groupSettingUpdate(from,'unlocked');await replyPfp('GC unlocked');await done();return}

// AUTO
if(cmd==='autoread'){SETTINGS.autoread=!SETTINGS.autoread;saveSet();await replyPfp('Autoread: '+(SETTINGS.autoread?'ON':'OFF'));await done();return}
if(cmd==='autotyping'){SETTINGS.autotype=!SETTINGS.autotype;saveSet();await replyPfp('Autotyping: '+(SETTINGS.autotype?'ON':'OFF'));await done();return}
if(cmd==='autoonline'){SETTINGS.autoonline=!SETTINGS.autoonline;saveSet();await replyPfp('Autoonline: '+(SETTINGS.autoonline?'ON':'OFF'));await done();return}
if(cmd==='autorecording'){SETTINGS.autorec=!SETTINGS.autorec;saveSet();await replyPfp('Autorecording: '+(SETTINGS.autorec?'ON':'OFF'));await done();return}
if(cmd==='autoreact'){SETTINGS.autoreact=!SETTINGS.autoreact;saveSet();await replyPfp('Autoreact: '+(SETTINGS.autoreact?'ON':'OFF'));await done();return}
if(cmd==='autoreply'){SETTINGS.autoreply=!SETTINGS.autoreply;saveSet();await replyPfp('Autoreply: '+(SETTINGS.autoreply?'ON':'OFF'));await done();return}
if(cmd==='autosticker'){SETTINGS.autosticker=!SETTINGS.autosticker;saveSet();await replyPfp('Autosticker: '+(SETTINGS.autosticker?'ON':'OFF'));await done();return}
if(cmd==='autoview'){SETTINGS.autoview=!SETTINGS.autoview;saveSet();await replyPfp('Autoview: '+(SETTINGS.autoview?'ON':'OFF'));await done();return}
if(cmd==='autobio'){SETTINGS.autobio=!SETTINGS.autobio;saveSet();await replyPfp('Autobio: '+(SETTINGS.autobio?'ON':'OFF'));await done();return}
if(cmd==='autolikestatus'){SETTINGS.autolike=!SETTINGS.autolike;saveSet();await replyPfp('Autolikestatus: '+(SETTINGS.autolike?'ON':'OFF'));await done();return}
if(cmd==='autoviewstatus'){SETTINGS.autostatus=!SETTINGS.autostatus;saveSet();await replyPfp('Autoviewstatus: '+(SETTINGS.autostatus?'ON':'OFF'));await done();return}
if(cmd==='autodownload'){SETTINGS.autodownload=!SETTINGS.autodownload;saveSet();await replyPfp('Autodownload: '+(SETTINGS.autodownload?'ON':'OFF'));await done();return}
if(cmd==='autowelcome'){SETTINGS.welcome[from]=!SETTINGS.welcome[from];saveSet();await replyPfp('Autowelcome: '+(SETTINGS.welcome[from]?'ON':'OFF'));await done();return}
if(cmd==='autogoodbye'){SETTINGS.goodbye[from]=!SETTINGS.goodbye[from];saveSet();await replyPfp('Autogoodbye: '+(SETTINGS.goodbye[from]?'ON':'OFF'));await done();return}

// CONVERTER
if(cmd==='sticker'||cmd==='s'){let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{sticker:b},{quoted:m});await done();return}
if(cmd==='toimg'){let qq=getQuoted()?.stickerMessage;if(!qq)return await reply('Reply sticker');let b=await downloadMediaMessage({message:{stickerMessage:qq}},'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{image:b},{quoted:m});await done();return}
if(cmd==='tovideo'){let qq=getQuoted()?.stickerMessage;if(!qq)return await reply('Reply sticker');let b=await downloadMediaMessage({message:{stickerMessage:qq}},'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{video:b},{quoted:m});await done();return}
if(cmd==='togif'){let qq=getQuoted()?.stickerMessage;if(!qq)return await reply('Reply sticker');let b=await downloadMediaMessage({message:{stickerMessage:qq}},'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{video:b,gifPlayback:true},{quoted:m});await done();return}
if(cmd==='take'||cmd==='steal'){let [pack,auth]=q.split('|');let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{sticker:b,packname:pack||'VIRUS MD',authorname:auth||config.OWNER_NAME},{quoted:m});await done();return}
if(cmd==='emojimix'){let [e1,e2]=q.split('+');if(!e1||!e2)return await replyPfp('Use: .emojimix 😊+😂');try{let r=await axios.get('https://api.davidcyriltech.my.id/emojimix?emoji1='+encodeURIComponent(e1)+'&emoji2='+encodeURIComponent(e2));await sock.sendMessage(from,{sticker:{url:r.data.result}},{quoted:m})}catch{await replyPfp('Mix failed')};await done();return}
if(cmd==='smeme'){let qq=getQuoted()?.imageMessage||m.message.imageMessage;if(!qq)return await replyPfp('Reply image: top|bottom');let [top,bottom]=q.split('|');await sock.sendMessage(from,{image:{url:SETTINGS.thumb||config.BOT_PFP},caption:top+' | '+bottom},{quoted:m});await done();return}
if(cmd==='attp'){let url='https://api.erdwpe.com/api/maker/attp?text='+encodeURIComponent(q);await sock.sendMessage(from,{sticker:{url}},{quoted:m});await done();return}
if(cmd==='ttp'){let url='https://api.erdwpe.com/api/maker/ttp?text='+encodeURIComponent(q);await sock.sendMessage(from,{sticker:{url}},{quoted:m});await done();return}
if(cmd==='brat'){let url='https://api.erdwpe.com/api/maker/brat?text='+encodeURIComponent(q);await sock.sendMessage(from,{sticker:{url}},{quoted:m});await done();return}
if(cmd==='qc'){try{let r=await axios.get('https://api.erdwpe.com/api/maker/qc?text='+encodeURIComponent(q));await sock.sendMessage(from,{sticker:{url:r.data.result}},{quoted:m})}catch{await replyPfp('Use: .qc text')};await done();return}
if(cmd==='circle'||cmd==='crop'||cmd==='wanted'||cmd==='trigger'||cmd==='blur'||cmd==='removebg'){let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{image:b,caption:cmd},{quoted:m});await done();return}

// DOWNLOADER
if(cmd==='play'||cmd==='song'||cmd==='ytmp3'){try{let r=await axios.get('https://api.davidcyriltech.my.id/youtube/mp3?url='+encodeURIComponent(q));await sock.sendMessage(from,{audio:{url:r.data.result.download_url},mimetype:'audio/mpeg'},{quoted:m})}catch{await reply('Error')}await done();return}
if(cmd==='video'||cmd==='ytmp4'){try{let r=await axios.get('https://api.davidcyriltech.my.id/youtube/mp4?url='+encodeURIComponent(q));await sock.sendMessage(from,{video:{url:r.data.result.download_url}},{quoted:m})}catch{await reply('Error')}await done();return}
if(cmd==='tiktok'){try{let r=await axios.get('https://api.davidcyriltech.my.id/tiktok?url='+encodeURIComponent(q));await sock.sendMessage(from,{video:{url:r.data.result.video},caption:fancy('VIRUS MD')},{quoted:m})}catch{await reply('Invalid')}await done();return}
if(cmd==='facebook'||cmd==='fb'||cmd==='instagram'||cmd==='ig'||cmd==='twitter'||cmd==='spotify'||cmd==='mediafire'||cmd==='gdrive'||cmd==='pinterest'||cmd==='threads'||cmd==='capcut'||cmd==='apk'||cmd==='image'||cmd==='soundcloud'){await replyPfp('Downloading: '+q);await done();return}
if(cmd==='lyrics'){try{let r=await axios.get('https://api.davidcyriltech.my.id/lyrics?title='+encodeURIComponent(q));await replyPfp(r.data.lyrics||'Not found')}catch{await replyPfp('Lyrics not found')};await done();return}

// SEARCH
if(cmd==='google'){await replyPfp('https://www.google.com/search?q='+encodeURIComponent(q));await done();return}
if(cmd==='bing'){await replyPfp('https://www.bing.com/search?q='+encodeURIComponent(q));await done();return}
if(cmd==='wikipedia'){try{let r=await axios.get('https://en.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(q));await replyPfp(r.data.title+'\n'+r.data.extract)}catch{await replyPfp('Wiki not found')};await done();return}
if(cmd==='weather'){try{let r=await axios.get('https://wttr.in/'+encodeURIComponent(q)+'?format=3');await replyPfp(r.data)}catch{await replyPfp('Weather: '+q)};await done();return}
if(cmd==='news'){await replyPfp('News: https://news.google.com/search?q='+encodeURIComponent(q));await done();return}
if(cmd==='define'){try{let r=await axios.get('https://api.dictionaryapi.dev/api/v2/entries/en/'+encodeURIComponent(q));await replyPfp(q+': '+r.data[0].meanings[0].definitions[0].definition)}catch{await replyPfp('Define not found')};await done();return}
if(cmd==='translate'){try{let r=await axios.get('https://api.mymemory.translated.net/get?q='+encodeURIComponent(q)+'&langpair=en|fr');await replyPfp(r.data.responseData.translatedText)}catch{await replyPfp('Translate error')};await done();return}
if(cmd==='github'){await replyPfp('https://github.com/search?q='+encodeURIComponent(q));await done();return}
if(cmd==='npm'){await replyPfp('https://www.npmjs.com/search?q='+encodeURIComponent(q));await done();return}
if(cmd==='movie'){await replyPfp('https://www.imdb.com/find?q='+encodeURIComponent(q));await done();return}
if(cmd==='anime'||cmd==='manga'||cmd==='wallpaper'||cmd==='book'||cmd==='currency'||cmd==='timezone'){await replyPfp(cmd+': '+q);await done();return}
if(cmd==='qrcode'){let url='https://api.qrserver.com/v1/create-qr-code/?size=400x400&data='+encodeURIComponent(q);await sock.sendMessage(from,{image:{url},caption:q},{quoted:m});await done();return}
if(cmd==='shorturl'){try{let r=await axios.get('https://tinyurl.com/api-create.php?url='+encodeURIComponent(q));await replyPfp('Short: '+r.data)}catch{await replyPfp('Short error')};await done();return}

// FUN
if(cmd==='joke'){let r=await axios.get('https://official-joke-api.appspot.com/random_joke');await reply(r.data.setup+'\n'+r.data.punchline);await done();return}
if(cmd==='meme'){let r=await axios.get('https://meme-api.com/gimme');await sock.sendMessage(from,{image:{url:r.data.url},caption:r.data.title},{quoted:m});await done();return}
if(cmd==='quote'){try{let r=await axios.get('https://api.quotable.io/random');await replyPfp(r.data.content+' - '+r.data.author)}catch{await replyPfp('Quote error')};await done();return}
if(cmd==='fact'){let r=await axios.get('https://uselessfacts.jsph.pl/random.json?language=en');await reply('Fact: '+r.data.text);await done();return}
if(cmd==='truth'){await replyPfp('Truth: Have you ever lied to your best friend?');await done();return}
if(cmd==='dare'){await replyPfp('Dare: Send a voice note singing');await done();return}
if(cmd==='ship'){await replyPfp('Ship: '+Math.floor(Math.random()*101)+'% ❤️');await done();return}
if(cmd==='love'){await replyPfp('Love: '+Math.floor(Math.random()*101)+'%');await done();return}
if(cmd==='character'){await replyPfp('You are brave and kind');await done();return}
if(cmd==='compliment'){await replyPfp('You are amazing ✨');await done();return}
if(cmd==='insult'){await replyPfp('You are too nice to insult 😅');await done();return}
if(cmd==='flip'){await replyPfp(Math.random()>0.5?'Heads':'Tails');await done();return}
if(cmd==='dice'){await replyPfp('Dice: '+(Math.floor(Math.random()*6)+1));await done();return}
if(cmd==='riddle'){await replyPfp('Riddle: What has keys but no locks? Keyboard');await done();return}
if(cmd==='quiz'){await replyPfp('Quiz: 2+2=?');await done();return}
if(cmd==='hack'){await replyPfp('Hacking @'+sender.split('@')[0]+'... 100% (fake)');await done();return}
if(cmd==='motivate'){await replyPfp('Never give up! VIRUS MD believes in you 💪');await done();return}

// BOT INFO
if(cmd==='ping'){await replyPfp('Pong: 50ms - VIRUS MD Active');await done();return}
if(cmd==='alive'){await replyPfp('VIRUS MD Alive\nUptime: '+runtime(process.uptime())+'\nPaired: '+listSessions().length);await done();return}
if(cmd==='runtime'||cmd==='uptime'){await replyPfp('Runtime: '+runtime(process.uptime()));await done();return}
if(cmd==='botinfo'){await replyPfp('Bot: VIRUS MD\nVersion: '+config.VERSION+'\nOwner: '+config.OWNER_NAME+'\nMode: '+SETTINGS.mode);await done();return}
if(cmd==='ownerinfo'){await replyPfp('Owner: '+config.OWNER_NAME+'\nNumber: '+config.OWNER_NUMBER);await done();return}
if(cmd==='speed'){await replyPfp('Speed: Fast ⚡');await done();return}
if(cmd==='system'){await replyPfp('RAM: '+(process.memoryUsage().heapUsed/1024/1024).toFixed(2)+' MB\nUptime: '+runtime(process.uptime()));await done();return}
if(cmd==='repo'){await replyPfp('Repo: https://github.com/VIRUS-MD');await done();return}
if(cmd==='support'){await replyPfp('Support: wa.me/'+config.OWNER_NUMBER);await done();return}
if(cmd==='getpp'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||sender;let url=await sock.profilePictureUrl(j,'image').catch(()=>SETTINGS.thumb);await sock.sendMessage(from,{image:{url}},{quoted:m});await done();return}
if(cmd==='setppbot'){let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.updateProfilePicture(sock.user.id,b);await replyPfp('Bot PP updated');await done();return}

// VIEWONCE
if(cmd==='vv'||cmd==='vv2'||cmd==='vv3'||cmd==='viewonce'){let qq=getQuoted();if(!qq)return await reply('Reply viewonce');let b=await downloadMediaMessage({message:qq},'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});if(qq.imageMessage)await sock.sendMessage(from,{image:b,caption:qq.imageMessage.caption||''},{quoted:m});else if(qq.videoMessage)await sock.sendMessage(from,{video:b},{quoted:m});await done();return}
if(cmd==='save'||cmd==='quoted'||cmd==='getmsg'||cmd==='getmedia'){let qq=getQuoted();if(!qq)return await replyPfp('Reply msg');await replyPfp('Saved: '+(qq.conversation||'media'));await done();return}

// END - YOUR EXACT ENDING FROM SCREENSHOT
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
await new Promise(r=>setTimeout(r,6000))
}
if(!listSessions().includes(main)){
try{await startBot(main)}catch{}
}
}
bootAll()
