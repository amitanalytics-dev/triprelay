import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const keys=["TBO_MODE","TBO_END_USER_IP","TBO_PROXY_URL","TBO_USERNAME","TBO_PASSWORD","TBO_AIR_USERNAME","TBO_AIR_PASSWORD","TBO_AIR_CLIENT_ID"];
function missing(values){return Array.isArray(values)?[...new Set(values.map(value=>keys.find(key=>typeof value==="string" && value.includes(key))??"unverified setting"))]:["unverified setting"];}
// Call only the deployed private readiness/authentication actions. Raw CLI
// output, tokens and environment values are never printed or saved.
export async function checkSupplierAccess(run){
  const connection=await run("tbo:connectionReadiness");
  if(typeof connection.hotels?.ready!=="boolean" || typeof connection.flights?.ready!=="boolean")throw Error("Unexpected readiness result.");
  const result={hotels:{configured:connection.hotels.ready,missing:missing(connection.hotels.missing),livePricingVerified:false},
    flights:{configured:connection.flights.ready,missing:missing(connection.flights.missing),authentication:"blocked",livePricingVerified:false}};
  if(connection.flights.ready){
    const probe=await run("tbo:verifyFlightAccess");
    if(!["blocked","authenticated","failed"].includes(probe.state) || probe.pricingVerified!==false)throw Error("Unexpected authentication result.");
    result.flights.authentication=probe.state;
    if(probe.state==="blocked")result.flights.missing=missing(probe.missing);
  }
  return result;
}
function deployed(name){
  const cli=path.join(root,"node_modules/convex/bin/main.js");
  const call=spawnSync(process.execPath,[cli,"run",name,"{}"],{cwd:root,encoding:"utf8",timeout:65000,windowsHide:true});
  if(call.status!==0)throw Error("Deployed check could not run.");
  return JSON.parse(call.stdout);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const result=await checkSupplierAccess(deployed);
    console.log(`Hotels: ${result.hotels.configured?"settings present; a real mapped hotel search/recheck is still required":"blocked — missing "+result.hotels.missing.join(", ")}.`);
    console.log(`Flights: ${result.flights.authentication}${result.flights.missing.length?" — missing "+result.flights.missing.join(", "):""}.`);
    console.log("No booking, ticket, price search or quote created. Supplier pricing and Main Flow remain unverified.");
    if(!result.hotels.configured || result.flights.authentication!=="authenticated")process.exitCode=2;
  }catch{console.error("Supplier access check could not be completed. Check Convex CLI access and deployed functions. No credentials were displayed.");process.exitCode=1;}
}
