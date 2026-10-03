const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
test('offline deletion restores ml beyond one bottle and all liquid metrics; duplicate local delete is harmless',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../src/contexts/AppContext.jsx'),'utf8')
 const context={createContext:()=>({}),DEFAULT_REFILL_BUTTONS:[]}
 vm.createContext(context);vm.runInContext(source.slice(0,source.indexOf('const NO_SYNC_ACTIONS')).replace(/^import .*$/gm,'').replace('export function reducer','function reducer'),context)
 const state=context.getInitialState()
 const sale={id:'sale',total:50,refills:[{liquidId:'mango',pointsConsumed:5,price:50}],items:[],bottleSales:[]}
 state.sales=[sale];state.liquids=[{id:'mango',activeSaldo:120,activeCapacity:100,totalRechargesAllTime:2,totalRevenueAllTime:100,totalPointsConsumedAllTime:10,closedBottles:3,halfBottleStock:0}]
 const next=context.reducer(state,{type:'DELETE_SALE',payload:'sale'})
 assert.equal(next.liquids[0].activeSaldo,125);assert.equal(next.liquids[0].totalRevenueAllTime,50)
 assert.equal(next.liquids[0].totalRechargesAllTime,1);assert.equal(next.liquids[0].totalPointsConsumedAllTime,5)
 assert.equal(next.liquids[0].hasActive,true);assert.equal(next.liquids[0].closedBottles,3)
 assert.equal(context.reducer(next,{type:'DELETE_SALE',payload:'sale'}).liquids[0].activeSaldo,125)
})
test('Reports queues one atomic reversal, skips legacy auto-sync, and does not remove sale if enqueue fails',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../src/pages/Reports.jsx'),'utf8')
 const code=source.slice(source.indexOf('  const handleDeleteSale ='),source.indexOf('  const handleExport ='))+'\nthis.remove=handleDeleteSale'
 for(const fail of [false,true]){
  const queued=[],dispatched=[],context={isAdmin:true,offlineCallable:async(...args)=>{queued.push(args);if(fail)throw Error('storage failed')},dispatch:action=>dispatched.push(action),toast:{success:()=>{},error:()=>{}},setDeleteConfirm:()=>{}}
  vm.createContext(context);vm.runInContext(code,context);await context.remove({id:'sale',saleNumber:'VPS-1'})
  assert.equal(queued.length,1);assert.equal(queued[0][0],'reverseSale');assert.equal(queued[0][1].saleId,'sale')
  assert.equal(dispatched.length,fail?0:1);if(!fail)assert.equal(dispatched[0]._skipSync,true)
 }
})
