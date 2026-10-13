import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getPairgateDataPlans,pairgateRequest} from "@/lib/pairgate";

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
    if(VTU_SLUGS.has(slug)&&!["airtime-recharge","data-subscription","dstv-subscription","gotv-subscription","startimes-subscription"].includes(slug))return NextResponse.json({error:"This service is temporarily unavailable while its Pairgate integration is completed. Please do not pay yet."},{status:503});

    let finalAmount=VTU_SLUGS.has(slug) ? amount : service.price_type==="fixed" ? Number(service.price||0) : 0;
    let verifiedFormData:Record<string,any>={...formData};

    if(slug==="data-subscription"){
      const network=String(formData.network||"").trim();
      const selectedPlanId=String(formData.provider_plan_id||formData.plan_id||"").trim();
      if(!network||!selectedPlanId)return NextResponse.json({error:"Choose a network and data plan."},{status:400});
      let plans;
      try { plans=await getPairgateDataPlans(network); }
      catch(error) {
        const message=error instanceof Error?error.message:"Pairgate catalogue is unavailable.";
        return NextResponse.json({error:message},{status:503});
      }
      const selected=plans.find(plan=>String(plan.id)===selectedPlanId);
      if(!selected)return NextResponse.json({error:"That data plan is no longer available. Refresh the plan list and choose another."},{status:409});
      // Price and provider plan ID are taken from the server-fetched provider catalogue,
      // never trusted from the browser.
      finalAmount=selected.price;
      verifiedFormData={...verifiedFormData,network,network_id:String(selected.networkId??""),provider_plan_id:selected.id,plan_name:selected.name,provider_amount:String(selected.price),plan_validity:selected.validity};
    }
    if(["dstv-subscription","gotv-subscription","startimes-subscription"].includes(slug)){
      const provider=slug==="dstv-subscription"?"dstv":slug==="gotv-subscription"?"gotv":"startimes";
      const planId=String(formData.provider_plan_id||"").trim();
      const smartcard=String(formData.smartcard||formData.smartcard_number||formData.iuc_number||"").trim();
      if(!planId||!/^\\d{6,20}$/.test(smartcard))return NextResponse.json({error:"Choose a package and enter a valid smartcard/IUC number."},{status:400});
      const payload=await pairgateRequest("/cable-plans","GET",{provider_id:provider});
      const data=payload?.data??payload;
      const rows=Array.isArray(data)?data:Object.values(data||{}).find(Array.isArray)||[];
      const plan=(rows as any[]).find(row=>String(row.plan_id??row.id)===planId);
      if(!plan)return NextResponse.json({error:"That TV package is no longer available. Refresh and choose another."},{status:409});
      const providerAmount=Number(plan.price);
      if(!Number.isFinite(providerAmount)||providerAmount<=0)return NextResponse.json({error:"Pairgate returned an invalid package price."},{status:502});
      finalAmount=providerAmount+1000;
      verifiedFormData={...verifiedFormData,provider_id:provider,provider_plan_id:planId,plan_name:String(plan.name||""),provider_amount:String(providerAmount),smartcard,service_fee:"1000"};
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
