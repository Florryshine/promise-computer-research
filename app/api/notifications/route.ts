import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';

export async function PATCH(request:Request){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
  try{
    const body=await request.json();
    if(body.all===true){
      const {error}=await supabase.from('notifications').update({read:true}).eq('user_id',user.id).eq('read',false);
      if(error)return NextResponse.json({error:error.message},{status:500});
      return NextResponse.json({ok:true});
    }
    if(body.id){
      const {error}=await supabase.from('notifications').update({read:true}).eq('id',String(body.id)).eq('user_id',user.id);
      if(error)return NextResponse.json({error:error.message},{status:500});
      return NextResponse.json({ok:true});
    }
    return NextResponse.json({error:'Notification id or all=true is required.'},{status:400});
  }catch{return NextResponse.json({error:'Invalid request.'},{status:400});}
}