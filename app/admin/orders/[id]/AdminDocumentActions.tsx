'use client';

import {useRef,useState} from 'react';

export default function AdminDocumentActions({documentId,orderId}:{documentId?:string;orderId:string}){
  const input=useRef<HTMLInputElement>(null);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');

  async function upload(){
    const file=input.current?.files?.[0];
    if(!file)return;
    setLoading(true);
    setMessage('');

    const body=new FormData();
    body.append('orderId',orderId);
    body.append('file',file);

    try{
      const response=await fetch('/api/admin/document',{method:'POST',body});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Upload failed.');
      setMessage('Document uploaded.');
      if(input.current)input.current.value='';
      setTimeout(()=>window.location.reload(),500);
    }catch(error){
      setMessage(error instanceof Error?error.message:'Upload failed.');
    }finally{
      setLoading(false);
    }
  }

  async function remove(){
    if(!documentId)return;
    if(!window.confirm('Remove this document from the order?'))return;
    setLoading(true);
    setMessage('');

    try{
      const response=await fetch('/api/admin/document',{
        method:'DELETE',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({documentId})
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not remove document.');
      window.location.reload();
    }catch(error){
      setMessage(error instanceof Error?error.message:'Could not remove document.');
      setLoading(false);
    }
  }

  async function requestDocument(){
    const note=window.prompt(
      'Tell the customer what document is needed:',
      'Please upload the required document for this order.'
    );
    if(note===null)return;

    setLoading(true);
    setMessage('');

    try{
      const response=await fetch('/api/admin/document',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({orderId,note})
      });
      const data=await response.json();
      setMessage(response.ok?'Customer notified.':data.error||'Could not notify customer.');
    }catch{
      setMessage('Could not notify customer.');
    }finally{
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
          className="block max-w-full rounded-xl border border-slate-200 bg-white p-2 text-xs"
        />
        <button
          type="button"
          onClick={upload}
          disabled={loading}
          className="rounded-xl bg-[#0757d5] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {loading?'Uploading…':'Upload'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {documentId&&(
          <button
            type="button"
            onClick={remove}
            disabled={loading}
            className="rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-600 disabled:opacity-50"
          >
            Remove
          </button>
        )}
        {!documentId&&(
          <button
            type="button"
            onClick={requestDocument}
            disabled={loading}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
          >
            Request document
          </button>
        )}
        {message&&<span className="self-center text-xs text-slate-500">{message}</span>}
      </div>
    </div>
  );
}
