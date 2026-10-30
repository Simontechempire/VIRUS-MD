const fs=require('fs'),path=require('path')
const {useMultiFileAuthState}=require('@whiskeysockets/baileys')
async function getSession(number){
let dir=path.join(__dirname,'session',number)
if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true})
return await useMultiFileAuthState(dir)
}
function listSessions(){
let base=path.join(__dirname,'session')
if(!fs.existsSync(base))return []
return fs.readdirSync(base).filter(f=>/^\d+$/.test(f))
}
function delSession(number){
let dir=path.join(__dirname,'session',number)
if(fs.existsSync(dir))fs.rmSync(dir,{recursive:true,force:true})
}
module.exports={getSession,listSessions,delSession}
