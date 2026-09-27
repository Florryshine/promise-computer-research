import {NextResponse} from 'next/server'; import {createClient} from '@/lib/supabase/server'; import {createAdminClient} from '@/lib/supabase/admin';
export async function PATCH(request:Request){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
  const {data:profile}=await supabase.from('profiles').select('role').eq('id',user.id).maybeSingle();
  if(profile?.role!=='admin')return NextResponse.json({error:'Forbidden'},{status:403});
  const body=await request.json();
  const allowed=['pending','processing','needs_information','completed','cancelled'];
  if(!allowed.includes(body.status))return NextResponse.json({error:'Invalid status'},{status:400});
  const admin=createAdminClient();
  const {data:order,error:loadError}=await admin.from('orders').select('id,customer_id,status,admin_note,reference').eq('id',body.orderId).maybeSingle();
  if(loadError)return NextResponse.json({error:loadError.message},{status:500});
  if(!order)return NextResponse.json({error:'Order not found'},{status:404});
  const note=String(body.adminNote||'').slice(0,2000);
  const {error}=await admin.from('orders').update({status:body.status,admin_note:note}).eq('id',body.orderId);
  if(error)return NextResponse.json({error:error.message},{status:500});
  const changed=order.status!==body.status || (order.admin_note||'')!==note;
  if(changed){
    const title=body.status==='completed'?'Order completed':body.status==='cancelled'?'Order cancelled':'Order updated';
    const message=note?'Order '+order.reference+': '+note:'Order '+order.reference+' status is now '+String(body.status).replace('_',' ')+'.';
    await admin.from('notifications').insert({user_id:order.customer_id,title,message});
  }
  return NextResponse.json({ok:true});
}