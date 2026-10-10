"use client";

import {useEffect,useState} from "react";
import {useParams,useRouter} from "next/navigation";
import {createClient} from "@/lib/supabase/client";

type ServiceField={field_key:string;label:string;field_type:string;placeholder:string|null;required:boolean;options:any;sort_order:number};
type DataPlan={id:string;networkId:number|null;network:string;name:string;price:number;validity:string};

const VTU_SLUGS=new Set(["airtime-recharge","data-subscription","dstv-subscription","gotv-subscription","startimes-subscription","electricity-bill","exam-pins","data-pins"]);
const FEE:Record<string,number>={airtime:0,data:0,cable:1000,electricity:500,exam:0,datapin:0};

export default function RequestService(){
 const params=useParams<{slug:string}>(),router=useRouter();
 const [service,setService]=useState<any>(null),[fields,setFields]=useState<ServiceField[]>([]),[form,setForm]=useState<Record<string,string>>({});
 const [loading,setLoading]=useState(false),[pageLoading,setPageLoading]=useState(true),[error,setError]=useState("");
 const [dataPlans,setDataPlans]=useState<DataPlan[]>([]),[plansLoading,setPlansLoading]=useState(false),[plansError,setPlansError]=useState("");

 const isVTU=VTU_SLUGS.has(params.slug);
 const kind=params.slug==="airtime-recharge"?"airtime":params.slug==="data-subscription"?"data":["dstv-subscription","gotv-subscription","startimes-subscription"].includes(params.slug)?"cable":params.slug==="electricity-bill"?"electricity":params.slug==="exam-pins"?"exam":params.slug==="data-pins"?"datapin":"";
 const set=(k:string,v:string)=>setForm(x=>({...x,[k]:v}));

 useEffect(()=>{(async()=>{
  const supabase=createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user){router.replace("/login?next=/services/"+params.slug+"/request");return;}
  const [{data:s},{data:p}]=await Promise.all([
   supabase.from("services").select("id,slug,title,price,price_type,active").eq("slug",params.slug).eq("active",true).maybeSingle(),
   supabase.from("profiles").select("full_name,phone").eq("id",user.id).maybeSingle()
  ]);
  const {data:f}=s?await supabase.from("service_fields").select("field_key,label,field_type,placeholder,required,options,sort_order").eq("service_id",s.id).order("sort_order"):{data:[]};
  const loadedFields=(f??[]) as ServiceField[];
  setService(s);setFields(loadedFields);
  // Automatically choose fields with only one valid option (for example, Airtime type = VTU).
  // This avoids asking customers to select an option when there is no actual choice.
  const singleOptionDefaults:Record<string,string>={};
  for(const field of loadedFields){
    if(field.field_type==="select" && Array.isArray(field.options) && field.options.length===1){
      const option=field.options[0];
      singleOptionDefaults[field.field_key]=String(option?.value??option);
    }
  }
  setForm({full_name:p?.full_name??"",phone:p?.phone??"",email:user.email??"",phone_number:p?.phone??"",request_details:"",network:"mtn",...singleOptionDefaults});
  setPageLoading(false);
 })();},[params.slug,router]);

 useEffect(()=>{
  if(kind!=="data")return;
  let cancelled=false;
  setPlansLoading(true);setPlansError("");setDataPlans([]);
  setForm(current=>({...current,provider_plan_id:"",provider_amount:"",plan_name:"",plan_validity:""}));
  fetch("/api/nifex/data-plans?network="+encodeURIComponent(form.network||"mtn"),{cache:"no-store"})
   .then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||"Could not load data plans.");return body;})
   .then(body=>{if(!cancelled)setDataPlans(Array.isArray(body.plans)?body.plans:[]);})
   .catch(err=>{if(!cancelled)setPlansError(err instanceof Error?err.message:"Could not load data plans.");})
   .finally(()=>{if(!cancelled)setPlansLoading(false);});
  return ()=>{cancelled=true;};
 },[kind,form.network]);



  const providerAmount=["airtime","electricity","exam","datapin"].includes(kind)?Number(form.amount||0):Number(form.provider_amount||0);
 const serviceFee=FEE[kind]||0;
 const total=providerAmount+serviceFee;

 function renderField(f:ServiceField){
  // Provider IDs and provider-cost fields are internal integration data, never customer inputs.
  const internalProviderFields=["provider_plan_id","plan_id","plan_code","variation_code","package","provider_amount","amount","network_id","cablename_id","cable_provider_id","cableplan_id","disco_id","meter_type_id","provider_id","data_plan_id"];
  if(isVTU&&internalProviderFields.includes(f.field_key))return null;
  const value=form[f.field_key]??"";
  const common={value,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>)=>set(f.field_key,e.target.value),placeholder:f.placeholder??undefined};
  if(f.field_type==="textarea")return <textarea {...common} rows={5} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"/>;
  if(f.field_type==="select")return <select {...common} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3"><option value="">Select an option</option>{(Array.isArray(f.options)?f.options:[]).map((option:any,i:number)=><option key={i} value={String(option?.value??option)}>{String(option?.label??option)}</option>)}</select>;
  return <input {...common} type={f.field_type==="number"?"number":f.field_type==="email"?"email":f.field_type==="tel"?"tel":"text"} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"/>;
 }


 async function submit(e:React.FormEvent){
  e.preventDefault();
  setLoading(true);setError("");
  if(kind==="data"&&!form.provider_plan_id){setError("Choose an available data plan first.");setLoading(false);return;}
  try{
   const supabase=createClient();const {data:{user}}=await supabase.auth.getUser();
   if(!user){router.push("/login");return;}
   const missing=fields.find(f=>f.required&&!String(form[f.field_key]??"").trim()&&!(isVTU&&["package","variation_code"].includes(f.field_key)));
   if(missing)throw new Error("Please provide: "+missing.label+".");
   let orderAmount=0;let orderForm={...form};
   if(isVTU){
    const calculatedProviderAmount=providerAmount;
    if(kind==="data"||kind==="cable"){
      orderForm={...orderForm,provider_amount:String(calculatedProviderAmount),service_fee:String(serviceFee)};
    }
    if(["airtime","data","electricity","exam","datapin","cable"].includes(kind)){
      if(!Number.isFinite(providerAmount)||providerAmount<=0)throw new Error("Enter a valid amount.");
      orderForm={...orderForm,provider_amount:String(calculatedProviderAmount),service_fee:String(serviceFee)};
    }
    orderAmount=calculatedProviderAmount+serviceFee;
    
   }else{
    const {data:dbService}=await supabase.from("services").select("id,price,price_type,active").eq("slug",params.slug).eq("active",true).maybeSingle();
    if(!dbService)throw new Error("This service is no longer available.");
    orderAmount=Number(dbService.price??0);
   }
   const {data:dbService}=await supabase.from("services").select("id,price,price_type,active").eq("slug",params.slug).eq("active",true).maybeSingle();
   if(!dbService)throw new Error("This service is no longer available.");
   const reference="PCR-"+Date.now().toString().slice(-10);
   const createOrder=await fetch("/api/orders/create",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug:params.slug,amount:orderAmount,customer_note:orderForm.request_details||"",form_data:orderForm})});
   const created=await createOrder.json();
   if(!createOrder.ok)throw new Error(created?.error||"Could not submit this request.");
   router.push(orderAmount>0?"/dashboard/orders?new="+created.id+"&pay=1":"/dashboard/orders?new="+created.id);
  }catch(err){setError(err instanceof Error?err.message:"Could not submit this request.");setLoading(false);}
 }

 if(pageLoading)return <main className="section"><div className="container"><p className="text-slate-500">Loading service…</p></div></main>;
 if(!service)return <main className="section"><div className="container"><h1 className="text-2xl font-black">Service not found or unavailable</h1></div></main>;

 return <main className="section bg-slate-50"><div className="container"><div className="mx-auto max-w-2xl rounded-3xl bg-white p-6 shadow-soft sm:p-8">
  <p className="text-xs font-bold uppercase tracking-[.16em] text-[#0757d5]">Service request</p><h1 className="mt-2 text-3xl font-black">{service.title}</h1>
  <p className="mt-2 text-sm text-slate-500">{isVTU?"Enter your details and continue to payment.":service.price_type==="fixed"&&service.price!=null?"Price: ₦"+Number(service.price).toLocaleString()+".":"Submit your details."}</p>
  {error&&<div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
  <form onSubmit={submit} className="mt-7 space-y-5">
   {[["full_name","Full name","text"],["phone","Phone number","tel"],["email","Email","email"]].map(([k,l,t])=><label key={k} className="block text-sm font-bold">{l}<input required value={form[k]??""} onChange={e=>set(k,e.target.value)} type={t} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"/></label>)}
   {kind==="data"&&<div className="space-y-4 rounded-2xl border border-slate-200 p-4">
    <label className="block text-sm font-bold">Network *
     <select value={form.network||"mtn"} onChange={e=>{set("network",e.target.value);set("provider_plan_id","");set("provider_amount","");set("plan_name","");}} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3">
      <option value="mtn">MTN</option><option value="airtel">Airtel</option><option value="glo">Glo</option><option value="9mobile">9mobile</option>
     </select>
    </label>
    <label className="block text-sm font-bold">Data plan *
     <select value={form.provider_plan_id||""} disabled={plansLoading||dataPlans.length===0} onChange={e=>{const plan=dataPlans.find(p=>p.id===e.target.value);set("provider_plan_id",plan?.id||"");set("provider_amount",plan?String(plan.price):"");set("plan_name",plan?.name||"");set("plan_validity",plan?.validity||"");}} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3">
      <option value="">{plansLoading?"Loading live plans…":dataPlans.length?"Choose a data plan":"No plans available"}</option>
      {dataPlans.map(plan=><option key={plan.id} value={plan.id}>{plan.name}{plan.validity?" · "+plan.validity:""} — ₦{Number(plan.price).toLocaleString()}</option>)}
     </select>
    </label>
    {plansError&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Could not load live plans: {plansError}</p>}
    {!plansLoading&&!plansError&&dataPlans.length===0&&<p className="text-sm text-slate-600">No plans were returned by Nifex. The provider catalogue endpoint must be configured before data purchases can be enabled.</p>}
   </div>}
   {fields.filter(f=>!(isVTU&&(["provider_plan_id","plan_id","plan_code","variation_code","package","provider_amount","amount","network_id","cablename_id","cable_provider_id","cableplan_id","disco_id","meter_type_id","provider_id","data_plan_id"].includes(f.field_key)||(kind==="data"&&f.field_key==="network")))).map(f=><label key={f.field_key} className="block text-sm font-bold">{f.label}{f.required&&<span className="text-red-500"> *</span>}{renderField(f)}</label>)}
   {isVTU&&providerAmount>0&&<div className="rounded-2xl bg-slate-50 p-4 text-sm"><div className="flex justify-between"><span>Provider amount</span><b>₦{providerAmount.toLocaleString()}</b></div><div className="mt-2 flex justify-between"><span>Service fee</span><b>₦{serviceFee.toLocaleString()}</b></div><div className="mt-3 flex justify-between border-t pt-3 text-base"><span className="font-black">Total to pay</span><b>₦{total.toLocaleString()}</b></div></div>}
   <label className="block text-sm font-bold">Request details{!fields.length&&!isVTU&&<span className="text-red-500"> *</span>}<textarea required={!fields.length&&!isVTU} value={form.request_details??""} onChange={e=>set("request_details",e.target.value)} rows={5} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" placeholder="Tell us anything else we should know."/></label>
   <button disabled={loading||(kind==="data"&&(!form.provider_plan_id||plansLoading||Boolean(plansError)))} className="w-full rounded-xl bg-[#0757d5] px-5 py-3.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{loading?"Submitting…":isVTU&&total>0?"Continue to payment":"Submit"}</button>
  </form>
 </div></div></main>;
}
