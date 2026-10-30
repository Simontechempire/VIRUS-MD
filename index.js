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

let SETTINGS={mode:'public',sudo:[],antilink:{},warns:{},filters:{},welcome:{},goodbye:{},autolike:{},autoview:{},autoreact:{}}
if(fs.existsSync('./settings.json')){try{SETTINGS=Object.assign(SETTINGS,JSON.parse(fs.readFileSync('./settings.json')))}catch{}}
const saveSet=()=>fs.writeFileSync('./settings.json',JSON.stringify(SETTINGS,null,2))

// ===== FANCY =====
const fancyMap={a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ꜰ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'ꜱ',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ',A:'ᴀ',B:'ʙ',C:'ᴄ',D:'ᴅ',E:'ᴇ',F:'ꜰ',G:'ɢ',H:'ʜ',I:'ɪ',J:'ᴊ',K:'ᴋ',L:'ʟ',M:'ᴍ',N:'ɴ',O:'ᴏ',P:'ᴘ',Q:'ǫ',R:'ʀ',S:'ꜱ',T:'ᴛ',U:'ᴜ',V:'ᴠ',W:'ᴡ',X:'x',Y:'ʏ',Z:'ᴢ'}
const toFancy=t=>String(t).split('').map(c=>fancyMap[c]||c).join('')
const fancy=toFancy

// ===== PAIR + DASHBOARD =====
app.get('/pair',async(req,res)=>{
let number=(req.query.number||'').replace(/[^0-9]/g,'')
if(!number)return res.json({error:'?number=234... required'})
if(listSessions().includes(number)){
try{let {state}=await getSession(number);if(state.creds.registered)return res.json({error:`+${number} already paired! Delete first`})}catch{}
}
try{
let {state,saveCreds}=await getSession(number)
let sock=makeWASocket({logger:pino({level:'silent'}),auth:state,browser:Browsers.macOS('Chrome'),printQRInTerminal:false,syncFullHistory:false})
sock.ev.on('creds.update',saveCreds)
if(!state.creds.registered){
try{let code=await sock.requestPairingCode(number);res.json({code});console.log(`[PAIR] ${code} for ${number}`)}catch(e){res.json({error:e.message.includes('closed')?'Connection Closed - Wait 20 sec':e.message})}
setTimeout(()=>{try{sock.ws.close()}catch{}},8000)
}else{res.json({error:'Already paired'});try{sock.ws.close()}catch{}}
}catch(e){res.json({error:e.message})}
})
app.get('/sessions',(req,res)=>{let l=listSessions();res.json({count:l.length,sessions:l})})
app.get('/delete-session',(req,res)=>{let n=(req.query.number||'').replace(/[^0-9]/g,'');delSession(n);res.json({deleted:n})})
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public/index.html')))
app.listen(PORT,()=>console.log(`VIRUS MD running on ${PORT}`))

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
if(reason===DisconnectReason.loggedOut){delSession(number);console.log(`[AUTO-DELETE] ${number}`)}
else if(reason!==DisconnectReason.connectionReplaced){setTimeout(()=>startBot(number),3000)}
}
if(connection==='open'){
console.log(`✓ CONNECTED: ${number}`)
if(number===config.OWNER_NUMBER.replace(/[^0-9]/g,'')){
try{await sock.sendMessage(sock.user.id,{image:{url:config.BOT_PFP},caption:`*${fancy('VIRUS MD CONNECTED')}\n${fancy('Owner')}: ${config.OWNER_NAME}\n${fancy('Paired')}: ${listSessions().length}`})}catch{}
}
}
})

