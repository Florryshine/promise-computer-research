"use client";

import {useEffect,useMemo,useState} from "react";
import {useParams,useRouter} from "next/navigation";
import {createClient} from "@/lib/supabase/client";

type ServiceField={field_key:string;label:string;field_type:string;placeholder:string|null;required:boolean;options:any;sort_order:number};

const VTU_SLUGS=new Set(["airtime-recharge","data-subscription","dstv-subscription","gotv-subscription","startimes-subscription","electricity-bill","exam-pins","data-pins"]);
const NETWORK_SERVICE=(network:string,type:"airtime"|"data")=>{
 const n=network.toLowerCase();
 if(n==="mtn")return type==="airtime"?"mtn":"mtn-data";
 if(n==="airtel")return type==="airtime"?"airtel":"airtel-data";
 if(n==="glo")return type==="airtime"?"glo":"glo-data";
 if(n==="9mobile")return type==="airtime"?"etisalat":"etisalat-data";
 return "";
};
const FEE:Record<string,number>={airtime:0,data:0,cable:1000,electricity:500,exam:0,datapin:0};

export default function RequestService(){
 const params=useParams<{slug:string}>(),router=useRouter();
 const [service,setService]=useState<any>(null),[fields,setFields]=useState<ServiceField[]>([]),[form,setForm]=useState<Record<string,string>>({});
 const [loading,setLoading]=useState(false),[pageLoading,setPageLoading]=useState(true),[error,setError]=useState("");

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
  setService(s);setFields((f??[]) as ServiceField[]);
  setForm({full_name:p?.full_name??"",phone:p?.phone??"",email:user.email??"",phone_number:p?.phone??"",request_details:""});
  setPageLoading(false);
 })();},[params.slug,router]);



 const isDStvRenew=false;
 const providerAmount=["airtime","electricity","exam","datapin"].includes(kind)?Number(form.amount||0):Number(form.provider_amount||0);
 const serviceFee=FEE[kind]||0;
 const total=providerAmount+serviceFee;

 function renderField(f:ServiceField){
  if(isVTU&&["data-subscription","dstv-subscription"].includes(params.slug)&&["package","variation_code"].includes(f.field_key))return null;
  const value=form[f.field_key]??"";
  const common={value,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>)=>set(f.field_key,e.target.value),placeholder:f.placeholder??undefined};
  if(f.field_type==="textarea")return <textarea {...common} rows={5} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"/>;
  if(f.field_type==="select")return <select {...common} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3"><option value="">Select an option</option>{(Array.isArray(f.options)?f.options:[]).map((option:any,i:number)=><option key={i} value={String(option?.value??option)}>{String(option?.label??option)}</option>)}</select>;
  return <input {...common} type={f.field_type==="number"?"number":f.field_type==="email"?"email":f.field_type==="tel"?"tel":"text"} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"/>;
 }


 async function submit(e:React.FormEvent){
  e.preventDefault();setLoading(true);setError("");
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
    if(["airtime","electricity","exam","datapin","cable"].includes(kind)){
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
   {fields.map(f=>{if(isVTU&&["phone_number","amount"].includes(f.field_key)&&false)return null;return <label key={f.field_key} className="block text-sm font-bold">{f.label}{f.required&&<span className="text-red-500"> *</span>}{renderField(f)}</label>})}
   {isVTU&&providerAmount>0&&<div className="rounded-2xl bg-slate-50 p-4 text-sm"><div className="flex justify-between"><span>Provider amount</span><b>₦{providerAmount.toLocaleString()}</b></div><div className="mt-2 flex justify-between"><span>Service fee</span><b>₦{serviceFee.toLocaleString()}</b></div><div className="mt-3 flex justify-between border-t pt-3 text-base"><span className="font-black">Total to pay</span><b>₦{total.toLocaleString()}</b></div></div>}
   <label className="block text-sm font-bold">Request details{!fields.length&&!isVTU&&<span className="text-red-500"> *</span>}<textarea required={!fields.length&&!isVTU} value={form.request_details??""} onChange={e=>set("request_details",e.target.value)} rows={5} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" placeholder="Tell us anything else we should know."/></label>
   <button disabled={loading} className="w-full rounded-xl bg-[#0757d5] px-5 py-3.5 font-bold text-white disabled:opacity-60">{loading?"Submitting…":isVTU&&total>0?"Continue to payment":"Submit"}</button>
  </form>
 </div></div></main>;
}
