import {createClient} from '@/lib/supabase/server';
import MarkNotificationsRead from './MarkNotificationsRead';

export default async function NotificationsPage(){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  const {data:notifications}=await supabase.from('notifications').select('id,title,message,read,created_at').eq('user_id',user!.id).order('created_at',{ascending:false}).limit(100);
  return <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-7">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-bold text-[#0757d5]">ACCOUNT UPDATES</p><h1 className="mt-1 text-2xl font-black">Notifications</h1><p className="mt-1 text-sm text-slate-500">Payment confirmations, order updates and requests from Promise Computer Research.</p></div>
      <MarkNotificationsRead hasUnread={Boolean((notifications||[]).some(n=>!n.read))}/>
    </div>
    <div className="mt-6 space-y-3">
      {!notifications?.length?<div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center"><p className="font-bold">No notifications yet.</p><p className="mt-1 text-sm text-slate-500">Updates about your orders will appear here.</p></div>:
      notifications.map(n=><div key={n.id} className={'rounded-2xl border p-4 '+(n.read?'border-slate-200 bg-white':'border-blue-100 bg-blue-50')}>
        <div className="flex items-start justify-between gap-4"><div><p className="font-black">{n.title}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{n.message}</p></div>{!n.read&&<span className="mt-1 shrink-0 rounded-full bg-[#0757d5] px-2 py-1 text-[10px] font-black text-white">NEW</span>}</div>
        <p className="mt-3 text-xs text-slate-400">{new Date(n.created_at).toLocaleString()}</p>
      </div>)}
    </div>
  </section>;
}