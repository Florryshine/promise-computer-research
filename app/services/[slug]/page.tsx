import Link from 'next/link';
import {notFound} from 'next/navigation';
import {ArrowLeft,ArrowRight,CheckCircle2,MessageCircle} from 'lucide-react';
import {createClient} from '@/lib/supabase/server';
import {getServicePresentation} from '@/lib/service-presentation';

export const dynamic = 'force-dynamic';

export default async function ServicePage({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params;
  const supabase=await createClient();
  const {data:s}=await supabase.from('services').select('id,slug,title,category,description,price,price_type,active').eq('slug',slug).eq('active',true).maybeSingle();
  if(!s)return notFound();
  const presentation=getServicePresentation(s.slug,s.category);
  const isFixed=s.price_type==='fixed' && s.price!=null;
  const priceLabel=isFixed?'₦'+Number(s.price).toLocaleString():'Request a quote';
  return <main><section className="bg-[#f4f8ff] py-14"><div className="container"><Link href="/services" className="inline-flex items-center gap-2 text-sm font-bold text-[#0757d5]"><ArrowLeft size={16}/> All services</Link><div className="mt-8 max-w-3xl"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-2xl shadow-sm">{presentation.icon}</div><p className="mt-6 text-xs font-bold uppercase tracking-[.16em] text-[#0757d5]">{s.category}</p><h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">{s.title}</h1><p className="mt-5 text-lg leading-8 text-slate-600">{s.description}</p></div></div></section><section className="section"><div className="container grid gap-12 lg:grid-cols-[1fr_380px]"><div><h2 className="text-2xl font-black">What this service covers</h2><div className="mt-6 space-y-4">{presentation.details.map(d=><div key={d} className="flex gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-[#0757d5]" size={20}/><span className="text-slate-700">{d}</span></div>)}</div><div className="mt-10 rounded-2xl border border-blue-100 bg-[#f4f8ff] p-6"><h3 className="font-extrabold">Need specific information?</h3><p className="mt-2 text-sm leading-6 text-slate-600">Contact us before submitting your request if you need to confirm requirements, availability or pricing.</p></div></div><aside className="h-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-soft"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Request this service</p><h3 className="mt-2 text-xl font-black">{priceLabel}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{isFixed?'Submit your request, then pay securely through Paystack.':'Submit your request and we will review the requirements and pricing.'}</p><Link href={'/services/'+s.slug+'/request'} className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-[#0757d5] px-5 py-3 font-bold text-white hover:bg-[#063b93]">Start request <ArrowRight size={18}/></Link><a href="https://wa.me/2347058391188" target="_blank" rel="noreferrer" className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-[#0757d5] px-5 py-3 font-bold text-white hover:bg-[#063b93]"><MessageCircle size={18}/> Request via WhatsApp</a><Link href="/contact" className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-700 hover:border-[#0757d5] hover:text-[#0757d5]">Contact page <ArrowRight size={16}/></Link></aside></div></section></main>}
