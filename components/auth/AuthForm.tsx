'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fullName,setFullName]=useState(''); const [phone,setPhone]=useState('');
  const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
  const [loading,setLoading]=useState(false); const [error,setError]=useState(''); const [message,setMessage]=useState('');

  async function submit(e:React.FormEvent){
    e.preventDefault(); setLoading(true); setError(''); setMessage('');
    if(mode==='register'){
      const {error}=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName,phone}}});
      if(error) setError(error.message); else { setMessage('Account created. If email confirmation is enabled, check your inbox before logging in.'); router.push('/login'); }
    } else {
      const {error}=await supabase.auth.signInWithPassword({email,password});
      if(error) setError(error.message);
      else {
        const next=searchParams.get('next');
        const safeNext=next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
        router.push(safeNext);
      }
    }
    setLoading(false);
  }
  return <div className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
    <div className="mb-7"><div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[#0757d5] text-xl font-black text-white">P</div><h1 className="text-2xl font-black">{mode==='login'?'Welcome back':'Create your account'}</h1><p className="mt-2 text-sm text-slate-500">{mode==='login'?'Sign in to manage your Promise Computer Research orders.':'Create an account to submit and track your service requests.'}</p></div>
    {error&&<div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {message&&<div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}
    <form onSubmit={submit} className="space-y-4">
      {mode==='register'&&<><label className="block text-sm font-bold">Full name<input required value={fullName} onChange={e=>setFullName(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[#0757d5]" placeholder="Your full name" /></label><label className="block text-sm font-bold">Phone number<input required value={phone} onChange={e=>setPhone(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[#0757d5]" placeholder="080..." /></label></>}
      <label className="block text-sm font-bold">Email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[#0757d5]" placeholder="you@example.com" /></label>
      <label className="block text-sm font-bold">Password<input required minLength={6} type="password" value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-[#0757d5]" placeholder="At least 6 characters" /></label>
      <button disabled={loading} className="w-full rounded-xl bg-[#0757d5] px-5 py-3.5 font-bold text-white hover:bg-[#063b93] disabled:opacity-60">{loading?'Please wait…':mode==='login'?'Sign in':'Create account'}</button>
    </form>
    <div className="mt-6 text-center text-sm text-slate-500">{mode==='login'?<>Don't have an account? <Link className="font-bold text-[#0757d5]" href="/register">Create one</Link></>:<>Already have an account? <Link className="font-bold text-[#0757d5]" href="/login">Sign in</Link></>}</div>
    {mode==='login'&&<div className="mt-3 text-center"><Link className="text-sm font-semibold text-slate-500 hover:text-[#0757d5]" href="/forgot-password">Forgot password?</Link></div>}
  </div>
}
