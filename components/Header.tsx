'use client';

import Image from 'next/image';
import Link from 'next/link';
import {Menu, X, ChevronDown, MessageCircle} from 'lucide-react';
import {useState} from 'react';

const LOGO='https://user24606.cn.imgto.link/public/20260925/1003106192.avif';

export default function Header(){
  const [open,setOpen]=useState(false);
  return <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/95 backdrop-blur">
    <div className="container flex h-18 items-center justify-between gap-5 py-3">
      <Link href="/" className="flex items-center gap-3" onClick={()=>setOpen(false)}>
        <Image src={LOGO} alt="Promise Computer Research" width={48} height={48} className="h-11 w-11 rounded-xl object-contain" unoptimized />
        <div><div className="text-[15px] font-black tracking-tight text-[#0b1730]">PROMISE COMPUTER</div><div className="text-[11px] font-bold tracking-[.2em] text-[#0757d5]">RESEARCH</div></div>
      </Link>
      <nav className="hidden items-center gap-7 md:flex">
        <Link className="text-sm font-semibold text-slate-700 hover:text-[#0757d5]" href="/">Home</Link>
        <Link className="flex items-center gap-1 text-sm font-semibold text-slate-700 hover:text-[#0757d5]" href="/services">Services <ChevronDown size={14}/></Link>
        <Link className="text-sm font-semibold text-slate-700 hover:text-[#0757d5]" href="/about">About</Link>
        <Link className="text-sm font-semibold text-slate-700 hover:text-[#0757d5]" href="/faq">FAQ</Link>
        <Link className="text-sm font-semibold text-slate-700 hover:text-[#0757d5]" href="/contact">Contact</Link>
        <Link className="text-sm font-semibold text-slate-700 hover:text-[#0757d5]" href="/dashboard">My Account</Link>
        <Link className="text-sm font-bold text-[#0757d5] hover:text-[#063b93]" href="/admin">Admin</Link>
      </nav>
      <div className="hidden md:block"><a href="https://wa.me/2347058391188" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-[#0757d5] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#063b93]"><MessageCircle size={17}/> WhatsApp</a></div>
      <button aria-label="Open menu" className="rounded-lg p-2 md:hidden" onClick={()=>setOpen(!open)}>{open?<X/>:<Menu/>}</button>
    </div>
    {open&&<div className="border-t border-slate-100 bg-white px-4 pb-5 pt-3 md:hidden"><div className="container flex flex-col gap-1">{[['Home','/'],['Services','/services'],['About','/about'],['FAQ','/faq'],['Contact','/contact'],['My Account','/dashboard'],['Admin','/admin']].map(([label,href])=><Link key={href} onClick={()=>setOpen(false)} className="rounded-lg px-3 py-3 font-semibold hover:bg-slate-50" href={href}>{label}</Link>)}<a onClick={()=>setOpen(false)} href="https://wa.me/2347058391188" target="_blank" rel="noreferrer" className="mt-2 inline-flex justify-center rounded-xl bg-[#0757d5] px-4 py-3 font-bold text-white">Chat on WhatsApp</a></div></div>}
  </header>;
}
