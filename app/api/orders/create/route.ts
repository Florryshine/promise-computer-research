import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getPairgateDataPlans,pairgateRequest} from "@/lib/pairgate";

const VTU_SLUGS=new Set(["airtime-recharge","data-subscription","dstv-subscription","gotv-subscription","startimes-subscription","electricity-bill","exam-pins","data-pins"]);
const clean=(v:unknown)=>String(v??"").trim();
function rows(payload:any):any[]{
 const data=payload?.data??payload;
 if(Array.isArray(data))return data;
 if(data&&typeof data==="object")for(const value of Object.values(data))if(Array.isArray(value))return value as any[];
 return [];
}

export async function POST(request:Request){
 try{
  const body=await request.json();
  const slug=clean(body.slug);
  const formData=body.form_data&&typeof body.form_data==="object"?body.form_data:{};
  const customerNote=clean(body.customer_note);
  if(!slug)return NextResponse.json({error:"Service is required."},{status:400});
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"You must be logged in."},{status:401});
  const admin=createAdminClient();
  const {data:service,error:serviceError}=await admin.from("services").select("id,slug,title,price,price_type,active").eq("slug",slug).eq("active",true).maybeSingle();
  if(serviceError)throw serviceError;
  if(!service)return NextResponse.json({error:"This service is no longer available."},{status:404});

  let finalAmount=VTU_SLUGS.has(slug)?Number(body.amount||0):service.price_type==="fixed"?Number(service.price||0):0;
  let verifiedFormData:Record<string,any>={...formData};

  if(slug==="airtime-recharge"){
   const network=clean(formData.network||formData.network_id).toLowerCase();
   const phone=clean(formData.phone_number||formData.mobile_number||formData.phone).replace(/\D/g,"");
   const airtimeAmount=Number(formData.amount||body.amount||0);
   if(!["mtn","airtel","glo","9mobile"].includes(network)||!(/^(0\d{10}|234\d{10})$/).test(phone)||airtimeAmount<50)return NextResponse.json({error:"Choose a supported network, enter a valid phone number and use at least ₦50."},{status:400});
   finalAmount=airtimeAmount;
   verifiedFormData={...verifiedFormData,network,phone_number:phone,provider_amount:String(airtimeAmount)};
  }

  if(slug==="data-subscription"){
   const network=clean(formData.network).toLowerCase();
   const selectedPlanId=clean(formData.provider_plan_id||formData.plan_id);
   if(!network||!selectedPlanId)return NextResponse.json({error:"Choose a network and data plan."},{status:400});
   const plans=await getPairgateDataPlans(network);
   const selected=plans.find(plan=>String(plan.id)===selectedPlanId);
   if(!selected)return NextResponse.json({error:"That data plan is no longer available. Refresh the list and choose another."},{status:409});
   finalAmount=selected.price;
   verifiedFormData={...verifiedFormData,network,network_id:String(selected.networkId??""),provider_plan_id:selected.id,plan_name:selected.name,provider_amount:String(selected.price),plan_validity:selected.validity};
  }

  if(["dstv-subscription","gotv-subscription","startimes-subscription"].includes(slug)){
   const provider=slug==="dstv-subscription"?"dstv":slug==="gotv-subscription"?"gotv":"startimes";
   const planId=clean(formData.provider_plan_id||formData.plan_id);
   const smartcard=clean(formData.smartcard||formData.smartcard_number||formData.iuc_number);
   if(!planId||!/^\d{6,20}$/.test(smartcard))return NextResponse.json({error:"Choose a TV package and enter a valid smartcard/IUC number."},{status:400});
   const planPayload=await pairgateRequest("/cable-plans","GET",{provider_id:provider});
   const plan=(rows(planPayload)).find((p:any)=>String(p.plan_id??p.id)===planId);
   if(!plan)return NextResponse.json({error:"That TV package is no longer available. Refresh and choose another."},{status:409});
   const verify=await pairgateRequest("/cable/verify","POST",{provider_id:provider,smartcard});
   const verification=verify?.data??verify;
   if(verification?.test_mode!==true&&verification?.status===false)return NextResponse.json({error:"Pairgate could not verify that smartcard/IUC number. Check the number and try again."},{status:422});
   const providerAmount=Number(plan.price);
   if(!Number.isFinite(providerAmount)||providerAmount<=0)return NextResponse.json({error:"Pairgate returned an invalid package price."},{status:502});
   finalAmount=providerAmount+1000;
   verifiedFormData={...verifiedFormData,provider_id:provider,provider_plan_id:planId,plan_name:String(plan.name||""),provider_amount:String(providerAmount),service_fee:"1000",smartcard,verified_customer_name:String(verification?.customer_name||"")};
  }

  if(slug==="electricity-bill"){
   const provider=clean(formData.provider_id||formData.disco_id).toLowerCase();
   const meterNumber=clean(formData.meter_number);
   const meterType=Number(formData.meter_type||formData.meter_type_id);
   const purchaseAmount=Number(formData.amount||0);
   if(!provider||!/^\d{1,20}$/.test(meterNumber)||![1,2].includes(meterType)||purchaseAmount<1000)return NextResponse.json({error:"Choose a disco, enter a valid meter number/type and use at least ₦1,000."},{status:400});
   const providerPayload=await pairgateRequest("/providers/electricity");
   if(!rows(providerPayload).some((p:any)=>String(p.slug||"").toLowerCase()===provider))return NextResponse.json({error:"Choose a valid electricity provider."},{status:400});
   const verify=await pairgateRequest("/electricity/verify","POST",{provider_id:provider,meter_number:meterNumber,meter_type:meterType});
   const verification=verify?.data??verify;
   if(verification?.test_mode!==true&&verification?.status===false)return NextResponse.json({error:"Pairgate could not verify that meter. Check the provider, meter number and meter type."},{status:422});
   finalAmount=purchaseAmount+500;
   verifiedFormData={...verifiedFormData,provider_id:provider,meter_number:meterNumber,meter_type:meterType,provider_amount:String(purchaseAmount),service_fee:"500",verified_customer_name:String(verification?.customer_name||"")};
  }

  if(slug==="exam-pins"){
   const provider=clean(formData.exam_type||formData.provider_id).toLowerCase();
   const quantity=Number(formData.quantity||1);
   if(!["waec","neco","nabt"].includes(provider)||!Number.isInteger(quantity)||quantity<1||quantity>10)return NextResponse.json({error:"Choose WAEC, NECO or NABTEB and a quantity from 1 to 10."},{status:400});
   if(service.price_type!=="fixed"||Number(service.price||0)<=0)return NextResponse.json({error:"Exam PIN selling price is not configured. Set the service's fixed price per PIN before accepting payment."},{status:503});
   const providerPayload=await pairgateRequest("/providers/education");
   if(!rows(providerPayload).some((p:any)=>String(p.slug||"").toLowerCase()===provider))return NextResponse.json({error:"Pairgate does not currently list that exam provider."},{status:400});
   finalAmount=Number(service.price)*quantity;
   verifiedFormData={...verifiedFormData,provider_id:provider,quantity,provider_amount:String(finalAmount),unit_price:String(service.price)};
  }

  if(slug==="data-pins"){
   const network=clean(formData.network||formData.provider_id).toLowerCase();
   const denomination=Number(formData.denomination||0);
   const quantity=Number(formData.quantity||1);
   if(!["mtn","airtel","glo","9mobile"].includes(network)||!Number.isInteger(quantity)||quantity<1||quantity>10)return NextResponse.json({error:"Choose a supported network and quantity from 1 to 10."},{status:400});
   const payload=await pairgateRequest("/recharge-pins/denominations","GET",{provider_id:network});
   const denominations=rows(payload);
   if(!denominations.some((p:any)=>Number(p.denomination??p.amount??p.value)===denomination))return NextResponse.json({error:"That denomination is not currently available for this network."},{status:409});
   finalAmount=denomination*quantity;
   verifiedFormData={...verifiedFormData,network,provider_id:network,denomination,quantity,provider_amount:String(finalAmount),unit_price:String(denomination)};
  }

  if(!Number.isFinite(finalAmount)||finalAmount<=0)return NextResponse.json({error:"Invalid order amount."},{status:400});
  const reference="PCR-"+Date.now().toString().slice(-10);
  const {data:order,error:insertError}=await admin.from("orders").insert({
   reference,customer_id:user.id,service_id:service.id,status:"pending",payment_status:"unpaid",
   amount:finalAmount,customer_note:customerNote||null,form_data:verifiedFormData
  }).select("id").single();
  if(insertError)throw insertError;
  return NextResponse.json({id:order.id,amount:finalAmount});
 }catch(error){
  const message=error instanceof Error?error.message:"Could not create the service request.";
  return NextResponse.json({error:message},{status:500});
 }
}
