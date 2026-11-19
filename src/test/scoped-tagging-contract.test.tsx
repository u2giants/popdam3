import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({rpc:vi.fn(), wait:vi.fn(), call:vi.fn(), toast: Object.assign(vi.fn(), {error:vi.fn()})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:m.rpc}}));
vi.mock('@/hooks/useBulkOperationWaiter',()=>({useBulkOperationWaiter:()=>m.wait}));
vi.mock('@/hooks/useAdminApi',()=>({useAdminApi:()=>({call:m.call})}));
vi.mock('sonner',()=>({toast:m.toast}));
import {useSingleAssetTagging} from '@/hooks/useSingleAssetTagging';
import {useScopedTagMutation} from '@/hooks/useScopedTagMutation';
const deferred = () => { let resolve!: (v:any)=>void; const promise = new Promise<any>(r=>resolve=r); return {promise,resolve}; };
beforeEach(()=>{vi.clearAllMocks();m.rpc.mockResolvedValue({error:null});m.call.mockResolvedValue({});});
describe('artwork tagging workflows',()=>{
 it('retains started target and receipt after selection changes',async()=>{
  const d=deferred();m.wait.mockReturnValue(d.promise);const done=vi.fn();
  const {result,rerender}=renderHook(({id})=>({id,...useSingleAssetTagging(done)}),{initialProps:{id:'A'}});
  let pending!:Promise<void>;act(()=>{pending=result.current.run(result.current.id)});await act(async()=>{await Promise.resolve()});
  rerender({id:'B'});await act(async()=>{d.resolve({status:'completed'});await pending});
  expect(done).toHaveBeenCalledWith('A');expect(m.wait).toHaveBeenCalledWith('ai-tag-single-A');
  expect(m.rpc).toHaveBeenCalledTimes(1);expect(m.rpc.mock.calls[0][1].p_op_state.params).toEqual({type:'bulk-ai-tag-all',asset_ids:['A'],total:1});
  expect(m.toast).toHaveBeenCalledWith('AI tagging complete');expect(result.current.aiTagging).toBe(false);
 });
 it.each([{status:'failed',error:'provider failed',message:'provider failed'},{status:'failed',error:'',message:'AI tagging failed'}])('preserves failure notifications',async({status,error,message})=>{
  m.wait.mockResolvedValue({status,error});const done=vi.fn();const {result}=renderHook(()=>useSingleAssetTagging(done));
  await act(async()=>{await result.current.run('A')});expect(m.toast.error).toHaveBeenCalledWith('AI tagging failed',{description:message});expect(done).not.toHaveBeenCalled();
 });
 it('aborted waiter emits no completion or toast',async()=>{m.wait.mockResolvedValue({status:'aborted'});const done=vi.fn();const {result}=renderHook(()=>useSingleAssetTagging(done));await act(async()=>{await result.current.run('A')});expect(done).not.toHaveBeenCalled();expect(m.toast).not.toHaveBeenCalled();expect(m.toast.error).not.toHaveBeenCalled();});
 it.each([{scope:'asset',action:'add',method:'add-scoped-tag',payload:{scope:'asset',tag:'X',asset_id:'A'}},{scope:'group',action:'remove',method:'remove-scoped-tag',payload:{scope:'group',tag:'X',style_group_id:'G'}},{scope:'group',action:'approve',method:'review-scoped-tag',payload:{scope:'group',tag:'X',style_group_id:'G',decision:'approve'}}] as const)('sends correct scope and action',async({scope,action,method,payload})=>{const done=vi.fn();const {result}=renderHook(()=>useScopedTagMutation({assetId:'A',styleGroupId:'G',onSuccess:done}));await act(async()=>{await result.current.handleTagAction({scope,action,tag:'X'} as any)});expect(m.call).toHaveBeenCalledWith(method,payload);expect(done).toHaveBeenCalledWith('A');});
 it('preserves scoped mutation failure',async()=>{m.call.mockRejectedValue(new Error('no'));const done=vi.fn();const {result}=renderHook(()=>useScopedTagMutation({assetId:'A',styleGroupId:'G',onSuccess:done}));await act(async()=>{await result.current.handleTagAction({scope:'asset',action:'add',tag:'X'} as any)});expect(m.toast.error).toHaveBeenCalledWith('Could not update tags',{description:'no'});expect(done).not.toHaveBeenCalled();});
});
