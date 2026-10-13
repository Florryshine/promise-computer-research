import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getPairgateDataPlans, pairgateRequest} from "@/lib/pairgate";

const VTU_SLUGS=new Set(["airtime-recharge","data-subscription","dstv-subscription","gotv-subscription","startimes-subscription","electricity-bill","exam-pins","data-pins"]);

export async function POST(request:Request){
  try{
    const body=await request.json();
    const slug=String(body.slug||"").trim();
    const amount=Number(body.amount||0);
    const formData=body.form_data && typeof body.form_data==="object" ? body.form_data : {};
    const customerNote=String(body.customer_note||"").trim();
    if(!slug)return NextResponse.json({error:"Service is required."},{status:400});

    const supabase=await createClient();
    const {data:{user}}=await supabase.auth.getUser();
    if(!user)return NextResponse.json({error:"You must be logged in."},{status:401});

    const admin=createAdminClient();
    const {data:service,error:serviceError}=await admin.from("services").select("id,slug,title,price,price_type,active").eq("slug",slug).eq("active",true).maybeSingle();
    if(serviceError)throw serviceError;
    if(!service)return NextResponse.json({error:"This service is no longer available."},{status:404});


    let finalAmount=VTU_SLUGS.has(slug) ? amount : service.price_type==="fixed" ? Number(service.price||0) : 0;
    let verifiedFormData:Record<string,any>={...formData};

    if(slug==="data-subscription"){
      const network=String(formData.network||"").trim();
      const selectedPlanId=String(formData.provider_plan_id||formData.plan_id||"").trim();
      if(!network||!selectedPlanId)return NextResponse.json({error:"Choose a network and data plan."},{status:400});
      const plans=await getPairgateDataPlans(network);
      const selected=plans.find(plan=>String(plan.id)===selectedPlanId);
      if(!selected)return NextResponse.json({error:"That data plan is no longer available. Refresh the plan list and choose another."},{status:409});
      finalAmount=selected.price;
      verifiedFormData={...verifiedFormData,network,network_id:String(selected.networkId??""),provider_plan_id:selected.id,plan_name:selected.name,provider_amount:String(selected.price),plan_validity:selected.validity};
    }
    if(["dstv-subscription","gotv-subscription","startimes-subscription"].includes(slug)){
      const provider=slug==="dstv-subscription"?"dstv":slug==="gotv-subscription"?"gotv":"startimes";
      const planId=String(formData.provider_plan_id||formData.plan_id||"").trim();
      const smartcard=String(formData.smartcard||formData.smartcard_number||formData.iuc_number||"").trim();
      if(!planId||!/^\\d{6,20}$/.test(smartcard))return NextResponse.json({error:"Choose a TV package and enter a valid smartcard/IUC number."},{status:400});
      const payload=await pairgateRequest("/cable-plans","GET",{provider_id:provider});
      const data=payload?.data??payload;const planRows=Array.isArray(data)?data:Object.values(data||{}).find(Array.isArray) as any[]||[];
      const selected=(planRows||[]).find((p:any)=>String(p.plan_id??p.id)===planId);
      if(!selected)return NextResponse.json({error:"That TV package is no longer available. Refresh and choose another."},{status:409});
      finalAmount=Number(selected.price)+1000;
      verifiedFormData={...verifiedFormData,provider_id:provider,provider_plan_id:planId,plan_name:String(selected.name||""),provider_amount:String(selected.price),smartcard,service_fee:"1000"};
    }
    if(slug==="electricity-bill"){
      const provider=String(formData.provider_id||formData.disco_id||"").trim().toLowerCase();
      const meterNumber=String(formData.meter_number||"").trim();
      const meterType=Number(formData.meter_type||formData.meter_type_id);
      const purchaseAmount=Number(formData.amount||formData.provider_amount||0);
      if(!provider||!/^\\d{1,20}$/.test(meterNumber)||![1,2].includes(meterType)||purchaseAmount<1000)return NextResponse.json({error:"Choose a disco, enter a valid meter number/type and use at least ₦1,000."},{status:400});
      const payload=await pairgateRequest("/providers/electricity");
      const data=payload?.data??payload;const providers=Array.isArray(data)?data:[];
      if(!providers.some((p:any)=>String(p.slug||"").toLowerCase()===provider))return NextResponse.json({error:"Choose a valid electricity provider."},{status:400});
      finalAmount=purchaseAmount+500;
      verifiedFormData={...verifiedFormData,provider_id:provider,meter_number:meterNumber,meter_type:meterType,provider_amount:String(purchaseAmount),service_fee:"500"};
    }
    if(slug==="exam-pins"){
      const provider=String(formData.provider_id||formData.exam_type||"").trim().toLowerCase();
      const quantity=Number(formData.quantity||1);
      if(!["waec","neco","nabt"].includes(provider)||!Number.isInteger(quantity)||quantity<1||quantity>10)return NextResponse.json({error:"Choose WAEC, NECO or NABTEB and a quantity from 1 to 10."},{status:400});
      if(service.price_type!=="fixed"||Number(service.price||0)<=0)return NextResponse.json({error:"Exam PIN pricing is not configured by the administrator yet. Payments are disabled until a per-PIN price is set."},{status:503});
      finalAmount=Number(service.price)*quantity;
      verifiedFormData={...verifiedFormData,provider_id:provider,quantity,provider_amount:String(finalAmount)};
    }
    if(slug==="data-pins"){
      const provider=String(formData.provider_id||formData.network||"").trim().toLowerCase();
      const denomination=Number(formData.denomination||formData.amount||0);
      const quantity=Number(formData.quantity||1);
      if(!["mtn","airtel","glo","9mobile"].includes(provider)||!Number.isInteger(quantity)||quantity<1||quantity>10)return NextResponse.json({error:"Choose a supported network and a quantity from 1 to 10."},{status:400});
      const payload=await pairgateRequest("/recharge-pins/denominations","GET",{provider_id:provider});
      const data=payload?.data??payload;const denoms=Array.isArray(data)?data:Object.values(data||{}).find(Array.isArray) as any[]||[];
      const selected=(denoms||[]).find((p:any)=>Number(p.denomination??p.amount??p.value)===denomination);
      if(!selected)return NextResponse.json({error:"That recharge-card denomination is unavailable for this network."},{status:409});
      const unitPrice=Number(selected.price??selected.selling_price??selected.denomination??selected.amount);
      finalAmount=unitPrice*quantity;
      verifiedFormData={...verifiedFormData,provider_id:provider,denomination,quantity,provider_amount:String(finalAmount),unit_price:String(unitPrice)};
    }
    if(!Number.isFinite(finalAmount)||finalAmount<0)return NextResponse.json({error:"Invalid order amount."},{status:400});

    const reference="PCR-"+Date.now().toString().slice(-10);
    const {data:order,error:insertError}=await admin.from("orders").insert({
      reference,customer_id:user.id,service_id:service.id,status:"pending",payment_status:"unpaid",
      amount:finalAmount,customer_note:customerNote||null,form_data:verifiedFormData
    }).select("id").single();
    if(insertError)throw insertError;

    return NextResponse.json({id:order.id,amount:finalAmount});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Could not create the service request."},{status:500});
  }
}