sock.ev.on('messages.upsert',async({messages})=>{
try{
const m=messages[0];if(!m?.message)return
if(m.key.remoteJid==='status@broadcast'){
if(SETTINGS.autoview[m.key.remoteJid]||SETTINGS.autolike[m.key.remoteJid]){try{await sock.readMessages([m.key])}catch{}}
return
}
let from=m.key.remoteJid,isGroup=from.endsWith('@g.us'),sender=m.key.participant||m.key.remoteJid,sNorm=norm(sender)
let isOwner=m.key.fromMe||SETTINGS.sudo.includes(sNorm)||sNorm===config.OWNER_NUMBER.replace(/[^0-9]/g,'')
let body=m.message.conversation||m.message.extendedTextMessage?.text||m.message.imageMessage?.caption||m.message.videoMessage?.caption||m.message.documentMessage?.caption||m.message.buttonsResponseMessage?.selectedButtonId||m.message.listResponseMessage?.singleSelectReply?.selectedRowId||""
if(!body)return

// antilink
if(isGroup&&SETTINGS.antilink[from]&&body.match(/https:\/\/chat.whatsapp.com|wa.me|t.me|discord.gg/i)){
try{let meta=await sock.groupMetadata(from);let isAdmin=meta.participants.find(p=>norm(p.id)===sNorm)?.admin;let isBotAdmin=meta.participants.find(p=>norm(p.id)===norm(sock.user.id))?.admin;if(!isAdmin&&isBotAdmin){await sock.sendMessage(from,{delete:m.key});await sock.groupParticipantsUpdate(from,[sender],'remove')}}catch{}
}
// filters
if(SETTINGS.filters[from]){for(let k in SETTINGS.filters[from]){if(body.toLowerCase().includes(k.toLowerCase())){await sock.sendMessage(from,{text:SETTINGS.filters[from][k]},{quoted:m});break}}}
// welcome/goodbye handled in participants update

if(!body.startsWith(config.PREFIX))return
try{await sock.sendMessage(from,{react:{text:'⏳',key:m.key}})}catch{}
try{await sock.sendPresenceUpdate('composing',{to:from})}catch{}

let args=body.slice(config.PREFIX.length).trim().split(/\s+/),cmd=args.shift().toLowerCase(),q=args.join(" ")
const reply=async(t,opt={})=>{await sock.sendMessage(from,{text:fancy(t),...opt},{quoted:m})}
const doneReact=async()=>{try{await sock.sendMessage(from,{react:{text:'💀',key:m.key}})}catch{}}
const getQuoted=()=>m.message.extendedTextMessage?.contextInfo?.quotedMessage

// ===== MENU =====
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
│ • .ᴏᴡɴᴇʀ • .ꜱᴇᴛᴏᴡɴᴇʀ • .ꜱᴇᴛᴘʀᴇꜰɪx • .ꜱᴇᴛɴᴀᴍᴇ • .ꜱᴇᴛʙɪᴏ • .ꜱᴇᴛᴘᴘ • .ʀᴇꜱᴛᴀʀᴛ • .ꜱʜᴜᴛᴅᴏᴡɴ • .ʙʀᴏᴀᴅᴄᴀꜱᴛ • .ʙʟᴏᴄᴋ • .ᴜɴʙʟᴏᴄᴋ • .ʙᴀɴ • .ᴜɴʙᴀɴ • .ᴇᴠᴀʟ • .ᴇxᴇᴄ • .ᴊᴏɪɴ • .ʟᴇᴀᴠᴇ • .ᴘᴜʙʟɪᴄ • .ᴘʀɪᴠᴀᴛᴇ • .ᴄʟᴇᴀʀꜱᴇꜱꜱɪᴏɴ • .ꜱᴇᴛᴍᴏᴅᴇ
└
┌ ─ 〔 ɢʀᴏᴜᴘ 〕
│ • .ɢʀᴏᴜᴘɪɴꜰᴏ • .ɢʀᴏᴜᴘʟɪɴᴋ • .ʀᴇᴠᴏᴋᴇ • .ᴛᴀɢᴀʟʟ • .ʜɪᴅᴇᴛᴀɢ • .ᴇᴠᴇʀʏᴏɴᴇ • .ʟɪꜱᴛᴏɴʟɪɴᴇ • .ʟɪꜱᴛᴍᴇᴍʙᴇʀ • .ᴀᴅᴅ • .ʀᴇᴍᴏᴠᴇ • .ᴘʀᴏᴍᴏᴛᴇ • .ᴅᴇᴍᴏᴛᴇ • .ᴋɪᴄᴋ • .ᴡᴇʟᴄᴏᴍᴇ • .ɢᴏᴏᴅʙʏᴇ • .ᴏᴘᴇɴ • .ᴄʟᴏꜱᴇ • .ꜱᴇᴛɴᴀᴍᴇɢᴄ • .ꜱᴇᴛᴅᴇꜱᴄ • .ᴡᴀʀɴ • .ᴡᴀʀɴɪɴɢꜱ • .ᴅᴇʟᴡᴀʀɴ • .ᴍᴜᴛᴇ • .ᴜɴᴍᴜᴛᴇ • .ᴀɴᴛɪʟɪɴᴋ • .ꜰɪʟᴛᴇʀ • .ᴜɴꜰɪʟᴛᴇʀ • .ᴅᴇʟᴇᴛᴇ • .ᴘᴜʀɢᴇ • .ᴘɪɴ • .ᴜɴᴘɪɴ
└
┌ ─ 〔 ᴀᴜᴛᴏ 〕
│ • .ᴀᴜᴛᴏʀᴇᴀᴅ • .ᴀᴜᴛᴏʟɪᴋᴇꜱᴛᴀᴛᴜꜱ • .ᴀᴜᴛᴏᴠɪᴇᴡꜱᴛᴀᴛᴜꜱ • .ᴀᴜᴛᴏʀᴇᴀᴄᴛ
└
┌ ─ 〔 ᴄᴏɴᴠᴇʀᴛᴇʀ 〕
│ • .ꜱᴛɪᴄᴋᴇʀ • .ꜱ • .ᴛᴏɪᴍɢ • .ᴛᴏᴠɪᴅᴇᴏ • .ᴛᴀᴋᴇ • .ᴇᴍᴏᴊɪᴍɪx • .ᴀᴛᴛᴘ • .ᴛᴛᴘ • .ʙʀᴀᴛ • .ǫᴄ • .ᴄɪʀᴄʟᴇ
└
┌ ─ 〔 ᴅᴏᴡɴʟᴏᴀᴅᴇʀ 〕
│ • .ᴘʟᴀʏ • .ꜱᴏɴɢ • .ᴠɪᴅᴇᴏ • .ʏᴛᴍᴘ3 • .ʏᴛᴍᴘ4 • .ᴛɪᴋᴛᴏᴋ • .ꜰʙ • .ɪɢ • .ᴛᴡɪᴛᴛᴇʀ • .ᴀᴘᴋ • .ɪᴍᴀɢᴇ • .ǫʀᴄᴏᴅᴇ
└
┌ ─ 〔 ꜱᴇᴀʀᴄʜ 〕
│ • .ɢᴏᴏɢʟᴇ • .ᴡɪᴋɪ • .ᴡᴇᴀᴛʜᴇʀ • .ᴛʀᴀɴꜱʟᴀᴛᴇ • .ɢɪᴛʜᴜʙ
└
┌ ─ 〔 ꜰᴜɴ 〕
│ • .ᴊᴏᴋᴇ • .ᴍᴇᴍᴇ • .ǫᴜᴏᴛᴇ • .ꜰᴀᴄᴛ • .ᴛʀᴜᴛʜ • .ᴅᴀʀᴇ • .ꜱʜɪᴘ • .ꜰʟɪᴘ • .ᴅɪᴄᴇ
└
┌ ─ 〔 ʙᴏᴛ ɪɴꜰᴏ 〕
│ • .ᴘɪɴɢ • .ᴀʟɪᴠᴇ • .ʀᴜɴᴛɪᴍᴇ • .ʙᴏᴛɪɴꜰᴏ • .ɢᴇᴛᴘᴘ • .ꜱᴘᴇᴇᴅ
└
┌ ─ 〔 ᴠɪᴇᴡᴏɴᴄᴇ 〕
│ • .ᴠᴠ • .ᴠᴠ2 • .ꜱᴀᴠᴇ • .ǫᴜᴏᴛᴇᴅ
└
> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴠɪʀᴜꜱ ᴍᴅ`
try{await sock.sendMessage(from,{image:{url:config.BOT_PFP},caption:txt},{quoted:m})}catch{await reply(txt)}
await doneReact();return
}

// ===== OWNER =====
if(cmd==='owner'||cmd==='ownerinfo'){await reply(`Owner: ${config.OWNER_NAME}\nNumber: ${config.OWNER_NUMBER}\nBot: ${config.BOT_NAME}\nMode: ${SETTINGS.mode}`);await doneReact();return}
if(cmd==='setowner'){if(!isOwner)return;let n=q.replace(/[^0-9]/g,'');SETTINGS.sudo.push(n);saveSet();await reply(`Added sudo: ${n}`);await doneReact();return}
if(cmd==='setprefix'||cmd==='setpref'){if(!isOwner)return;config.PREFIX=q;await reply(`Prefix set to ${q}`);await doneReact();return}
if(cmd==='setname'){if(!isOwner)return;await sock.updateProfileName(q);await reply('Name updated');await doneReact();return}
if(cmd==='setbio'){if(!isOwner)return;await sock.updateProfileStatus(q);await reply('Bio updated');await doneReact();return}
if(cmd==='setpp'||cmd==='setppbot'){if(!isOwner)return;let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.updateProfilePicture(sock.user.id,b);await reply('PP updated');await doneReact();return}
if(cmd==='restart'){if(!isOwner)return;await reply('Restarting...');await doneReact();process.exit(0)}
if(cmd==='shutdown'){if(!isOwner)return;await reply('Shutting down');await doneReact();process.exit(0)}
if(cmd==='broadcast'||cmd==='bc'){if(!isOwner)return;let chats=await sock.groupFetchAllParticipating();for(let id in chats){await sock.sendMessage(id,{text:fancy(q)});await new Promise(r=>setTimeout(r,1000))}await reply(`Broadcast to ${Object.keys(chats).length} groups`);await doneReact();return}
if(cmd==='block'){if(!isOwner)return;let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';await sock.updateBlockStatus(j,'block');await reply('Blocked');await doneReact();return}
if(cmd==='unblock'){if(!isOwner)return;let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';await sock.updateBlockStatus(j,'unblock');await reply('Unblocked');await doneReact();return}
if(cmd==='ban'){if(!isOwner)return;let j=q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';SETTINGS.sudo=SETTINGS.sudo.filter(x=>x!==q.replace(/[^0-9]/g,''));saveSet();await reply(`Banned ${q}`);await doneReact();return}
if(cmd==='unban'){if(!isOwner)return;await reply('Unbanned');await doneReact();return}
if(cmd==='eval'){if(!isOwner)return;try{let ev=await eval(q);await reply(String(ev))}catch(e){await reply(e.message)}await doneReact();return}
if(cmd==='exec'){if(!isOwner)return;require('child_process').exec(q,async(e,o)=>{await reply(e?e.message:o);await doneReact()});return}
if(cmd==='join'){if(!isOwner)return;let c=q.split('/').pop();await sock.groupAcceptInvite(c);await reply('Joined');await doneReact();return}
if(cmd==='leave'){if(isGroup)await sock.groupLeave(from);else await reply('Not a group');await doneReact();return}
if(cmd==='public'||cmd==='setmode'){if(!isOwner)return;SETTINGS.mode='public';saveSet();await reply('Mode public');await doneReact();return}
if(cmd==='private'){if(!isOwner)return;SETTINGS.mode='private';saveSet();await reply('Mode private');await doneReact();return}
if(cmd==='clearsession'){if(!isOwner)return;let n=q.replace(/[^0-9]/g,'')||number;delSession(n);await reply(`Deleted ${n}`);await doneReact();return}

// ===== GROUP =====
if(cmd==='groupinfo'||cmd==='gcinfo'){let meta=await sock.groupMetadata(from);await reply(`Name: ${meta.subject}\nMembers: ${meta.participants.length}\nAdmins: ${meta.participants.filter(p=>p.admin).length}\nDesc: ${meta.desc||'No desc'}`);await doneReact();return}
if(cmd==='grouplink'||cmd==='linkgc'){let code=await sock.groupInviteCode(from);await reply(`https://chat.whatsapp.com/${code}`);await doneReact();return}
if(cmd==='revoke'||cmd==='resetlink'){await sock.groupRevokeInvite(from);await reply('Link revoked');await doneReact();return}
if(cmd==='tagall'||cmd==='everyone'){let meta=await sock.groupMetadata(from);let txt=`*${fancy(q||'Tag All')}*\n`+meta.participants.map(p=>`@${p.id.split('@')[0]}`).join('\n');await sock.sendMessage(from,{text:fancy(txt),mentions:meta.participants.map(p=>p.id)},{quoted:m});await doneReact();return}
if(cmd==='hidetag'){let meta=await sock.groupMetadata(from);await sock.sendMessage(from,{text:fancy(q||'Hidetag'),mentions:meta.participants.map(p=>p.id)},{quoted:m});await doneReact();return}
if(cmd==='listonline'||cmd==='online'){let meta=await sock.groupMetadata(from);await reply(`Group has ${meta.participants.length} members`);await doneReact();return}
if(cmd==='listmember'||cmd==='members'){let meta=await sock.groupMetadata(from);await reply(meta.participants.map((p,i)=>`${i+1}. @${p.id.split('@')[0]}`).join('\n'),{mentions:meta.participants.map(p=>p.id)});await doneReact();return}
if(cmd==='add'){let j=q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';await sock.groupParticipantsUpdate(from,[j],'add');await doneReact();return}
if(cmd==='remove'||cmd==='kick'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||q.replace(/[^0-9]/g,'')+'@s.whatsapp.net';await sock.groupParticipantsUpdate(from,[j],'remove');await reply('Removed');await doneReact();return}
if(cmd==='promote'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];if(!j)return await reply('Tag user');await sock.groupParticipantsUpdate(from,[j],'promote');await reply('Promoted');await doneReact();return}
if(cmd==='demote'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];await sock.groupParticipantsUpdate(from,[j],'demote');await reply('Demoted');await doneReact();return}
if(cmd==='open'){await sock.groupSettingUpdate(from,'not_announcement');await reply('Group opened');await doneReact();return}
if(cmd==='close'){await sock.groupSettingUpdate(from,'announcement');await reply('Group closed');await doneReact();return}
if(cmd==='setnamegc'){await sock.groupUpdateSubject(from,q);await reply('GC name updated');await doneReact();return}
if(cmd==='setdesc'||cmd==='setdescription'){await sock.groupUpdateDescription(from,q);await reply('Description updated');await doneReact();return}
if(cmd==='welcome'){SETTINGS.welcome[from]=!SETTINGS.welcome[from];saveSet();await reply(`Welcome ${SETTINGS.welcome[from]?'ON':'OFF'}`);await doneReact();return}
if(cmd==='goodbye'){SETTINGS.goodbye[from]=!SETTINGS.goodbye[from];saveSet();await reply(`Goodbye ${SETTINGS.goodbye[from]?'ON':'OFF'}`);await doneReact();return}
if(cmd==='warn'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];if(!j)return await reply('Tag');SETTINGS.warns[j]=(SETTINGS.warns[j]||0)+1;saveSet();if(SETTINGS.warns[j]>=3){await sock.groupParticipantsUpdate(from,[j],'remove');SETTINGS.warns[j]=0;saveSet();await reply('Warn limit reached - kicked')}else await reply(`Warn ${SETTINGS.warns[j]}/3`);await doneReact();return}
if(cmd==='warnings'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||sender;await reply(`Warnings: ${SETTINGS.warns[j]||0}`);await doneReact();return}
if(cmd==='delwarn'||cmd==='resetwarn'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];SETTINGS.warns[j]=0;saveSet();await reply('Warnings cleared');await doneReact();return}
if(cmd==='mute'){await sock.groupSettingUpdate(from,'announcement');await reply('Muted');await doneReact();return}
if(cmd==='unmute'){await sock.groupSettingUpdate(from,'not_announcement');await reply('Unmuted');await doneReact();return}
if(cmd==='antilink'){SETTINGS.antilink[from]=!SETTINGS.antilink[from];saveSet();await reply(`Antilink ${SETTINGS.antilink[from]?'ON':'OFF'}`);await doneReact();return}
if(cmd==='filter'){let [k,...v]=q.split(' ');SETTINGS.filters[from]=SETTINGS.filters[from]||{};SETTINGS.filters[from][k]=v.join(' ');saveSet();await reply(`Filter ${k} added`);await doneReact();return}
if(cmd==='unfilter'){if(SETTINGS.filters[from])delete SETTINGS.filters[from][q];saveSet();await reply('Filter deleted');await doneReact();return}
if(cmd==='delete'||cmd==='del'){try{let k={remoteJid:from,fromMe:false,id:m.message.extendedTextMessage.contextInfo.stanzaId,participant:m.message.extendedTextMessage.contextInfo.participant};await sock.sendMessage(from,{delete:k})}catch{await reply('Reply to message to delete') }await doneReact();return}
if(cmd==='purge'){let meta=await sock.groupMetadata(from);let count=0;for(let p of meta.participants){if(!p.admin){try{await sock.groupParticipantsUpdate(from,[p.id],'remove');count++}catch{}}}await reply(`Purged ${count}`);await doneReact();return}
if(cmd==='pin'){let k=m.message.extendedTextMessage?.contextInfo?.stanzaId;await sock.sendMessage(from,{pin:{type:1,time:86400,key:{remoteJid:from,fromMe:false,id:k}}});await reply('Pinned');await doneReact();return}
if(cmd==='unpin'){let k=m.message.extendedTextMessage?.contextInfo?.stanzaId;await sock.sendMessage(from,{pin:{type:2,time:86400,key:{remoteJid:from,fromMe:false,id:k}}});await reply('Unpinned');await doneReact();return}

