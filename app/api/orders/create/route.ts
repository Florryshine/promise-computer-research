import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";

const VTU_SLUGS=new Set(["airtime-recharge","data-subscription","dstv-subscription","gotv-subscription","startimes-subscription","electricity-bill"]);

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

    const finalAmount=VTU_SLUGS.has(slug) ? amount : service.price_type==="fixed" ? Number(service.price||0) : 0;
    if(!Number.isFinite(finalAmount)||finalAmount<0)return NextResponse.json({error:"Invalid order amount."},{status:400});

    const reference="PCR-"+Date.now().toString().slice(-10);
    const {data:order,error:insertError}=await admin.from("orders").insert({
      reference,customer_id:user.id,service_id:service.id,status:"pending",payment_status:"unpaid",
      amount:finalAmount,customer_note:customerNote||null,form_data:formData
    }).select("id").single();
    if(insertError)throw insertError;

    return NextResponse.json({id:order.id,amount:finalAmount});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Could not create the service request."},{status:500});
  }
}
