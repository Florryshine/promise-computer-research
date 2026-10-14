"use client";

import {useEffect,useState} from "react";
import {useParams,useRouter} from "next/navigation";
import {createClient} from "@/lib/supabase/client";

type ServiceField={field_key:string;label:string;field_type:string;placeholder:string|null;required:boolean;options:any;sort_order:number};
type DataPlan={id:string;networkId:number|null;network:string;name:string;price:number;validity:string};
type UtilityProvider={id:string;name:string};
type EpinDenomination={value:number;label:string};

const VTU_SLUGS=new Set(["airtime-recharge","data-subscription","dstv-subscription","gotv-subscription","startimes-subscription","electricity-bill","exam-pins","data-pins"]);
const FEE_RATE:Record<string,number>={airtime:3,data:5,cable:5,electricity:5,exam:5,datapin:5};
const EXAM_PIN_PRICES:Record<string,number>={waec:6500,neco:3000,nabt:1200};

const INTERNAL_PROVIDER_FIELDS=new Set(["provider_plan_id","plan_id","plan_code","variation_code","package","provider_amount","network_id","cablename_id","cable_provider_id","cableplan_id","disco_id","meter_type_id","provider_id","service_provider","electricity_provider","electricity_company","distribution_company","disco","data_plan_id","nifex_data_plan_id","nifex_plan_id","nifex_data_plan","nifex_plan_code","meter_number","meter_type","exam_type","quantity","denomination","smartcard","smartcard_number","iuc_number"]);
function isInternalProviderField(field:ServiceField){
 const key=String(field.field_key||"").toLowerCase().replace(/[\s-]+/g,"_");
 const label=String(field.label||"").toLowerCase();
 return INTERNAL_PROVIDER_FIELDS.has(key)
  || /nifex|provider.*plan.*id|plan.*id.*from.*provider|provider.*amount|variation.*code/.test(key)
  || /nifex|plan id from|provider plan id|provider amount/.test(label);
}

