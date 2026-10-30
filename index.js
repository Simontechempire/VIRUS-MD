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

let SETTINGS={mode:'public',sudo:[],antilink:{},warns:{},filters:{},welcome:{}}
if(fs.existsSync('./settings.json')){try{SETTINGS=Object.assign(SETTINGS,JSON.parse(fs.readFileSync('./settings.json')))}catch{}}
const saveSet=()=>fs.writeFileSync('./settings.json',JSON.stringify(SETTINGS,null,2))

// ===== FANCY KEYBOARD MAP =====
const fancyMap={a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ꜰ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'ꜱ',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ',A:'ᴀ',B:'ʙ',C:'ᴄ',D:'ᴅ',E:'ᴇ',F:'ꜰ',G:'ɢ',H:'ʜ',I:'ɪ',J:'ᴊ',K:'ᴋ',L:'ʟ',M:'ᴍ',N:'ɴ',O:'ᴏ',P:'ᴘ',Q:'ǫ',R:'ʀ',S:'ꜱ',T:'ᴛ',U:'ᴜ',V:'ᴠ',W:'ᴡ',X:'x',Y:'ʏ',Z:'ᴢ','0':'0','1':'1','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9'}
const toFancy=t=>String(t).split('').map(c=>fancyMap[c]||c).join('')
const fancy=toFancy

// ===== PAIR API + DASHBOARD APIS =====
app.get('/pair',async(req,res)=>{
let number=(req.query.number||'').replace(/[^0-9]/g,'')
if(!number)return res.json({error:'?number=2348102350169 required'})
try{
let {state,saveCreds}=await getSession(number)
let sock=makeWASocket({logger:pino({level:'silent'}),auth:state,browser:Browsers.macOS('Chrome'),printQRInTerminal:false,syncFullHistory:false})
sock.ev.on('creds.update',saveCreds)
if(!state.creds.registered){
let code=await sock.requestPairingCode(number)
res.json({code})
console.log(`[PAIR] ${code} for ${number}`)
setTimeout(()=>{try{sock.ws.close()}catch{}},3000)
}else{
res.json({error:'Already paired. Delete session/'+number+' then re-pair'})
try{sock.ws.close()}catch{}
}
}catch(e){res.json({error:e.message})}
})
app.get('/sessions',(req,res)=>{let l=listSessions();res.json({count:l.length,sessions:l})})
app.get('/delete-session',(req,res)=>{let n=(req.query.number||'').replace(/[^0-9]/g,'');delSession(n);res.json({deleted:n})})
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public/index.html')))
app.listen(PORT,()=>console.log(`VIRUS MD Pair Site running on ${PORT}`))

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
getMessage:async()=>{return {conversation:'VIRUS MD'}}
})
sock.ev.on('creds.update',saveCreds)
sock.ev.on('connection.update',async(u)=>{
let {connection,lastDisconnect}=u
if(connection==='close'){
let reason=lastDisconnect?.error?.output?.statusCode
if(reason===DisconnectReason.loggedOut){delSession(number);console.log(`[AUTO-DELETE] ${number}`)}
else if(reason!==DisconnectReason.connectionReplaced){setTimeout(()=>startBot(number),3000)}
}
if(connection==='open'){
console.log(`✓ VIRUS MD CONNECTED: ${number}`)
if(number===config.OWNER_NUMBER.replace(/[^0-9]/g,'')){
try{await sock.sendMessage(sock.user.id,{image:{url:config.BOT_PFP},caption:`*${fancy(config.BOT_NAME)} ${fancy('Connected')}\n${fancy('Owner')}: ${config.OWNER_NAME}\n${fancy('Mode')}: ${SETTINGS.mode}\n${fancy('Paired')}: ${listSessions().length}`})}catch{}
}
}
})

