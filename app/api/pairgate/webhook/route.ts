import crypto from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request:Request){
 try{
  const raw=await request.text();
  const secret=process.env.PAIRGATE_WEBHOOK_SECRET?.trim();
  if(secret){
   const signature=request.headers.get("x-pairgate-signature")||request.headers.get("x-webhook-signature")||"";
   const expected=crypto.createHmac("sha256",secret).update(raw).digest("hex");
   const a=Buffer.from(signature),b=Buffer.from(expected);
   if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return new NextResponse("Invalid signature",{status:401});
  }
  const event=JSON.parse(raw);
  const referenceCode=String(event.reference_code||"").trim();
  if(!referenceCode)return NextResponse.json({received:true});
  const admin=createAdminClient();
  const {data:tx,error}=await admin.from("provider_transactions").select("request_id,order_id,status,response").eq("provider_reference",referenceCode).maybeSingle();
  if(error)throw error;
  if(!tx)return NextResponse.json({received:true});
  const status=String(event.status||"").toLowerCase();
  if(!["successful","success","completed","failed","failure"].includes(status))return NextResponse.json({received:true});
  const successful=["successful","success","completed"].includes(status);
  const {data:order,error:orderError}=await admin.from("orders").select("id,customer_id,reference,form_data,services(title)").eq("id",tx.order_id).maybeSingle();
  if(orderError)throw orderError;
  if(!order)return NextResponse.json({received:true});
  const formData={...(order.form_data||{}),provider_delivery:{
   event:String(event.event||""),status:successful?"successful":"failed",message:String(event.message||""),
   item:String(event.item||event.plan||""),recipient:String(event.recipient||""),pin:event.pin?String(event.pin):null,
   completed_at:event.completed_at||new Date().toISOString()
  }};
  const {error:updateTxError}=await admin.from("provider_transactions").update({
   status:successful?"successful":"failed",provider_status:String(event.message||status),response:{...(tx.response||{}),webhook:event}
  }).eq("request_id",tx.request_id);
  if(updateTxError)throw updateTxError;
  const {error:updateOrderError}=await admin.from("orders").update({
   status:successful?"completed":"needs_information",form_data:formData,
   admin_note:successful?"Pairgate confirmed delivery via webhook.":"Pairgate reported a failed transaction: "+String(event.message||"No message").slice(0,400)
  }).eq("id",order.id);
  if(updateOrderError)throw updateOrderError;
  if(order.customer_id)await admin.from("notifications").insert({
   user_id:order.customer_id,title:successful?"Order completed":"Order needs attention",
   message:successful?"Pairgate completed order "+order.reference+". Open your order details to view any token or PIN.":"Pairgate reported a failed transaction for order "+order.reference+". Please contact support if your provider wallet has not been refunded."
  });
  return NextResponse.json({received:true});
 }catch(error){
  console.error("Pairgate webhook processing error",error);
  return new NextResponse("Webhook processing failed",{status:500});
 }
}
