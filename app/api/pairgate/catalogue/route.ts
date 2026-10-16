import { NextResponse } from "next/server";
import { pairgateRequest } from "@/lib/pairgate";

export const dynamic = "force-dynamic";
const clean=(v:unknown)=>String(v??"").trim();
function rows(payload:any):any[]{
 const data=payload?.data??payload;
 if(Array.isArray(data))return data;
 if(data&&typeof data==="object"){
  for(const value of Object.values(data))if(Array.isArray(value))return value as any[];
 }
 return [];
}
export async function GET(request:Request){
 try{
  const url=new URL(request.url);
  const kind=clean(url.searchParams.get("kind")).toLowerCase();
  const provider=clean(url.searchParams.get("provider")).toLowerCase();
  if(kind==="cable"){
   if(!["dstv","gotv","startimes"].includes(provider))return NextResponse.json({error:"Choose a valid TV provider."},{status:400});
   const payload=await pairgateRequest("/cable-plans","GET",{provider_id:provider});
   const plans=rows(payload).map((p:any)=>({id:clean(p.plan_id??p.id),name:clean(p.name??p.plan_name),price:Number(p.price)})).filter((p:any)=>p.id&&p.name&&Number.isFinite(p.price)&&p.price>0);
   return NextResponse.json({plans},{headers:{"Cache-Control":"no-store"}});
  }
  if(kind==="electricity"||kind==="education"){
   const payload=await pairgateRequest("/providers/"+kind);
   const providers=rows(payload).map((p:any)=>{const rawId=clean(p.slug??p.id);const name=clean(p.name);if(kind==="education"){const identity=(rawId+" "+name).toLowerCase();const canonical=identity.includes("waec")?"waec":identity.includes("neco")?"neco":identity.includes("nabteb")||identity.includes("nabt")?"nabt":rawId;return {id:canonical,name};}return {id:rawId,name};}).filter((p:any)=>p.id&&p.name);
   return NextResponse.json({providers},{headers:{"Cache-Control":"no-store"}});
  }
  if(kind==="epin"){
   const payload=await pairgateRequest("/recharge-pins/denominations","GET",provider?{provider_id:provider}:undefined);
   const denominations=rows(payload).map((p:any)=>({value:Number(p.denomination??p.amount??p.value),label:clean(p.description)||("₦"+Number(p.denomination??p.amount??p.value).toLocaleString()+" recharge PIN")})).filter((p:any)=>Number.isFinite(p.value)&&p.value>0);
   return NextResponse.json({denominations},{headers:{"Cache-Control":"no-store"}});
  }
  return NextResponse.json({error:"Unknown catalogue type."},{status:400});
 }catch(error){
  const message=error instanceof Error?error.message:"Pairgate catalogue request failed.";
  return NextResponse.json({error:message},{status:502});
 }
}