export default function RequestService(){
 const params=useParams<{slug:string}>(),router=useRouter();
 const [service,setService]=useState<any>(null),[fields,setFields]=useState<ServiceField[]>([]),[form,setForm]=useState<Record<string,string>>({});
 const [jambServices,setJambServices]=useState<any[]>([]);
 const [loading,setLoading]=useState(false),[pageLoading,setPageLoading]=useState(true),[error,setError]=useState("");
 const [dataPlans,setDataPlans]=useState<DataPlan[]>([]),[plansLoading,setPlansLoading]=useState(false),[plansError,setPlansError]=useState("");
 const [cablePlans,setCablePlans]=useState<DataPlan[]>([]),[cableLoading,setCableLoading]=useState(false),[cableError,setCableError]=useState("");
 const [utilityProviders,setUtilityProviders]=useState<UtilityProvider[]>([]),[utilityLoading,setUtilityLoading]=useState(false),[utilityError,setUtilityError]=useState("");
 const [epinDenominations,setEpinDenominations]=useState<EpinDenomination[]>([]),[epinLoading,setEpinLoading]=useState(false),[epinError,setEpinError]=useState("");

 const isVTU=VTU_SLUGS.has(params.slug);
 const examUnitPrice=EXAM_PIN_PRICES[String(form.exam_type||"").toLowerCase()]||0;
 const examPriceConfigured=examUnitPrice>0;
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
  if(params.slug==="jamb-services"){
   const {data:children}=await supabase.from("services").select("slug,title,description,price,price_type").eq("active",true).eq("category","JAMB").neq("slug","jamb-services").order("sort_order");
   setJambServices(children??[]);
  }
  // Automatically choose fields with only one valid option (for example, Airtime type = VTU).
  // This avoids asking customers to select an option when there is no actual choice.
  const singleOptionDefaults:Record<string,string>={};
  for(const field of loadedFields){
    if(field.field_type==="select" && Array.isArray(field.options) && field.options.length===1){
      const option=field.options[0];
      singleOptionDefaults[field.field_key]=String(option?.value??option);
    }
  }
  setForm({full_name:p?.full_name??"",phone:p?.phone??"",email:user.email??"",phone_number:p?.phone??"",request_details:"",network:"mtn",meter_type:"1",quantity:"1",...singleOptionDefaults});
  setPageLoading(false);
 })();},[params.slug,router]);

 useEffect(()=>{
  if(kind!=="electricity"&&kind!=="exam")return;
  const catalogueKind=kind==="electricity"?"electricity":"education";
  let cancelled=false;
  setUtilityLoading(true);setUtilityError("");setUtilityProviders([]);
  fetch("/api/pairgate/catalogue?kind="+catalogueKind,{cache:"no-store"})
   .then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||"Could not load providers.");return body;})
   .then(body=>{if(!cancelled)setUtilityProviders(Array.isArray(body.providers)?body.providers:[]);})
   .catch(err=>{if(!cancelled)setUtilityError(err instanceof Error?err.message:"Could not load providers.");})
   .finally(()=>{if(!cancelled)setUtilityLoading(false);});
  return ()=>{cancelled=true;};
 },[kind]);

 useEffect(()=>{
  if(kind!=="datapin"||!form.network)return;
  let cancelled=false;
  setEpinLoading(true);setEpinError("");setEpinDenominations([]);
  fetch("/api/pairgate/catalogue?kind=epin&provider="+encodeURIComponent(form.network),{cache:"no-store"})
   .then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||"Could not load recharge PIN denominations.");return body;})
   .then(body=>{if(!cancelled)setEpinDenominations(Array.isArray(body.denominations)?body.denominations:[]);})
   .catch(err=>{if(!cancelled)setEpinError(err instanceof Error?err.message:"Could not load denominations.");})
   .finally(()=>{if(!cancelled)setEpinLoading(false);});
  return ()=>{cancelled=true;};
 },[kind,form.network]);

 useEffect(()=>{
  if(kind!=="cable")return;
  const provider=params.slug==="dstv-subscription"?"dstv":params.slug==="gotv-subscription"?"gotv":"startimes";
  let cancelled=false;
  setCableLoading(true);setCableError("");setCablePlans([]);
  fetch("/api/pairgate/catalogue?kind=cable&provider="+provider,{cache:"no-store"})
   .then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||"Could not load TV packages.");return body;})
   .then(body=>{if(!cancelled)setCablePlans(Array.isArray(body.plans)?body.plans:[]);})
   .catch(err=>{if(!cancelled)setCableError(err instanceof Error?err.message:"Could not load TV packages.");})
   .finally(()=>{if(!cancelled)setCableLoading(false);});
  return ()=>{cancelled=true;};
 },[kind,params.slug]);

 useEffect(()=>{
  if(kind!=="data"||!form.network)return;
  let cancelled=false;
  setPlansLoading(true);setPlansError("");setDataPlans([]);
  setForm(current=>({...current,provider_plan_id:"",provider_amount:"",plan_name:"",plan_validity:""}));
  fetch("/api/pairgate/data-plans?network="+encodeURIComponent(form.network||"mtn"),{cache:"no-store"})
   .then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||"Could not load data plans.");return body;})
   .then(body=>{if(!cancelled)setDataPlans(Array.isArray(body.plans)?body.plans:[]);})
   .catch(err=>{if(!cancelled)setPlansError(err instanceof Error?err.message:"Could not load data plans.");})
   .finally(()=>{if(!cancelled)setPlansLoading(false);});
  return ()=>{cancelled=true;};
 },[kind,form.network]);



  const providerAmount=kind==="exam"?examUnitPrice*Number(form.quantity||1):kind==="datapin"?Number(form.denomination||0)*Number(form.quantity||1):["airtime","electricity"].includes(kind)?Number(form.amount||0):Number(form.provider_amount||0);
 const serviceFee=Math.ceil(providerAmount*(FEE_RATE[kind]||0)/100);
 const total=providerAmount+serviceFee;

 function renderField(f:ServiceField){
  // Provider IDs and provider-cost fields are internal integration data, never customer inputs.
  if(["data","cable","electricity","exam","datapin"].includes(kind)&&f.field_key==="amount")return null;
  if(isVTU&&isInternalProviderField(f))return null;
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
   if(params.slug==="jamb-services"){
    const selected=jambServices.find(item=>item.slug===form.jamb_service_slug);
    if(!selected)throw new Error("Choose the JAMB service you need.");
    if(!String(form.full_name||"").trim()||!String(form.phone||"").trim()||!String(form.exam_year||"").trim())throw new Error("Provide your name, phone number and exam year.");
    const createOrder=await fetch("/api/orders/create",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      slug:selected.slug,
      customer_note:form.request_details||"",
      form_data:{...form,jamb_service_slug:selected.slug,jamb_service_title:selected.title,service_fulfilment:"manual_via_whatsapp_or_admin"}
    })});
    const created=await createOrder.json();
    if(!createOrder.ok)throw new Error(created?.error||"Could not create this JAMB service order.");
    router.push("/dashboard/orders?new="+created.id+"&pay=1");
    setLoading(false);return;
   }
   const providerAliases=["provider_id","disco_id","service_provider","electricity_provider","electricity_company","distribution_company","disco"];
   const missing=fields.find(f=>{
    if(!f.required||String(form[f.field_key]??"").trim())return false;
    if(!isVTU||isInternalProviderField(f))return !isVTU;
    if(["data","cable","electricity","exam","datapin"].includes(kind)&&f.field_key==="amount")return false;
    if(kind==="data"&&f.field_key==="network")return false;
    if(kind==="electricity"&&providerAliases.includes(f.field_key))return false;
    return true;
   });
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
  <p className="mt-2 text-sm text-slate-500">{params.slug==="jamb-services"?"Choose the JAMB service you need. Submit your request, pay securely online, and optionally send the order details to PCR on WhatsApp afterward.":isVTU?"Enter your details and continue to payment.":service.price_type==="fixed"&&service.price!=null?"Price: ₦"+Number(service.price).toLocaleString()+".":"Submit your details."}</p>
  {error&&<div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
  <form onSubmit={submit} className="mt-7 space-y-5">
   {[["full_name","Full name","text"],["phone","Phone number","tel"],["email","Email","email"]].map(([k,l,t])=><label key={k} className="block text-sm font-bold">{l}<input required={k!=="email"} value={form[k]??""} onChange={e=>set(k,e.target.value)} type={t} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"/></label>)}
   {params.slug==="jamb-services"&&<div className="space-y-4 rounded-2xl border border-slate-200 p-4">
    <label className="block text-sm font-bold">JAMB service needed *
     <select required value={form.jamb_service_slug||""} onChange={e=>set("jamb_service_slug",e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3">
      <option value="">Choose a service</option>{jambServices.map(item=><option key={item.slug} value={item.slug}>{item.title} — ₦1,500</option>)}
     </select>
    </label>
    <label className="block text-sm font-bold">JAMB registration number (if available)<input value={form.jamb_registration_number||""} onChange={e=>set("jamb_registration_number",e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"/></label>
    <label className="block text-sm font-bold">Exam year *<input required value={form.exam_year||""} onChange={e=>set("exam_year",e.target.value)} placeholder="e.g. 2026" inputMode="numeric" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"/></label>
   </div>}
   {kind==="electricity"&&<div className="space-y-4 rounded-2xl border border-slate-200 p-4">
    <label className="block text-sm font-bold">Electricity provider *
     <select value={form.provider_id||form.disco_id||form.electricity_provider||form.service_provider||""} onChange={e=>setForm(x=>({...x,provider_id:e.target.value,disco_id:e.target.value,electricity_provider:e.target.value,service_provider:e.target.value,electricity_company:e.target.value,distribution_company:e.target.value,disco:e.target.value}))} required disabled={utilityLoading||utilityProviders.length===0} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3"><option value="">{utilityLoading?"Loading providers…":"Choose your electricity provider"}</option>{utilityProviders.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </label>
    <label className="block text-sm font-bold">Meter number *<input value={form.meter_number||""} onChange={e=>set("meter_number",e.target.value)} required inputMode="numeric" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"/></label>
    <label className="block text-sm font-bold">Meter type *
     <select value={form.meter_type||"1"} onChange={e=>set("meter_type",e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3"><option value="1">Prepaid</option><option value="2">Postpaid</option></select>
    </label>
    <label className="block text-sm font-bold">Electricity amount (minimum ₦1,000) *<input type="number" min="1000" step="100" value={form.amount||""} onChange={e=>set("amount",e.target.value)} required className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"/></label>
    {utilityError&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{utilityError}</p>}
   </div>}
   {kind==="exam"&&<div className="space-y-4 rounded-2xl border border-slate-200 p-4">
    <label className="block text-sm font-bold">Exam PIN type *
     <select value={form.exam_type||""} onChange={e=>set("exam_type",e.target.value)} required disabled={utilityLoading||utilityProviders.length===0} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3"><option value="">{utilityLoading?"Loading exam providers…":"Choose exam body"}</option>{utilityProviders.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </label>
    <label className="block text-sm font-bold">Quantity *<input type="number" min="1" max="10" step="1" value={form.quantity||"1"} onChange={e=>set("quantity",e.target.value)} required className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"/></label>
    {examPriceConfigured?<p className="text-sm text-slate-600">Price per PIN: ₦{examUnitPrice.toLocaleString()}. PINs are delivered after Pairgate completes processing.</p>:<p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Choose WAEC, NECO or NABTEB to see the PIN price.</p>}
    {utilityError&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{utilityError}</p>}
   </div>}
   {kind==="datapin"&&<div className="space-y-4 rounded-2xl border border-slate-200 p-4">
    <label className="block text-sm font-bold">Network *
     <select value={form.network||"mtn"} onChange={e=>{set("network",e.target.value);set("denomination","");}} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3"><option value="mtn">MTN</option><option value="airtel">Airtel</option><option value="glo">Glo</option><option value="9mobile">9mobile</option></select>
    </label>
    <label className="block text-sm font-bold">Recharge PIN denomination *
     <select value={form.denomination||""} onChange={e=>set("denomination",e.target.value)} required disabled={epinLoading||epinDenominations.length===0} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3"><option value="">{epinLoading?"Loading denominations…":"Choose denomination"}</option>{epinDenominations.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}</select>
    </label>
    <label className="block text-sm font-bold">Quantity *<input type="number" min="1" max="10" step="1" value={form.quantity||"1"} onChange={e=>set("quantity",e.target.value)} required className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"/></label>
    {epinError&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{epinError}</p>}
   </div>}
   {kind==="cable"&&<div className="space-y-4 rounded-2xl border border-slate-200 p-4">
    <label className="block text-sm font-bold">TV package *
     <select value={form.provider_plan_id||""} disabled={cableLoading||cablePlans.length===0} onChange={e=>{const plan=cablePlans.find(p=>p.id===e.target.value);set("provider_plan_id",plan?.id||"");set("provider_amount",plan?String(plan.price):"");set("plan_name",plan?.name||"");}} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3">
      <option value="">{cableLoading?"Loading packages…":cablePlans.length?"Choose a package":"No packages available"}</option>
      {cablePlans.map(plan=><option key={plan.id} value={plan.id}>{plan.name} — ₦{plan.price.toLocaleString()}</option>)}
     </select>
    </label>
    <label className="block text-sm font-bold">Smartcard / IUC number *
     <input value={form.smartcard||form.smartcard_number||form.iuc_number||""} onChange={e=>set("smartcard",e.target.value)} required inputMode="numeric" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" placeholder="Enter the number on your decoder"/>
    </label>
    {cableError&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{cableError}</p>}
   </div>}
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
    {!plansLoading&&!plansError&&dataPlans.length===0&&<p className="text-sm text-slate-600">No plans were returned by Pairgate. The provider catalogue endpoint must be configured before data purchases can be enabled.</p>}
   </div>}
   {params.slug!=="jamb-services"&&fields.filter(f=>!(isVTU&&(isInternalProviderField(f)||["cable","electricity","exam","datapin"].includes(kind)||((kind==="data"||kind==="cable")&&f.field_key==="amount")||(kind==="data"&&f.field_key==="network")))).map(f=><label key={f.field_key} className="block text-sm font-bold">{f.label}{f.required&&<span className="text-red-500"> *</span>}{renderField(f)}</label>)}
   {isVTU&&providerAmount>0&&<div className="rounded-2xl bg-slate-50 p-4 text-sm"><div className="flex justify-between"><span>Provider amount</span><b>₦{providerAmount.toLocaleString()}</b></div><div className="mt-2 flex justify-between"><span>Service fee</span><b>₦{serviceFee.toLocaleString()}</b></div><div className="mt-3 flex justify-between border-t pt-3 text-base"><span className="font-black">Total to pay</span><b>₦{total.toLocaleString()}</b></div></div>}
   <label className="block text-sm font-bold">Request details{!fields.length&&!isVTU&&params.slug!=="jamb-services"&&<span className="text-red-500"> *</span>}<textarea required={!fields.length&&!isVTU&&params.slug!=="jamb-services"} value={form.request_details??""} onChange={e=>set("request_details",e.target.value)} rows={5} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" placeholder="Tell us anything else we should know."/></label>
   <button disabled={loading||(kind==="data"&&(!form.provider_plan_id||plansLoading||Boolean(plansError)))||(kind==="cable"&&(!form.provider_plan_id||!form.smartcard||cableLoading||Boolean(cableError)))||(kind==="electricity"&&(!form.provider_id||!form.meter_number||Number(form.amount)<1000||utilityLoading||Boolean(utilityError)))||(kind==="exam"&&(!form.exam_type||!Number.isInteger(Number(form.quantity))||Number(form.quantity)<1||Number(form.quantity)>10||!examPriceConfigured||utilityLoading||Boolean(utilityError)))||(kind==="datapin"&&(!form.denomination||!Number.isInteger(Number(form.quantity))||Number(form.quantity)<1||Number(form.quantity)>10||epinLoading||Boolean(epinError)))} className="w-full rounded-xl bg-[#0757d5] px-5 py-3.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{loading?"Submitting…":params.slug==="jamb-services"?"Continue to WhatsApp":kind==="exam"&&!examPriceConfigured?"Price unavailable":isVTU&&total>0?"Continue to payment":"Submit"}</button>
  </form>
 </div></div></main>;
}
