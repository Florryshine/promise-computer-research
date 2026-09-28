import Link from "next/link";
import {ArrowRight} from "lucide-react";
import {createClient} from "@/lib/supabase/server";
import {getServicePresentation} from "@/lib/service-presentation";

export const dynamic = 'force-dynamic';

export default async function Services(){
 const supabase=await createClient();
 const {data:services}=await supabase.from("services").select("slug,title,category,description,price,price_type").eq("active",true).order("sort_order");
 return <main><section className="bg-[#f4f8ff] py-16"><div className="container"><span className="eyebrow">Our services</span><h1 className="mt-5 text-4xl font-black tracking-tight sm:text-5xl">Academic, educational & digital support.</h1><p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">Explore the services offered by Promise Computer Research. Select a service to see what it covers and how to request assistance.</p></div></section><section className="section"><div className="container grid gap-5 md:grid-cols-2 lg:grid-cols-3">{(services??[]).map(s=>{const p=getServicePresentation(s.slug,s.category);return <Link key={s.slug} href={`/services/${s.slug}`} className="group rounded-2xl border border-slate-200 bg-white p-6 hover:-translate-y-1 hover:border-blue-200 hover:shadow-soft"><div className="flex items-start justify-between"><div className="grid h-12 w-12 place-items-center rounded-xl bg-[#f0f6ff] text-2xl">{p.icon}</div><span className="rounded-full bg-slate-50 px-3 py-1 text-[11px] font-bold text-slate-500">{s.category}</span></div><h2 className="mt-5 text-xl font-extrabold">{s.title}</h2><p className="mt-3 text-sm leading-6 text-slate-600">{s.description}</p><div className="mt-5 flex items-center gap-2 text-sm font-bold text-[#0757d5]">View details <ArrowRight size={16}/></div></Link>})}</div></section></main>;
}