// ===== AUTO =====
if(cmd==='autolikestatus'){SETTINGS.autolike[from]=!SETTINGS.autolike[from];saveSet();await reply(`Auto like status ${SETTINGS.autolike[from]?'ON':'OFF'}`);await doneReact();return}
if(cmd==='autoviewstatus'||cmd==='autoview'){SETTINGS.autoview[from]=!SETTINGS.autoview[from];saveSet();await reply(`Auto view status ${SETTINGS.autoview[from]?'ON':'OFF'}`);await doneReact();return}
if(cmd==='autoreact'){SETTINGS.autoreact[from]=!SETTINGS.autoreact[from];saveSet();await reply(`Auto react ${SETTINGS.autoreact[from]?'ON':'OFF'}`);await doneReact();return}

// ===== CONVERTER =====
if(cmd==='sticker'||cmd==='s'){let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});if(!b)return await reply('Reply to image/video');await sock.sendMessage(from,{sticker:b},{quoted:m});await doneReact();return}
if(cmd==='toimg'){let qq=getQuoted()?.stickerMessage;if(!qq)return await reply('Reply to sticker');let b=await downloadMediaMessage({message:{stickerMessage:qq}},'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{image:b},{quoted:m});await doneReact();return}
if(cmd==='tovideo'){let qq=getQuoted()?.stickerMessage;let b=await downloadMediaMessage({message:{stickerMessage:qq}},'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{video:b},{quoted:m});await doneReact();return}
if(cmd==='take'||cmd==='steal'){let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});await sock.sendMessage(from,{sticker:b},{quoted:m});await doneReact();return}
if(cmd==='emojimix'){let [e1,e2]=q.split('+');let r=await axios.get(`https://api.davidcyriltech.my.id/emojimix?emoji1=${e1}&emoji2=${e2}`);await sock.sendMessage(from,{sticker:{url:r.data.result.url}},{quoted:m});await doneReact();return}
if(cmd==='attp'){let url=`https://api.davidcyriltech.my.id/attp?text=${encodeURIComponent(q)}`;await sock.sendMessage(from,{sticker:{url}},{quoted:m});await doneReact();return}
if(cmd==='ttp'){let url=`https://api.davidcyriltech.my.id/ttp?text=${encodeURIComponent(q)}`;await sock.sendMessage(from,{image:{url}},{quoted:m});await doneReact();return}
if(cmd==='brat'){let url=`https://api.davidcyriltech.my.id/brat?text=${encodeURIComponent(q)}`;await sock.sendMessage(from,{sticker:{url}},{quoted:m});await doneReact();return}
if(cmd==='qc'){let j=m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0]||sender;let r=await axios.post('https://api.davidcyriltech.my.id/qc',{text:q,avatar:await sock.profilePictureUrl(j,'image').catch(()=>config.BOT_PFP),username:norm(j)});await sock.sendMessage(from,{sticker:{url:r.data.result.url}},{quoted:m});await doneReact();return}
if(cmd==='circle'){let b=await downloadMediaMessage(m,'buffer',{},{logger:pino({level:'silent'}),reuploadRequest:sock.updateMediaMessage});let url=`https://api.davidcyriltech.my.id/circle?image=${encodeURIComponent(await sock.profilePictureUrl(sender,'image'))}`;await sock.sendMessage(from,{image:{url}},{quoted:m});await doneReact();return}

// ===== DOWNLOADER =====
if(cmd==='play'||cmd==='song'||cmd==='ytmp3'){try{let r=await axios.get(`https://api.davidcyriltech.my.id/youtube/mp3?url=${encodeURIComponent(q)}`);if(!r.data.result)return await reply('Not found');await sock.sendMessage(from,{audio:{url:r.data.result.download_url},mimetype:'audio/mpeg
