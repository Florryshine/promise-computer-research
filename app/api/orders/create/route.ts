import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getPairgateDataPlans,pairgateRequest} from "@/lib/pairgate";

const VTU_SLUGS=new Set(["airtime-recharge","data-subscription","dstv-subscription","gotv-subscription","startimes-subscription","electricity-bill","exam-pins","data-pins"]);
const clean=(v:unknown)=>String(v??"").trim();
const serviceFee=(amount:number,rate:number)=>Math.ceil(amount*rate/100);
const EXAM_PIN_PRICES:Record<string,number>={waec:5800,neco:2200,nabt:1500};
const JAMB_SERVICE_PRICES:Record<string,number>={"jamb-admission-letter-portal":3000,"jamb-admission-letter-no-portal":4000,"jamb-original-result-portal":2500,"jamb-original-result-no-portal":3500,"jamb-original-result-printing":2500,"jamb-admission-letter-printing":3000,"jamb-admission-status-checking":1000,"jamb-reprinting":1000,"jamb-olevel-screenshot":1000,"jamb-email-phone-screenshot":1000,"jamb-profile-code-retrieval":1000,"jamb-registration-number-retrieval":1000,"jamb-indemnity-form":1000};
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
  const {data:service,error:serviceError}=await admin.from("services").select("id,slug,title,category,price,price_type,active").eq("slug",slug).eq("active",true).maybeSingle();
  if(serviceError)throw serviceError;
  if(!service)return NextResponse.json({error:"This service is no longer available."},{status:404});

  let finalAmount=VTU_SLUGS.has(slug)?Number(body.amount||0):(String(service.category||"").trim().toUpperCase()==="JAMB"&&slug!=="jamb-services"?(JAMB_SERVICE_PRICES[slug]??(service.price_type==="fixed"?Number(service.price||0):1000)):JAMB_SERVICE_PRICES[slug]??(service.price_type==="fixed"?Number(service.price||0):0));
  let verifiedFormData:Record<string,any>={...formData};

  if(slug==="airtime-recharge"){
   const network=clean(formData.network||formData.network_id).toLowerCase();
   const phone=clean(formData.phone_number||formData.mobile_number||formData.phone).replace(/\D/g,"");
   const airtimeAmount=Number(formData.amount||body.amount||0);
   if(!["mtn","airtel","glo","9mobile"].includes(network)||!(/^(0\d{10}|234\d{10})$/).test(phone)||airtimeAmount<50)return NextResponse.json({error:"Choose a supported network, enter a valid phone number and use at least ₦50."},{status:400});
   const fee=serviceFee(airtimeAmount,3);
   finalAmount=airtimeAmount+fee;
   verifiedFormData={...verifiedFormData,network,phone_number:phone,provider_amount:String(airtimeAmount),service_fee:String(fee),service_fee_rate:"3%"};
  }

  if(slug==="data-subscription"){
   const network=clean(formData.network).toLowerCase();
   const selectedPlanId=clean(formData.provider_plan_id||formData.plan_id);
   if(!network||!selectedPlanId)return NextResponse.json({error:"Choose a network and data plan."},{status:400});
   const plans=await getPairgateDataPlans(network);
   const selected=plans.find(plan=>String(plan.id)===selectedPlanId);
   if(!selected)return NextResponse.json({error:"That data plan is no longer available. Refresh the list and choose another."},{status:409});
   const fee=serviceFee(selected.price,5);
   finalAmount=selected.price+fee;
   verifiedFormData={...verifiedFormData,network,network_id:String(selected.networkId??""),provider_plan_id:selected.id,plan_name:selected.name,provider_amount:String(selected.price),plan_validity:selected.validity,service_fee:String(fee),service_fee_rate:"5%"};
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
   const fee=serviceFee(providerAmount,5);
   finalAmount=providerAmount+fee;
   verifiedFormData={...verifiedFormData,provider_id:provider,provider_plan_id:planId,plan_name:String(plan.name||""),provider_amount:String(providerAmount),service_fee:String(fee),service_fee_rate:"5%",smartcard,verified_customer_name:String(verification?.customer_name||"")};
  }

  if(slug==="electricity-bill"){
   const provider=clean(formData.provider_id||formData.disco_id).toLowerCase();
   const meterNumber=clean(formData.meter_number);
   const meterType=Number(formData.meter_type||formData.meter_type_id);
   const purchaseAmount=Number(formData.amount||0);
   if(!provider||!/^\d{1,20}$/.test(meterNumber)||![1,2].includes(meterType)||purchaseAmount<1000)return NextResponse.json({error:"Choose a disco, enter a valid meter number/type and use at least ₦1,000."},{status:400});
   const providerPayload=await pairgateRequest("/providers/electricity");
   if(!rows(providerPayload).some((p:any)=>String(p.slug??p.id??"").toLowerCase()===provider))return NextResponse.json({error:"Choose a valid electricity provider."},{status:400});
   const verify=await pairgateRequest("/electricity/verify","POST",{provider_id:provider,meter_number:meterNumber,meter_type:meterType});
   const verification=verify?.data??verify;
   if(verification?.test_mode!==true&&verification?.status===false)return NextResponse.json({error:"Pairgate could not verify that meter. Check the provider, meter number and meter type."},{status:422});
   const fee=serviceFee(purchaseAmount,5);
   finalAmount=purchaseAmount+fee;
   verifiedFormData={...verifiedFormData,provider_id:provider,meter_number:meterNumber,meter_type:meterType,provider_amount:String(purchaseAmount),service_fee:String(fee),service_fee_rate:"5%",verified_customer_name:String(verification?.customer_name||"")};
  }

  if(slug==="exam-pins"){
   const canonicalExamProvider=(value:unknown)=>{
    const text=clean(value).toLowerCase();
    if(text.includes("waec"))return "waec";
    if(text.includes("neco"))return "neco";
    if(text.includes("nabteb")||text==="nabt")return "nabt";
    return "";
   };
   const submittedProvider=clean(formData.exam_type||formData.provider_id).toLowerCase();
   const quantity=Number(formData.quantity||1);
   if(!Number.isInteger(quantity)||quantity<1||quantity>10)return NextResponse.json({error:"Choose WAEC, NECO or NABTEB and a quantity from 1 to 10."},{status:400});
   const providerPayload=await pairgateRequest("/providers/education");
   const providers=rows(providerPayload);
   // Accept canonical slugs from the form, or resolve a provider ID from Pairgate
   // to its name. Provider IDs are not guaranteed to be "waec", "neco" or "nabt".
   const matchedProvider=providers.find((p:any)=>{
    const identity=String(p.slug??p.id??"").toLowerCase();
    const name=String(p.name??"").toLowerCase();
    return identity===submittedProvider||name===submittedProvider||
      canonicalExamProvider(identity)===canonicalExamProvider(submittedProvider)||
      canonicalExamProvider(name)===canonicalExamProvider(submittedProvider);
   });
   // Prices are fixed by PCR, so a Pairgate catalogue label/ID mismatch must
   // never turn a priced exam PIN into a zero-amount quote order.
   const provider=canonicalExamProvider(submittedProvider)||canonicalExamProvider(matchedProvider?.name)||canonicalExamProvider(matchedProvider?.slug);
   if(!provider)return NextResponse.json({error:"Choose WAEC, NECO or NABTEB."},{status:400});
   const unitPrice=EXAM_PIN_PRICES[provider]||0;
   if(unitPrice<=0)return NextResponse.json({error:"No selling price is configured for this exam PIN type."},{status:503});
   const providerAmount=unitPrice*quantity;
   const fee=serviceFee(providerAmount,5);
   finalAmount=providerAmount+fee;
   // Preserve the actual provider ID returned by Pairgate when available, but
   // keep exam_type canonical for PCR pricing and fulfilment validation.
   const pairgateProviderId=clean(matchedProvider?.slug??matchedProvider?.id??provider);
   verifiedFormData={...verifiedFormData,exam_type:provider,provider_id:pairgateProviderId,quantity,provider_amount:String(providerAmount),unit_price:String(unitPrice),service_fee:String(fee),service_fee_rate:"5%"};
  }

  if(slug==="data-pins"){
   const network=clean(formData.network||formData.provider_id).toLowerCase();
   const denomination=Number(formData.denomination||0);
   const quantity=Number(formData.quantity||1);
   if(!["mtn","airtel","glo","9mobile"].includes(network)||!Number.isInteger(quantity)||quantity<1||quantity>10)return NextResponse.json({error:"Choose a supported network and quantity from 1 to 10."},{status:400});
   const payload=await pairgateRequest("/epin/denominations","GET",{provider_id:network});
   const denominations=rows(payload);
   if(!denominations.some((p:any)=>Number(p.denomination??p.amount??p.value)===denomination))return NextResponse.json({error:"That denomination is not currently available for this network."},{status:409});
   const providerAmount=denomination*quantity;
   const fee=serviceFee(providerAmount,5);
   finalAmount=providerAmount+fee;
   verifiedFormData={...verifiedFormData,network,provider_id:network,denomination,quantity,provider_amount:String(providerAmount),unit_price:String(denomination),service_fee:String(fee),service_fee_rate:"5%"};
  }

  const requiresQuote=!VTU_SLUGS.has(slug)&&finalAmount===0&&(service.price_type!=="fixed"||Number(service.price||0)<=0);
  if(!Number.isFinite(finalAmount)||finalAmount<0||(finalAmount===0&&!requiresQuote))return NextResponse.json({error:"Invalid order amount."},{status:400});
  const reference="PCR-"+Date.now().toString().slice(-10);
  const {data:order,error:insertError}=await admin.from("orders").insert({
   reference,customer_id:user.id,service_id:service.id,status:"pending",payment_status:"unpaid",
   amount:finalAmount,customer_note:customerNote||null,form_data:verifiedFormData
  }).select("id,amount").single();
  if(insertError)throw insertError;

  // Server-priced services must persist exactly the amount calculated above.
  // A database trigger or schema rule that rewrites it must not leave a
  // zero-priced order stranded as "Awaiting quote".
  if(VTU_SLUGS.has(slug)&&Number(order.amount)!==finalAmount){
   const {error:deleteError}=await admin.from("orders").delete().eq("id",order.id);
   if(deleteError){
    console.error("Order amount integrity check failed and cleanup failed",{
     orderId:order.id,slug,expectedAmount:finalAmount,storedAmount:order.amount,deleteError
    });
   }
   return NextResponse.json({error:"The order price could not be saved correctly. Please try again or contact support."},{status:500});
  }

  return NextResponse.json({id:order.id,amount:Number(order.amount),quoteRequired:requiresQuote});
 }catch(error){
  const message=error instanceof Error?error.message:"Could not create the service request.";
  return NextResponse.json({error:message},{status:500});
 }
}
