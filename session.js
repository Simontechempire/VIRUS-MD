const fs=require('fs'),path=require('path')
const {useMultiFileAuthState}=require('@whiskeysockets/baileys')

/**
 * VIRUS MD - Multi Device Session Manager ULTRA
 * Owner: 404 error +2348102350169
 * Features: Multi-device unlimited, auto-delete disconnected, no delay
 */

async function getSession(number){
let clean=String(number).replace(/[^0-9]/g,'')
let dir=path.join(__dirname,'session',clean)

try{
if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true})

// Fix corrupted creds.json = cause of Waiting msg & pairing delay
let credsPath=path.join(dir,'creds.json')
if(fs.existsSync(credsPath)){
try{
let data=fs.readFileSync(credsPath,'utf8')
JSON.parse(data)
}catch{
console.log(`[VIRUS MD] ⚠️ Corrupted session ${clean} - auto deleting...`)
fs.rmSync(dir,{recursive:true,force:true})
fs.mkdirSync(dir,{recursive:true})
}
}

let {state,saveCreds}=await useMultiFileAuthState(dir)
return {state,saveCreds,dir}

}catch(e){
console.log(`[SESSION ERROR] ${clean}: ${e.message}`)
try{
if(fs.existsSync(dir)) fs.rmSync(dir,{recursive:true,force:true})
fs.mkdirSync(dir,{recursive:true})
let {state,saveCreds}=await useMultiFileAuthState(dir)
return {state,saveCreds,dir}
}catch(err){
throw err
}
}
}

function listSessions(){
let base=path.join(__dirname,'session')
if(!fs.existsSync(base)){
fs.mkdirSync(base,{recursive:true})
return []
}
try{
return fs.readdirSync(base).filter(f=>{
let full=path.join(base,f)
try{
return /^\d{8,15}$/.test(f) && fs.statSync(full).isDirectory() && fs.existsSync(path.join(full,'creds.json'))
}catch{return false}
})
}catch{
return []
}
}

function delSession(number){
try{
let clean=String(number).replace(/[^0-9]/g,'')
let dir=path.join(__dirname,'session',clean)
if(fs.existsSync(dir)){
fs.rmSync(dir,{recursive:true,force:true})
console.log(`[VIRUS MD] ✓ AUTO-DELETED DISCONNECTED: ${clean}`)
return true
}
console.log(`[VIRUS MD] Session ${clean} not found`)
return false
}catch(e){
console.log(`[DELETE ERROR] ${e.message}`)
return false
}
}

function clearAllSessions(exceptMain=null){
let sessions=listSessions()
let deleted=0
let mainClean=exceptMain?String(exceptMain).replace(/[^0-9]/g,''):null
sessions.forEach(s=>{
if(mainClean && s===mainClean) return
if(delSession(s)) deleted++
})
console.log(`[VIRUS MD] Cleared ${deleted} sessions`)
return deleted
}

function sessionExists(number){
let clean=String(number).replace(/[^0-9]/g,'')
let dir=path.join(__dirname,'session',clean)
return fs.existsSync(path.join(dir,'creds.json'))
}

function getSessionInfo(number){
let clean=String(number).replace(/[^0-9]/g,'')
let dir=path.join(__dirname,'session',clean)
let credsPath=path.join(dir,'creds.json')
if(!fs.existsSync(dir)) return {exists:false,connected:false,number:clean}
if(!fs.existsSync(credsPath)) return {exists:true,connected:false,empty:true,number:clean}
try{
let creds=JSON.parse(fs.readFileSync(credsPath,'utf8'))
return {exists:true,connected:!!creds.registered,number:clean,path:dir,registered:!!creds.registered}
}catch{
return {exists:true,connected:false,corrupted:true,number:clean}
}
}

module.exports={getSession,listSessions,delSession,clearAllSessions,sessionExists,getSessionInfo}
