const axios=require('axios')
exports.runtime=(s)=>{s=Number(s);let d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),sc=Math.floor(s%60);return`${d}d ${h}h ${m}m ${sc}s`}
exports.norm=(j)=>{return (j||"").split('@')[0].split(':')[0].replace(/[^0-9]/g,'')}
exports.getBuffer=async(url)=>{let res=await axios.get(url,{responseType:'arraybuffer'});return Buffer.from(res.data)}
exports.fetchJson=async(url)=>{let res=await axios.get(url);return res.data}
