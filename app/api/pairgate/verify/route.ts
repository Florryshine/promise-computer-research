import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pairgateRequest } from "@/lib/pairgate";

export async function POST(request:Request){
 try{
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Sign in to verify these details."},{status:401});
  const body=await request.json();
  const kind=String(body.kind||"").toLowerCase();
  let payload:any;
  if(kind==="cable"){
   const provider=String(body.provider||"").toLowerCase();
   const smartcard=String(body.smartcard||"").trim();
   if(!["dstv","gotv","startimes"].includes(provider)||!/^\d{6,20}$/.test(smartcard))return NextResponse.json({error:"Choose a TV provider and enter a valid smartcard/IUC number."},{status:400});
   payload=await pairgateRequest("/cable/verify","POST",{provider_id:provider,smartcard});
  }else if(kind==="electricity"){
   const provider=String(body.provider||"").toLowerCase();
   const meterNumber=String(body.meterNumber||"").trim();
   const meterType=Number(body.meterType);
   if(!provider||!/^\d{1,20}$/.test(meterNumber)||![1,2].includes(meterType))return NextResponse.json({error:"Choose a disco, meter type and valid meter number."},{status:400});
   payload=await pairgateRequest("/electricity/verify","POST",{provider_id:provider,meter_number:meterNumber,meter_type:meterType});
  }else return NextResponse.json({error:"Unknown verification type."},{status:400});
  const data=payload?.data??payload;
  if(data?.test_mode===true)return NextResponse.json({ok:true,testMode:true,customerName:String(data.customer_name||"Test Customer")});
  if(data?.status===false)return NextResponse.json({ok:false,error:data.message||"Provider could not verify these details."},{status:422});
  return NextResponse.json({ok:Boolean(data?.status??true),customerName:String(data?.customer_name||""),message:String(data?.message||"Details verified.")});
 }catch(error){
  const message=error instanceof Error?error.message:"Provider verification failed.";
  return NextResponse.json({error:message},{status:502});
 }
}
