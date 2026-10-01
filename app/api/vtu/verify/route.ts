import {NextResponse} from 'next/server';
import {verifyMerchant} from '@/lib/vtpass';

export async function POST(request:Request){
  try{
    const body=await request.json();
    const serviceID=String(body.serviceID||'').trim();
    const billersCode=String(body.billersCode||'').trim();
    const type=body.type?String(body.type).trim():undefined;
    if(!serviceID||!billersCode)return NextResponse.json({error:'serviceID and billersCode are required.'},{status:400});
    return NextResponse.json(await verifyMerchant(serviceID,billersCode,type));
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Could not verify the customer.'},{status:502});
  }
}
