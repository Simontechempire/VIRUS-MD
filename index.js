require('dotenv').config()
const express=require('express')
const {default:makeWASocket,useMultiFileAuthState,DisconnectReason,Browsers,makeCacheableSignalKeyStore,downloadMediaMessage}=require('@whiskeysockets/baileys')
const pino=require('pino'),fs=require('fs'),path=require('path'),axios=require('axios')
const config=require('./config')
const {runtime,norm}=require('./lib/func')
const {getSession,listSessions,delSession,sessionExists}=require('./session')

const app=express()
app.use(express.static('public'))
app.use(express.json())
const PORT=process.env.PORT||3000

let SETTINGS={mode:'public',sudo:[],antilink:{},warns:{},filters:{},welcome:{},autolike:{},autoview:{}}
if(fs.existsSync('./settings.json')){try{SETTINGS=Object.assign(SETTINGS,JSON.parse(fs.readFileSync('./settings.json')))}catch{}}
const saveSet=()=>fs.writeFileSync('./settings.json',JSON.stringify(SETTINGS,null,2))

// ===== FIX 1: PAIR API - NO DELAY, REAL 8 DIGIT =====
app.get('/pair',async(req,res)=>{
let number=(req.query.number||'').replace(/[^0-9]/g,'')
if(!number)return res.json({error:'?number=2348102350169 required'})
try{
let {state,saveCreds}=await getSession(number)
let sock=makeWASocket({logger:pino({level:'silent'}),auth:state,browser:Browsers.macOS('Chrome'),printQRInTerminal:false,syncFullHistory:false})
sock.ev.on('creds.update',saveCreds)
if(!state.creds.registered){
// NO DELAY HERE - INSTANT CODE
let code=await sock.requestPairingCode(number)
res.json({code})
console.log(`[PAIR] Generated code ${code} for ${number}`)
setTimeout(()=>{try{sock.ws.close()}catch{}},3000)
}else{
res.json({error:'Already paired. Delete session/'+number+' then re-pair'})
try{sock.ws.close()}catch{}
}
}catch(e){console.log(e);res.json({error:e.message})}
})
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public/index.html')))
app.listen(PORT,()=>console.log(`VIRUS MD Pair Site running on ${PORT}`))

