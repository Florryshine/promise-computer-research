import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';

async function getAdmin(){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return null;
  const {data:profile}=await supabase.from('profiles').select('role').eq('id',user.id).maybeSingle();
  return profile?.role==='admin'?user:null;
}

export async function DELETE(request:Request){
  if(!(await getAdmin()))return NextResponse.json({error:'Forbidden'},{status:403});
  const {documentId}=await request.json();
  if(!documentId)return NextResponse.json({error:'Document ID is required.'},{status:400});
  const admin=createAdminClient();
  const {data:doc}=await admin.from('order_documents').select('id,storage_path').eq('id',documentId).maybeSingle();
  if(!doc)return NextResponse.json({error:'Document not found.'},{status:404});
  const {error:storageError}=await admin.storage.from('order-documents').remove([doc.storage_path]);
  if(storageError)return NextResponse.json({error:storageError.message},{status:500});
  const {error}=await admin.from('order_documents').delete().eq('id',documentId);
  if(error)return NextResponse.json({error:error.message},{status:500});
  return NextResponse.json({ok:true});
}

export async function POST(request:Request){
  if(!(await getAdmin()))return NextResponse.json({error:'Forbidden'},{status:403});
  const {orderId,note}=await request.json();
  if(!orderId)return NextResponse.json({error:'Order ID is required.'},{status:400});
  const admin=createAdminClient();
  const {data:order}=await admin.from('orders').select('id,customer_id,reference').eq('id',orderId).maybeSingle();
  if(!order)return NextResponse.json({error:'Order not found.'},{status:404});
  const message=String(note||'Please upload the required document for this order.').slice(0,1000);
  const {error}=await admin.from('orders').update({status:'needs_information',admin_note:message}).eq('id',orderId);
  if(error)return NextResponse.json({error:error.message},{status:500});
  await admin.from('notifications').insert({user_id:order.customer_id,title:'Document required',message:'Order '+order.reference+': '+message});
  return NextResponse.json({ok:true});
}