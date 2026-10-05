import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {vtpassConfigured} from '@/lib/vtpass';

export const dynamic='force-dynamic';

export async function GET(){
  try{
    const supabase=await createClient();
    const {data:{user}}=await supabase.auth.getUser();
    if(!user)return NextResponse.json({ok:false,error:'Login required.'},{status:401});

    const {data:profile}=await supabase.from('profiles').select('role').eq('id',user.id).maybeSingle();
    if(profile?.role!=='admin')return NextResponse.json({ok:false,error:'Admin access required.'},{status:403});

    const baseUrl=(process.env.VTUTELECOM_BASE_URL||'https://vtutelecom.ng/api').replace(/\/$/,'');
    return NextResponse.json({
      ok:true,
      configured:vtpassConfigured(),
      baseUrl,
      sandbox:baseUrl.includes('sandbox')
    });
  }catch(error){
    return NextResponse.json({
      ok:false,
      error:error instanceof Error?error.message:'VTUTelecom connection check failed.'
    },{status:500});
  }
}