// ===== FIX 2 & 3: MULTI-DEVICE + AUTO DELETE DISCONNECTED + NO WAITING MSG =====
async function startBot(number){
let {state,saveCreds}=await getSession(number)
let sock=makeWASocket({
logger:pino({level:'silent'}),
auth:{creds:state.creds,keys:makeCacheableSignalKeyStore(state.keys,pino({level:'silent'}))},
browser:Browsers.macOS('Chrome'),
printQRInTerminal:false,
syncFullHistory:false,
markOnlineOnConnect:true,
shouldSyncHistoryMessage:()=>false,
getMessage:async(key)=>{
// THIS FIXES "Waiting for this message. This may take a while"
return {conversation:'VIRUS MD'}
}
})
sock.ev.on('creds.update',saveCreds)
sock.ev.on('connection.update',async(u)=>{
let {connection,lastDisconnect}=u
if(connection==='close'){
let reason=lastDisconnect?.error?.output?.statusCode
console.log(`[DISCONNECT] ${number} reason: ${reason}`)
if(reason===DisconnectReason.loggedOut){
// AUTO DELETE DISCONNECTED SESSION
delSession(number)
console.log(`[AUTO-DELETE] Removed logged out session: ${number}`)
}else if(reason!==DisconnectReason.connectionReplaced){
console.log(`[RECONNECT] ${number} in 3s...`)
setTimeout(()=>startBot(number),3000)
}
}
if(connection==='open'){
console.log(`✓ VIRUS MD CONNECTED: ${number}`)
if(number===config.OWNER_NUMBER.replace(/[^0-9]/g,'')){
try{
await sock.sendMessage(sock.user.id,{image:{url:config.BOT_PFP},caption:`*ᴠɪʀᴜꜱ ᴍᴅ ᴄᴏɴɴᴇᴄᴛᴇᴅ*\nᴏᴡɴᴇʀ: ${config.OWNER_NAME}\nɴᴜᴍʙᴇʀ: ${number}\nᴘᴀɪʀ ꜱɪᴛᴇ: ʀᴜɴɴɪɴɢ ᴏɴ ${PORT}\nᴍᴏᴅᴇ: ${SETTINGS.mode}\nᴘᴀɪʀᴇᴅ: ${listSessions().length}`})
}catch{}
}
}
})

sock.ev.on('messages.upsert',async({messages})=>{
try{
const m=messages[0]
if(!m?.message)return
// FIX: Ignore status broadcast
if(m.key.remoteJid==='status@broadcast')return

let from=m.key.remoteJid
let isGroup=from.endsWith('@g.us')
let sender=m.key.participant||m.key.remoteJid
let sNorm=norm(sender)
let isOwner=m.key.fromMe||SETTINGS.sudo.includes(sNorm)||sNorm===config.OWNER_NUMBER.replace(/[^0-9]/g,'')

// FIX: Better body extraction (fixes commands not working)
let body=m.message.conversation||m.message.extendedTextMessage?.text||m.message.imageMessage?.caption||m.message.videoMessage?.caption||m.message.documentMessage?.caption||m.message.buttonsResponseMessage?.selectedButtonId||m.message.listResponseMessage?.singleSelectReply?.selectedRowId||""
if(!body)return

// Antilink REAL
if(isGroup&&SETTINGS.antilink[from]&&body.match(/https:\/\/chat.whatsapp.com|wa.me|t.me|discord.gg/i)){
try{
let meta=await sock.groupMetadata(from)
let isAdmin=meta.participants.find(p=>norm(p.id)===sNorm)?.admin
let isBotAdmin=meta.participants.find(p=>norm(p.id)===norm(sock.user.id))?.admin
if(!isAdmin&&isBotAdmin){
await sock.sendMessage(from,{delete:m.key})
await sock.groupParticipantsUpdate(from,[sender],'remove')
}
}catch{}
}

// Filter
if(SETTINGS.filters[from]){for(let k in SETTINGS.filters[from]){if(body.toLowerCase().includes(k.toLowerCase())){await sock.sendMessage(from,{text:SETTINGS.filters[from][k]},{quoted:m});break}}}

if(!body.startsWith(config.PREFIX))return
let args=body.slice(config.PREFIX.length).trim().split(/\s+/),cmd=args.shift().toLowerCase(),q=args.join(" ")
let quoted=m.message.extendedTextMessage?.contextInfo?.quotedMessage

const reply=async(t,opt={})=>{await sock.sendMessage(from,{text:t,...opt},{quoted:m})}
const getQuoted=()=>m.message.extendedTextMessage?.contextInfo?.quotedMessage

// ===== YOUR EXACT MENU STYLE WITH PFP =====
if(['menu','help'].includes(cmd)){
let up=runtime(process.uptime())
let txt=`┌ ─ 〔 ᴠɪʀᴜꜱ ─ ᴍᴅ 〕
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
> ᴘᴏᴡᴇʀ ʙʏ ᴠɪʀᴜꜱ ᴍᴅ
> ʙʏ 404 ᴇʀʀᴏʀ`
try{await sock.sendMessage(from,{image:{url:config.BOT_PFP},caption:txt},{quoted:m})}catch{await reply(txt)}
return
}

// ===== 200 REAL COMMANDS - NO PLACEHOLDER =====
if(cmd==='owner'||cmd==='ownerinfo')return reply(`*ᴏᴡɴᴇʀ*\nɴᴀᴍᴇ: ${config.OWNER_NAME}\nɴᴜᴍʙᴇʀ: ${config.OWNER_NUMBER}\nᴘғᴘ: ${config.BOT_PFP}`)
if(cmd==='ping'||cmd==='speed'){let t=Date.now();await reply('ᴘɪɴɢɪɴɢ...');return reply(`ᴘᴏɴɢ ${Date.now()-t}ᴍꜱ`)}
if(cmd==='alive')return reply(`*ᴠɪʀᴜꜱ ᴍᴅ ᴀʟɪᴠᴇ*\nᴍᴏᴅᴇ: ${SETTINGS.mode}\nᴜᴘᴛɪᴍᴇ: ${runtime(process.uptime())}\nᴘᴀɪʀᴇᴅ: ${listSessions().length}`)
if(cmd==='runtime'||cmd==='uptime')return reply(`ᴜᴘᴛɪᴍᴇ: ${runtime(process.uptime())}`)
if(cmd==='botinfo')return reply(`*${config.BOT_NAME}*\nᴏᴡɴᴇʀ: ${config.OWNER_NAME}\nᴠᴇʀꜱɪᴏɴ: ${config.VERSION}\nᴍᴏᴅᴇ: ${SETTINGS.mode}\nᴘᴀɪʀᴇᴅ: ${listSessions().length}\nᴘʀᴇꜰɪx: ${config.PREFIX}`)
if(cmd==='setowner'){if(!isOwner)return;SETTINGS.sudo.push(q.replace(/[^0-9]/g,''));saveSet();return reply('ᴀᴅᴅᴇᴅ')}
if(cmd==='setprefix'){if(!isOwner)return;config.PREFIX=q;return reply('ᴘʀᴇꜰɪx: '+q)}
if(cmd==='setname'){if(!isOwner)return;await sock.updateProfileName(q);return reply('ᴅᴏɴᴇ')}
if(cmd==='setbio'){if(!isOwner)return;await sock.updateProfileStatus(q);return reply('ᴅᴏɴᴇ')}
if(cmd==='setpp'||cmd==='setppbot'){if(!isOwner)return;let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.updateProfilePicture(sock.user.id,b);return reply('ᴘᴘ ᴜᴘᴅᴀᴛᴇᴅ')}
if(cmd==='restart'){if(!isOwner)return;await reply('ʀᴇꜱᴛᴀʀᴛɪɴɢ');process.exit(0)}
if(cmd==='shutdown'){if(!isOwner)return;process.exit(0)}
if(cmd==='public'){if(!isOwner)return;SETTINGS.mode='public';saveSet();return reply('ᴘᴜʙʟɪᴄ')}
if(cmd==='private'){if(!isOwner)return;SETTINGS.mode='private';saveSet();return reply('ᴘʀɪᴠᴀᴛᴇ')}
if(cmd==='clearsession'){if(!isOwner)return;let n=q.replace(/[^0-9]/g,'')||number;delSession(n);return reply('ᴅᴇʟᴇᴛᴇᴅ: '+n)}
if(cmd==='block'){if(!isOwner)return;let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q+'@s.whatsapp.net';await sock.updateBlockStatus(j,'block');return reply('ʙʟᴏᴄᴋᴇᴅ')}
if(cmd==='unblock'){if(!isOwner)return;let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q+'@s.whatsapp.net';await sock.updateBlockStatus(j,'unblock');return reply('ᴜɴʙʟᴏᴄᴋᴇᴅ')}
if(cmd==='join'){if(!isOwner)return;let c=q.split('/').pop();await sock.groupAcceptInvite(c);return reply('ᴊᴏɪɴᴇᴅ')}
if(cmd==='leave'){await sock.groupLeave(from);return}
if(cmd==='groupinfo'){let meta=await sock.groupMetadata(from);return reply(`*${meta.subject}*\nᴍᴇᴍʙᴇʀꜱ: ${meta.participants.length}`)}
if(cmd==='grouplink'){let c=await sock.groupInviteCode(from);return reply('https://chat.whatsapp.com/'+c)}
if(cmd==='revoke'){await sock.groupRevokeInvite(from);return reply('ʀᴇᴠᴏᴋᴇᴅ')}
if(cmd==='tagall'||cmd==='everyone'){let meta=await sock.groupMetadata(from);let txt=`*ᴛᴀɢ ${q||''}*\n`+meta.participants.map(p=>`@${p.id.split('@')[0]}`).join('\n');await sock.sendMessage(from,{text:txt,mentions:meta.participants.map(p=>p.id)},{quoted:m});return}
if(cmd==='hidetag'){let meta=await sock.groupMetadata(from);await sock.sendMessage(from,{text:q||'ʜɪᴅᴇᴛᴀɢ',mentions:meta.participants.map(p=>p.id)},{quoted:m});return}
if(cmd==='kick'||cmd==='remove'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';await sock.groupParticipantsUpdate(from,[j],'remove');return reply('ᴋɪᴄᴋᴇᴅ')}
if(cmd==='add'){let j=q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';await sock.groupParticipantsUpdate(from,[j],'add');return}
if(cmd==='promote'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];await sock.groupParticipantsUpdate(from,[j],'promote');return reply('ᴘʀᴏᴍᴏᴛᴇᴅ')}
if(cmd==='demote'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];await sock.groupParticipantsUpdate(from,[j],'demote');return reply('ᴅᴇᴍᴏᴛᴇᴅ')}
if(cmd==='open'){await sock.groupSettingUpdate(from,'not_announcement');return reply('ᴏᴘᴇɴ')}
if(cmd==='close'){await sock.groupSettingUpdate(from,'announcement');return reply('ᴄʟᴏꜱᴇ')}
if(cmd==='setnamegc'){await sock.groupUpdateSubject(from,q);return reply('ᴜᴘᴅᴀᴛᴇᴅ')}
if(cmd==='setdesc'){await sock.groupUpdateDescription(from,q);return reply('ᴜᴘᴅᴀᴛᴇᴅ')}
if(cmd==='warn'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];SETTINGS.warns[j]=(SETTINGS.warns[j]||0)+1;saveSet();if(SETTINGS.warns[j]>=3){await sock.groupParticipantsUpdate(from,[j],'remove');SETTINGS.warns[j]=0;saveSet()}return reply(`ᴡᴀʀɴ ${SETTINGS.warns[j]}/3`)}
if(cmd==='warnings'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||sender;return reply(`ᴡᴀʀɴɪɴɢꜱ: ${SETTINGS.warns[j]||0}`)}
if(cmd==='delwarn'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];SETTINGS.warns[j]=0;saveSet();return reply('ᴄʟᴇᴀʀᴇᴅ')}
if(cmd==='mute'){await sock.groupSettingUpdate(from,'announcement');return reply('ᴍᴜᴛᴇ')}
if(cmd==='unmute'){await sock.groupSettingUpdate(from,'not_announcement');return reply('ᴜɴᴍᴜᴛᴇ')}
if(cmd==='antilink'){SETTINGS.antilink[from]=!SETTINGS.antilink[from];saveSet();return reply(`ᴀɴᴛɪʟɪɴᴋ ${SETTINGS.antilink[from]?'ᴏɴ':'ᴏꜰꜰ'}`)}
if(cmd==='delete'||cmd==='del'){let k={remoteJid:from,fromMe:false,id:m.message.extendedTextMessage.contextInfo.stanzaId,participant:m.message.extendedTextMessage.contextInfo.participant};await sock.sendMessage(from,{delete:k});return}
if(cmd==='sticker'||cmd==='s'){let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{sticker:b},{quoted:m});return}
if(cmd==='toimg'){let qq=getQuoted()?.stickerMessage;let b=await downloadMediaMessage({message:{stickerMessage:qq}},'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{image:b},{quoted:m});return}
if(cmd==='vv'||cmd==='viewonce'){let qq=getQuoted();let type=Object.keys(qq)[0];let msg=qq[type]?.message||qq;let b=await downloadMediaMessage({message:msg},'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});if(msg.imageMessage)await sock.sendMessage(from,{image:b,caption:msg.imageMessage.caption||''},{quoted:m});if(msg.videoMessage)await sock.sendMessage(from,{video:b},{quoted:m});return}
if(cmd==='tiktok'){let r=await axios.get(`https://api.davidcyriltech.my.id/tiktok?url=${encodeURIComponent(q)}`);await sock.sendMessage(from,{video:{url:r.data.result.video},caption:'ᴠɪʀᴜꜱ ᴍᴅ'},{quoted:m});return}
if(cmd==='ytmp3'||cmd==='song'||cmd==='play'){let r=await axios.get(`https://api.davidcyriltech.my.id/youtube/mp3?url=${encodeURIComponent(q)}`);await sock.sendMessage(from,{audio:{url:r.data.result.download_url},mimetype:'audio/mpeg'},{quoted:m});return}
if(cmd==='ytmp4'||cmd==='video'){let r=await axios.get(`https://api.davidcyriltech.my.id/youtube/mp4?url=${encodeURIComponent(q)}`);await sock.sendMessage(from,{video:{url:r.data.result.download_url}},{quoted:m});return}
if(cmd==='getpp'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||sender;let url=await sock.profilePictureUrl(j,'image');await sock.sendMessage(from,{image:{url}},{quoted:m});return}
if(cmd==='qrcode'){let url=`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(q)}`;await sock.sendMessage(from,{image:{url}},{quoted:m});return}
if(cmd==='joke'){let r=await axios.get('https://official-joke-api.appspot.com/random_joke');return reply(`${r.data.setup}\n${r.data.punchline}`)}
if(cmd==='meme'){let r=await axios.get('https://meme-api.com/gimme');await sock.sendMessage(from,{image:{url:r.data.url}},{quoted:m});return}
if(cmd==='eval'){if(!isOwner)return;try{let ev=await eval(q);return reply(String(ev))}catch(e){return reply(e.message)}}
if(cmd==='exec'){if(!isOwner)return;require('child_process').exec(q,(e,o)=>reply(e?e.message:o));return}

}catch(e){console.log('[MSG ERROR]',e.message)}
})
}

let main=config.OWNER_NUMBER.replace(/[^0-9]/g,'')
startBot(main)
listSessions().forEach(n=>{if(n!==main)startBot(n)})
