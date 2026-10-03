const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const {pathToFileURL}=require('node:url')
const policy=()=>import(pathToFileURL(path.resolve(__dirname,'../src/services/syncRecovery.js')))
test('missing liquid updates recover only with same-owner, same-epoch explicit later deletion',async()=>{
 const {isMissingLiquidSuperseded:recover}=await policy()
 const update={id:'old-update',name:'applyBusinessMutation',uid:'owner',businessId:'shop',epoch:0,sequence:9,payload:{collection:'liquids',documentId:'old-liquid',action:'update',data:{activeSaldo:95}}}
 const deletion={...update,id:'delete',sequence:19,payload:{...update.payload,action:'delete'}}
 const error={code:'functions/not-found',message:'El registro ya no existe. [404]'}
 assert.equal(recover(update,error,[update,deletion]),true)
 for(const change of [{uid:'other'},{businessId:'other'},{epoch:1},{sequence:8}])assert.equal(recover(update,error,[update,{...deletion,...change}]),false)
 assert.equal(recover(update,error,[update]),false)
 assert.equal(recover(update,{code:'functions/unavailable',message:'network'},[update,deletion]),false)
 assert.equal(recover({...update,name:'commitSale'},error,[update,deletion]),false)
 assert.equal(recover({...update,payload:{...update.payload,collection:'customers'}},error,[update,deletion]),false)
 const movement={...update,name:'openLiquidBottle',sequence:10,payload:{liquidId:'old-liquid'}}
 assert.equal(recover(update,error,[update,movement,deletion]),false)
 const sale={...movement,name:'commitSale',payload:{sale:{refills:[{liquidId:'old-liquid'}]}}}
 assert.equal(recover(update,error,[update,sale,deletion]),false)
 const recreate={...deletion,sequence:10,payload:{...deletion.payload,action:'set'}}
 assert.equal(recover(update,error,[update,recreate,deletion]),false)
 const otherDelete={...deletion,payload:{...deletion.payload,documentId:'new-liquid'}}
 assert.equal(recover(update,error,[update,otherDelete]),false)
})
test('only known rejected legacy liquid updates qualify for preservation',async()=>{
 const {isRejectedLegacyLiquid}=await policy()
 const operation={name:'applyBusinessMutation',payload:{collection:'liquids',action:'update',data:{activeSaldo:20}},error:'Usa los movimientos de líquidos para cambiar el saldo. [403]'}
 assert.equal(isRejectedLegacyLiquid(operation),true)
 assert.equal(isRejectedLegacyLiquid({...operation,error:'network error'}),false)
 assert.equal(isRejectedLegacyLiquid({...operation,name:'commitSale'}),false)
 assert.equal(isRejectedLegacyLiquid({...operation,payload:{...operation.payload,collection:'products'}}),false)
 assert.equal(isRejectedLegacyLiquid({...operation,payload:{...operation.payload,action:'delete'}}),false)
})
test('loading has a bounded timeout and preserves timely responses',async()=>{
 const {withLoadDeadline}=await policy()
 assert.equal(await withLoadDeadline(Promise.resolve('cached'),50),'cached')
 await assert.rejects(withLoadDeadline(new Promise(()=>{}),15),/tardando demasiado/)
})
test('legacy opening and balance adjustments use authorized movements, not direct balances',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../src/hooks/useFirestoreSync.js'),'utf8').replace(/^import \{[\s\S]*?\} from .*$/gm,'').replace('export function','function')
 const calls=[],context={useCallback:fn=>fn,queueOperation:async(...args)=>calls.push(args),console,bizUpdate:()=>{throw Error('direct write forbidden')}}
 vm.createContext(context);vm.runInContext(source+'\nthis.sync=useFirestoreSync("shop")',context)
 await context.sync({type:'OPEN_BOTTLE',payload:{liquidId:'mango'}},{liquids:[]})
 await context.sync({type:'ADJUST_SALDO',payload:{liquidId:'mango',newSaldo:'30',reason:'Conteo físico'}},{liquids:[]})
 assert.equal(calls[0][0],'openLiquidBottle');assert.equal(calls[1][0],'adjustLiquidBalance');assert.equal(calls[1][1].newBalance,30)
})
test('local preservation is atomic, retains original payload and cannot silently drop failed changes',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../src/services/offlineStore.js'),'utf8')
 const calls=[];let tx
 const context={Date,openOfflineStore:async()=>({transaction:()=>{tx={objectStore:()=>({put:(...args)=>calls.push(['put',...args]),delete:(...args)=>calls.push(['delete',...args])})};return tx}})}
 vm.createContext(context)
 const start=source.indexOf('export async function preserveForReview'),end=source.indexOf('export async function listReviewOperations')
 vm.runInContext(source.slice(start,end).replace('export async function','async function'),context)
 const original={id:'original',payload:{data:{activeSaldo:20}},error:'403'}
 const pending=context.preserveForReview(original);await new Promise(resolve=>setImmediate(resolve))
 assert.equal(calls[0][0],'put');assert.equal(calls[0][2],'review:original');assert.equal(calls[0][1].payload,original.payload);assert.equal(calls[0][1].reviewRequired,true)
 assert.equal(calls[1][0],'delete');assert.equal(calls[1][1],'operation:original');tx.oncomplete();await pending
})
