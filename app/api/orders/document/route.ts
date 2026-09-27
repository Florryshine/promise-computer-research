import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
const MAX_SIZE=10*1024*1024;
const ALLOWED=new Set(['application/pdf','image/jpeg','image/png','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
export async function POST(request:Request){
 const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 const form=await request.formData(); const orderId=String(form.get('orderId')||''); const file=form.get('file');
 if(!orderId||!(file instanceof File))return NextResponse.json({error:'Order and file are required.'},{status:400});
 if(file.size<=0||file.size>MAX_SIZE)return NextResponse.json({error:'File must be 10MB or smaller.'},{status:400});
 if(file.type&&!ALLOWED.has(file.type))return NextResponse.json({error:'File type not supported. Use PDF, JPG, PNG, WEBP or Word documents.'},{status:400});
 const {data:order}=await supabase.from('orders').select('id').eq('id',orderId).eq('customer_id',user.id).maybeSingle();
 if(!order)return NextResponse.json({error:'Order not found.'},{status:404});
 const admin=createAdminClient(); const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120); const path=user.id+'/'+orderId+'/'+crypto.randomUUID()+'-'+safeName;
 const {error:uploadError}=await admin.storage.from('order-documents').upload(path,await file.arrayBuffer(),{contentType:file.type||'application/octet-stream',upsert:false});
 if(uploadError)return NextResponse.json({error:uploadError.message},{status:500});
 const {data:doc,error:insertError}=await admin.from('order_documents').insert({order_id:orderId,file_name:file.name.slice(0,255),storage_path:path,mime_type:file.type||null,size_bytes:file.size}).select('id,file_name,mime_type,size_bytes,created_at').single();
 if(insertError){await admin.storage.from('order-documents').remove([path]);return NextResponse.json({error:insertError.message},{status:500});}
 return NextResponse.json({ok:true,document:doc});
}