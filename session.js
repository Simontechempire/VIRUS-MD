const fs=require('fs'),path=require('path')
const {useMultiFileAuthState}=require('@whiskeysockets/baileys')

const BASE=path.join(__dirname,'session')
if(!fs.existsSync(BASE)) fs.mkdirSync(BASE,{recursive:true})

async function getSession(number){
let clean=String(number).replace(/[^0-9]/g,'')
let dir=path.join(BASE,clean)
if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true})

// Auto-fix corrupted creds.json - main cause of Connection Close + Waiting for this message
let credsPath=path.join(dir,'creds.json')
if(fs.existsSync(credsPath)){
try{JSON.parse(fs.readFileSync(credsPath,'utf8'))}catch{
console.log('[FIX] Corrupted '+clean+' - deleting')
try{fs.rmSync(dir,{recursive:true,force:true})}catch{}
fs.mkdirSync(dir,{recursive:true})
}
}
let {state,saveCreds}=await useMultiFileAuthState(dir)
return {state,saveCreds}
}

function listSessions(){
if(!fs.existsSync(BASE)) return []
return fs.readdirSync(BASE).filter(f=>{
try{
let p=path.join(BASE,f)
return /^\d+$/.test(f) && fs.statSync(p).isDirectory() && fs.existsSync(path.join(p,'creds.json'))
}catch{return false}
})
}

function delSession(number){
let clean=String(number).replace(/[^0-9]/g,'')
let dir=path.join(BASE,clean)
if(fs.existsSync(dir)){
try{fs.rmSync(dir,{recursive:true,force:true});console.log('[DELETED] '+clean);return true}catch(e){return false}
}
return false
}

module.exports={getSession,listSessions,delSession}