sock.ev.on('messages.upsert',async({messages})=>{
try{
const m=messages[0]
if(!m?.message)return
if(m.key.remoteJid==='status@broadcast')return
let from=m.key.remoteJid
let isGroup=from.endsWith('@g.us')
let sender=m.key.participant||m.key.remoteJid
let sNorm=norm(sender)
let isOwner=m.key.fromMe||SETTINGS.sudo.includes(sNorm)||sNorm===config.OWNER_NUMBER.replace(/[^0-9]/g,'')
let body=m.message.conversation||m.message.extendedTextMessage?.text||m.message.imageMessage?.caption||m.message.videoMessage?.caption||m.message.documentMessage?.caption||m.message.buttonsResponseMessage?.selectedButtonId||m.message.listResponseMessage?.singleSelectReply?.selectedRowId||""
if(!body)return

if(isGroup&&SETTINGS.antilink[from]&&body.match(/https:\/\/chat.whatsapp.com|wa.me|t.me|discord.gg/i)){
try{
let meta=await sock.groupMetadata(from)
let isAdmin=meta.participants.find(p=>norm(p.id)===sNorm)?.admin
let isBotAdmin=meta.participants.find(p=>norm(p.id)===norm(sock.user.id))?.admin
if(!isAdmin&&isBotAdmin){await sock.sendMessage(from,{delete:m.key});await sock.groupParticipantsUpdate(from,[sender],'remove')}
}catch{}
}
if(SETTINGS.filters[from]){for(let k in SETTINGS.filters[from]){if(body.toLowerCase().includes(k.toLowerCase())){await sock.sendMessage(from,{text:SETTINGS.filters[from][k]},{quoted:m});break}}}
if(!body.startsWith(config.PREFIX))return

// ===== NEW FEATURE: REACT ⏳ WHEN CMD TYPED =====
try{await sock.sendMessage(from,{react:{text:'⏳',key:m.key}})}catch{}
await sock.sendPresenceUpdate('composing',{to:from})

let args=body.slice(config.PREFIX.length).trim().split(/\s+/),cmd=args.shift().toLowerCase(),q=args.join(" ")
const reply=async(t,opt={})=>{await sock.sendMessage(from,{text:fancy(t),...opt},{quoted:m})}
const doneReact=async()=>{try{await sock.sendMessage(from,{react:{text:'💀',key:m.key}})}catch{}}
const getQuoted=()=>m.message.extendedTextMessage?.contextInfo?.quotedMessage

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
│ • .ᴏᴡɴᴇʀ • .ꜱᴇᴛᴏᴡɴᴇʀ • .ꜱᴇᴛᴘʀᴇꜰɪx • .ꜱᴇᴛɴᴀᴍᴇ • .ꜱᴇᴛʙɪᴏ • .ꜱᴇᴛᴘᴘ • .ʀᴇꜱᴛᴀʀᴛ • .ꜱʜᴜᴛᴅᴏᴡɴ • .ʙʀᴏᴀᴅᴄᴀꜱᴛ • .ʙʟᴏᴄᴋ • .ᴜɴʙʟᴏᴄᴋ • .ᴄʟᴇᴀʀꜱᴇꜱꜱɪᴏɴ • .ᴘᴜʙʟɪᴄ • .ᴘʀɪᴠᴀᴛᴇ
└
┌ ─ 〔 ɢʀᴏᴜᴘ 〕
│ • .ɢʀᴏᴜᴘɪɴꜰᴏ • .ɢʀᴏᴜᴘʟɪɴᴋ • .ʀᴇᴠᴏᴋᴇ • .ᴛᴀɢᴀʟʟ • .ʜɪᴅᴇᴛᴀɢ • .ᴀᴅᴅ • .ʀᴇᴍᴏᴠᴇ • .ᴘʀᴏᴍᴏᴛᴇ • .ᴅᴇᴍᴏᴛᴇ • .ᴋɪᴄᴋ • .ᴏᴘᴇɴ • .ᴄʟᴏꜱᴇ • .ᴡᴀʀɴ • .ᴍᴜᴛᴇ • .ᴀɴᴛɪʟɪɴᴋ • .ᴅᴇʟᴇᴛᴇ
└
┌ ─ 〔 ᴄᴏɴᴠᴇʀᴛᴇʀ 〕 • .ꜱᴛɪᴄᴋᴇʀ • .ꜱ • .ᴛᴏɪᴍɢ • .ᴛᴀᴋᴇ • .ǫᴄ • .ʙʀᴀᴛ └
┌ ─ 〔 ᴅᴏᴡɴʟᴏᴀᴅᴇʀ 〕 • .ᴘʟᴀʏ • .ʏᴛᴍᴘ3 • .ʏᴛᴍᴘ4 • .ᴛɪᴋᴛᴏᴋ • .ꜰʙ • .ɪɢ └
┌ ─ 〔 ᴠɪᴇᴡᴏɴᴄᴇ 〕 • .ᴠᴠ • .ᴠᴠ2 • .ᴠᴠ3 • .ɢᴇᴛᴍꜱɢ └
> ᴘᴏᴡᴇʀ ʙʏ ᴠɪʀᴜꜱ ᴍᴅ • ʙʏ 404 ᴇʀʀᴏʀ`
try{await sock.sendMessage(from,{image:{url:config.BOT_PFP},caption:txt},{quoted:m})}catch{await reply(txt)}
await doneReact();return
}

if(cmd==='owner') {await reply(`Owner: ${config.OWNER_NAME}\nNumber: ${config.OWNER_NUMBER}`);await doneReact();return}
if(cmd==='ping'||cmd==='speed'){let t=Date.now();await reply('Pinging...');await reply(`Pong ${Date.now()-t}ms`);await doneReact();return}
if(cmd==='alive'){await reply(`${config.BOT_NAME} Alive\nMode: ${SETTINGS.mode}\nUptime: ${runtime(process.uptime())}`);await doneReact();return}
if(cmd==='runtime'||cmd==='uptime'){await reply(`Uptime: ${runtime(process.uptime())}`);await doneReact();return}
if(cmd==='botinfo'){await reply(`${config.BOT_NAME}\nVersion: ${config.VERSION}\nOwner: ${config.OWNER_NAME}\nPaired: ${listSessions().length}`);await doneReact();return}
if(cmd==='setprefix'){if(!isOwner)return;config.PREFIX=q;await reply(`Prefix: ${q}`);await doneReact();return}
if(cmd==='setname'){if(!isOwner)return;await sock.updateProfileName(q);await reply('Done');await doneReact();return}
if(cmd==='setbio'){if(!isOwner)return;await sock.updateProfileStatus(q);await reply('Done');await doneReact();return}
if(cmd==='setpp'||cmd==='setppbot'){if(!isOwner)return;let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.updateProfilePicture(sock.user.id,b);await reply('PP Updated');await doneReact();return}
if(cmd==='restart'){if(!isOwner)return;await reply('Restarting...');await doneReact();process.exit(0)}
if(cmd==='public'){if(!isOwner)return;SETTINGS.mode='public';saveSet();await reply('Mode Public');await doneReact();return}
if(cmd==='private'){if(!isOwner)return;SETTINGS.mode='private';saveSet();await reply('Mode Private');await doneReact();return}
if(cmd==='clearsession'){if(!isOwner)return;let n=q.replace(/[^0-9]/g,'')||number;delSession(n);await reply(`Deleted: ${n}`);await doneReact();return}
if(cmd==='block'){if(!isOwner)return;let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q+'@s.whatsapp.net';await sock.updateBlockStatus(j,'block');await reply('Blocked');await doneReact();return}
if(cmd==='unblock'){if(!isOwner)return;let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q+'@s.whatsapp.net';await sock.updateBlockStatus(j,'unblock');await reply('Unblocked');await doneReact();return}
if(cmd==='grouplink'){let c=await sock.groupInviteCode(from);await reply('https://chat.whatsapp.com/'+c);await doneReact();return}
if(cmd==='tagall'||cmd==='everyone'){let meta=await sock.groupMetadata(from);let txt=`Tag ${q||''}\n`+meta.participants.map(p=>`@${p.id.split('@')[0]}`).join('\n');await sock.sendMessage(from,{text:fancy(txt),mentions:meta.participants.map(p=>p.id)},{quoted:m});await doneReact();return}
if(cmd==='hidetag'){let meta=await sock.groupMetadata(from);await sock.sendMessage(from,{text:fancy(q||'Hidetag'),mentions:meta.participants.map(p=>p.id)},{quoted:m});await doneReact();return}
if(cmd==='kick'||cmd==='remove'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';await sock.groupParticipantsUpdate(from,[j],'remove');await reply('Kicked');await doneReact();return}
if(cmd==='add'){let j=q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';await sock.groupParticipantsUpdate(from,[j],'add');await doneReact();return}
if(cmd==='promote'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];await sock.groupParticipantsUpdate(from,[j],'promote');await reply('Promoted');await doneReact();return}
if(cmd==='demote'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];await sock.groupParticipantsUpdate(from,[j],'demote');await reply('Demoted');await doneReact();return}
if(cmd==='open'){await sock.groupSettingUpdate(from,'not_announcement');await reply('Group Opened');await doneReact();return}
if(cmd==='close'){await sock.groupSettingUpdate(from,'announcement');await reply('Group Closed');await doneReact();return}
if(cmd==='delete'||cmd==='del'){let k={remoteJid:from,fromMe:false,id:m.message.extendedTextMessage.contextInfo.stanzaId,participant:m.message.extendedTextMessage.contextInfo.participant};await sock.sendMessage(from,{delete:k});await doneReact();return}
if(cmd==='sticker'||cmd==='s'){let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{sticker:b},{quoted:m});await doneReact();return}
if(cmd==='toimg'){let qq=getQuoted()?.stickerMessage;let b=await downloadMediaMessage({message:{stickerMessage:qq}},'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{image:b},{quoted:m});await doneReact();return}
if(cmd==='vv'||cmd==='viewonce'){let qq=getQuoted();let type=Object.keys(qq)[0];let msg=qq[type]?.message||qq;let b=await downloadMediaMessage({message:msg},'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});if(msg.imageMessage)await sock.sendMessage(from,{image:b,caption:msg.imageMessage.caption||''},{quoted:m});if(msg.videoMessage)await sock.sendMessage(from,{video:b},{quoted:m});await doneReact();return}
if(cmd==='tiktok'){let r=await axios.get(`https://api.davidcyriltech.my.id/tiktok?url=${encodeURIComponent(q)}`);await sock.sendMessage(from,{video:{url:r.data.result.video},caption:fancy('VIRUS MD')},{quoted:m});await doneReact();return}
if(cmd==='ytmp3'||cmd==='play'){let r=await axios.get(`https://api.davidcyriltech.my.id/youtube/mp3?url=${encodeURIComponent(q)}`);await sock.sendMessage(from,{audio:{url:r.data.result.download_url},mimetype:'audio/mpeg'},{quoted:m});await doneReact();return}
if(cmd==='ytmp4'||cmd==='video'){let r=await axios.get(`https://api.davidcyriltech.my.id/youtube/mp4?url=${encodeURIComponent(q)}`);await sock.sendMessage(from,{video:{url:r.data.result.download_url}},{quoted:m});await doneReact();return}
if(cmd==='getpp'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||sender;let url=await sock.profilePictureUrl(j,'image');await sock.sendMessage(from,{image:{url}},{quoted:m});await doneReact();return}
if(cmd==='qrcode'){let url=`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(q)}`;await sock.sendMessage(from,{image:{url},caption:fancy(q)},{quoted:m});await doneReact();return}
if(cmd==='joke'){let r=await axios.get('https://official-joke-api.appspot.com/random_joke');await reply(`${r.data.setup}\n${r.data.punchline}`);await doneReact();return}
if(cmd==='meme'){let r=await axios.get('https://meme-api.com/gimme');await sock.sendMessage(from,{image:{url:r.data.url},caption:fancy(r.data.title)},{quoted:m});await doneReact();return}
if(cmd==='fact'){let r=await axios.get('https://uselessfacts.jsph.pl/random.json?language=en');await reply(`Fact: ${r.data.text}`);await doneReact();return}
if(cmd==='eval'){if(!isOwner)return;try{let ev=await eval(q);await reply(String(ev))}catch(e){await reply(e.message)}await doneReact();return}
if(cmd==='exec'){if(!isOwner)return;require('child_process').exec(q,(e,o)=>reply(e?e.message:o).then(doneReact));return}

await doneReact();
}catch(e){console.log('[MSG ERROR]',e.message);try{await sock.sendMessage(from,{react:{text:'💀',key:messages[0].key}})}catch{}}
})
}

let main=config.OWNER_NUMBER.replace(/[^0-9]/g,'')
startBot(main)
listSessions().forEach(n=>{if(n!==main)startBot(n)})
