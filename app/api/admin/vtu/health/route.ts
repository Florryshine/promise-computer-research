import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {vtpassServiceCategories,vtpassBaseUrl} from '@/lib/vtpass';

export const dynamic='force-dynamic';

export async function GET(){
  try{
    const supabase=await createClient();
    const {data:{user}}=await supabase.auth.getUser();
    if(!user)return NextResponse.json({ok:false,error:'Login required.'},{status:401});
    const {data:profile}=await supabase.from('profiles').select('role').eq('id',user.id).maybeSingle();
    if(profile?.role!=='admin')return NextResponse.json({ok:false,error:'Admin access required.'},{status:403});
    const data=await vtpassServiceCategories();
    return NextResponse.json({ok:true,baseUrl:vtpassBaseUrl(),sandbox:vtpassBaseUrl().includes('sandbox'),data});
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:'VTpass connection failed.'},{status:500});
  }
}
