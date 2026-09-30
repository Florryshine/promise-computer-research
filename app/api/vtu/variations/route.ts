import {NextResponse} from 'next/server';
import {vtpassVariations} from '@/lib/vtpass';

export const dynamic='force-dynamic';

export async function GET(request:Request){
  try{
    const serviceID=new URL(request.url).searchParams.get('serviceID')?.trim();
    if(!serviceID)return NextResponse.json({error:'serviceID is required.'},{status:400});
    return NextResponse.json(await vtpassVariations(serviceID));
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Could not load VTpass variations.'},{status:502});
  }
}
