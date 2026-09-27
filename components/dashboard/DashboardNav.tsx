import Link from 'next/link';
import SignOutButton from './SignOutButton';
import {createClient} from '@/lib/supabase/server';

export default async function DashboardNav(){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  const {count}=user?await supabase.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('read',false):{count:0};
  return <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
    <nav className="flex flex-wrap gap-2">
      <Link href="/dashboard" className="rounded-xl bg-[#0757d5] px-4 py-2 text-sm font-bold text-white">Overview</Link>
      <Link href="/dashboard/orders" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold">My Orders</Link>
      <Link href="/dashboard/notifications" className="relative rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold">Notifications {Number(count||0)>0&&<span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">{Number(count)>99?'99+':count}</span>}</Link>
      <Link href="/dashboard/profile" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold">Profile</Link>
    </nav>
    <SignOutButton/>
  </div>
}