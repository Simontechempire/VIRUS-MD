const fs=require('fs'),path=require('path')
const {useMultiFileAuthState}=require('@whiskeysockets/baileys')

/**
 * VIRUS MD - Multi Device Session Manager
 * Owner: 404 error +2348102350169
 * Fix: No delay, auto-delete disconnected, multi-device support
 */

async function getSession(number){
try{
let clean=String(number).replace(/[^0-9]/g,'')
let dir=path.join(__dirname,'session',clean)
if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true})

// If creds.json corrupted, delete and recreate (fix Waiting for this message & pairing delay)
let credsPath=path.join(dir,'creds.json')
if(fs.existsSync(credsPath)){
try{JSON.parse(fs.readFileSync(credsPath))}catch{
console.log(`[VIRUS MD] Corrupted session ${clean} - deleting...`)
fs.rmSync(dir,{recursive:true,force:true})
fs.mkdirSync(dir,{recursive:true})
}
}

return await useMultiFileAuthState(dir)
}catch(e){
console.log(`[SESSION ERROR] ${number}: ${e.message}`)
let dir=path.join(__dirname,'session',String(number).replace(/[^0-9]/g,''))
if(fs.existsSync(dir))fs.rmSync(dir,{recursive:true,force:true})
fs.mkdirSync(dir,{recursive:true})
return await useMultiFileAuthState(dir)
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
return /^\d{10,}$/.test(f) && fs.statSync(full).isDirectory()
})
}catch{return []}
}

function delSession(number){
try{
let clean=String(number).replace(/[^0-9]/g,'')
let dir=path.join(__dirname,'session',clean)
if(fs.existsSync(dir)){
fs.rmSync(dir,{recursive:true,force:true})
console.log(`[VIRUS MD] ✓ DELETED DISCONNECTED SESSION: ${clean}`)
return true
}
return false
}catch(e){
console.log(`[DELETE ERROR] ${e.message}`)
return false
}
}

function clearAllSessions(exceptMain=null){
let sessions=listSessions()
let deleted=0
sessions.forEach(s=>{
if(exceptMain && s===exceptMain)return
if(delSession(s))deleted++
})
return deleted
}

function sessionExists(number){
let clean=String(number).replace(/[^0-9]/g,'')
let dir=path.join(__dirname,'session',clean)
return fs.existsSync(dir) && fs.existsSync(path.join(dir,'creds.json'))
}

function getSessionInfo(number){
let clean=String(number).replace(/[^0-9]/g,'')
let dir=path.join(__dirname,'session',clean)
let credsPath=path.join(dir,'creds.json')
if(!fs.existsSync(credsPath))return {exists:false,connected:false}
try{
let creds=JSON.parse(fs.readFileSync(credsPath))
return {exists:true,connected:!!creds.registered,number:clean,path:dir}
}catch{return {exists:false,connected:false,corrupted:true}}
}

module.exports={getSession,listSessions,delSession,clearAllSessions,sessionExists,getSessionInfo}
