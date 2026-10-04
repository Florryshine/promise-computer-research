import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

async function getAdmin(){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return null;
  const {data:profile}=await supabase.from('profiles').select('role').eq('id',user.id).maybeSingle();
  return profile?.role==='admin'?user:null;
}

async function uploadForOrder(request:Request){
  const adminUser=await getAdmin();
  if(!adminUser)return NextResponse.json({error:'Forbidden'},{status:403});

  const form=await request.formData();
  const orderId=String(form.get('orderId')||'');
  const file=form.get('file');

  if(!orderId||!(file instanceof File)){
    return NextResponse.json({error:'Order and file are required.'},{status:400});
  }

  if(file.size<=0||file.size>MAX_SIZE){
    return NextResponse.json({error:'File must be 10MB or smaller.'},{status:400});
  }

  if(!file.type||!ALLOWED.has(file.type)){
    return NextResponse.json({
      error:'File type not supported. Use PDF, JPG, PNG, WEBP or Word documents.'
    },{status:400});
  }

  const admin=createAdminClient();
  const {data:order}=await admin
    .from('orders')
    .select('id,customer_id,reference')
    .eq('id',orderId)
    .maybeSingle();

  if(!order)return NextResponse.json({error:'Order not found.'},{status:404});

  const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120);
  const path='admin/'+orderId+'/'+crypto.randomUUID()+'-'+safeName;

  const {error:uploadError}=await admin.storage
    .from('order-documents')
    .upload(path,await file.arrayBuffer(),{
      contentType:file.type,
      upsert:false
    });

  if(uploadError){
    return NextResponse.json({error:uploadError.message},{status:500});
  }

  const {data:doc,error:insertError}=await admin
    .from('order_documents')
    .insert({
      order_id:orderId,
      file_name:file.name.slice(0,255),
      storage_path:path,
      mime_type:file.type,
      size_bytes:file.size
    })
    .select('id,file_name,mime_type,size_bytes,created_at')
    .single();

  if(insertError){
    await admin.storage.from('order-documents').remove([path]);
    return NextResponse.json({error:insertError.message},{status:500});
  }

  await admin.from('notifications').insert({
    user_id:order.customer_id,
    title:'New document added',
    message:'A document has been added to order '+order.reference+'.'
  });

  return NextResponse.json({ok:true,document:doc});
}

export async function POST(request:Request){
  const contentType=request.headers.get('content-type')||'';

  if(contentType.toLowerCase().includes('multipart/form-data')){
    return uploadForOrder(request);
  }

  const adminUser=await getAdmin();
  if(!adminUser)return NextResponse.json({error:'Forbidden'},{status:403});

  const {orderId,note}=await request.json();
  if(!orderId)return NextResponse.json({error:'Order ID is required.'},{status:400});

  const admin=createAdminClient();
  const {data:order}=await admin
    .from('orders')
    .select('id,customer_id,reference')
    .eq('id',orderId)
    .maybeSingle();

  if(!order)return NextResponse.json({error:'Order not found.'},{status:404});

  const message=String(note||'Please upload the required document for this order.').slice(0,1000);

  const {error}=await admin
    .from('orders')
    .update({status:'needs_information',admin_note:message})
    .eq('id',orderId);

  if(error)return NextResponse.json({error:error.message},{status:500});

  await admin.from('notifications').insert({
    user_id:order.customer_id,
    title:'Document required',
    message:'Order '+order.reference+': '+message
  });

  return NextResponse.json({ok:true});
}

export async function DELETE(request:Request){
  if(!(await getAdmin()))return NextResponse.json({error:'Forbidden'},{status:403});

  const {documentId}=await request.json();
  if(!documentId)return NextResponse.json({error:'Document ID is required.'},{status:400});

  const admin=createAdminClient();
  const {data:doc}=await admin
    .from('order_documents')
    .select('id,storage_path')
    .eq('id',documentId)
    .maybeSingle();

  if(!doc)return NextResponse.json({error:'Document not found.'},{status:404});

  const {error:storageError}=await admin
    .storage.from('order-documents')
    .remove([doc.storage_path]);

  if(storageError)return NextResponse.json({error:storageError.message},{status:500});

  const {error}=await admin
    .from('order_documents')
    .delete()
    .eq('id',documentId);

  if(error)return NextResponse.json({error:error.message},{status:500});

  return NextResponse.json({ok:true});
}
