#!/usr/bin/env node
import{a as s}from"./chunk-JIBOQ54U.js";import{b as c,e as d}from"./chunk-V6XMUU4P.js";var l=c(e=>{Object.defineProperty(e,"__esModule",{value:!0});e.getMachineId=void 0;var u=s(),a=d();async function o(){try{let i=(await(0,u.execAsync)('ioreg -rd1 -c "IOPlatformExpertDevice"')).stdout.split(`
`).find(r=>r.includes("IOPlatformUUID"));if(!i)return;let n=i.split('" = "');if(n.length===2)return n[1].slice(0,-1)}catch(t){a.diag.debug(`error reading machine id: ${t}`)}}e.getMachineId=o});export default l();
