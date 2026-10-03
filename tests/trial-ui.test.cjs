const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const {pathToFileURL}=require('node:url')
const path=require('node:path')
test('reminder starts at 48h, never at registration, and cannot replace expiry blocking',async()=>{
 const {trialReminderDue,trialExpired}=await import(pathToFileURL(path.resolve(__dirname,'../src/config/trial.js')))
 const hour=3600000,biz={licenseType:'trial',trialExpiresAt:new Date(72*hour).toISOString()}
 assert.equal(trialReminderDue(biz,0),false)
 assert.equal(trialReminderDue(biz,24*hour-1),false)
 assert.equal(trialReminderDue(biz,24*hour),true)
 assert.equal(trialReminderDue(biz,72*hour-1),true)
 assert.equal(trialReminderDue(biz,72*hour),false)
 assert.equal(trialExpired(biz,72*hour),true)
 assert.equal(trialReminderDue({...biz,licenseType:'permanent'},48*hour),false)
})
test('registration signs in normalized email; login failure preserves successful creation',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../src/contexts/AuthContext.jsx'),'utf8')
 const code=source.slice(source.indexOf('  const registerBusiness ='),source.indexOf('  // ── Add employee'))+'\nthis.register=registerBusiness'
 for(const failLogin of [false,true]){
  let created=0,signedIn=0
  const context={setError:()=>{},getFunctions:()=>({}),httpsCallable:()=>async data=>{created++;assert.equal(data.email,'owner@example.com');return{data:{success:true,businessId:'shop'}}},auth:{},signInWithEmailAndPassword:async(_,email)=>{signedIn++;assert.equal(email,'owner@example.com');if(failLogin)throw Error('network') }}
  vm.createContext(context);vm.runInContext(code,context)
  const result=await context.register({email:' Owner@Example.com ',password:'password123',ownerName:'Owner',businessName:'Shop'})
  assert.equal(result.success,true);assert.equal(result.autoLogin,!failLogin);assert.equal(created,1);assert.equal(signedIn,1)
 }
})
test('reminder can be dismissed and expiry gate remains independent',async()=>{
 const React=require('react'),{trialDeadline,trialReminderDue}=await import(pathToFileURL(path.resolve(__dirname,'../src/config/trial.js')))
 const source=fs.readFileSync(path.resolve(__dirname,'../src/components/common/TrialReminder.jsx'),'utf8').replace(/^import .*$/gm,'').replace('export default function','function')
 const code=require('esbuild').transformSync(source,{loader:'jsx'}).code
 const stored=new Map();let state
 const context={React,PurchaseOptions:()=>null,trialDeadline,trialReminderDue,localStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)},useState:initial=>{if(state===undefined)state=initial();return[state,value=>state=value]}}
 vm.createContext(context);vm.runInContext(code,context)
 const props={business:{id:'shop',licenseType:'trial',trialExpiresAt:new Date(72*3600000).toISOString()},now:24*3600000}
 const tree=context.TrialReminder(props),section=tree.props.children
 section.props.children.find(child=>child?.type==='button').props.onClick()
 assert.equal(context.TrialReminder(props),null)
 assert.equal(stored.size,1)
 state=undefined;assert.equal(context.TrialReminder(props),null)
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.jsx'),'utf8')
 assert.ok(app.indexOf('if (trialExpired(business, accessNow))')<app.indexOf('<TrialReminder'))
 assert.equal(fs.readFileSync(path.resolve(__dirname,'../src/pages/auth/Register.jsx'),'utf8').includes('PurchaseOptions'),false)
})
test('offline cached timestamps expire at exactly 72h; purchase is never trial-blocked',async()=>{
 const policy=await import(pathToFileURL(path.resolve(__dirname,'../src/config/trial.js')))
 const biz={licenseType:'trial',trialExpiresAt:{seconds:1000,nanoseconds:0}}
 assert.equal(policy.trialExpired(biz,999999),false)
 assert.equal(policy.trialExpired(biz,1000000),true)
 assert.equal(policy.trialExpired({...biz,licenseType:'permanent'},2000000),false)
 assert.equal(policy.trialExpired({licenseType:'trial'}),true)
 assert.deepEqual(policy.PURCHASE_OPTIONS.map(p=>[p.price,p.months]),[[5000,2],[8000,3],[14000,5]])
})
test('Pro expiry leaves lifetime user in Basic without deleting products or deactivating users',async()=>{
 const {PLANS}=await import(pathToFileURL(path.resolve(__dirname,'../src/config/plans.js')))
 const {timestampMillis}=await import(pathToFileURL(path.resolve(__dirname,'../src/config/trial.js')))
 const state={products:Array.from({length:100},(_,id)=>({id,active:true})),users:[{role:'Administrador'},{role:'Cajero'},{role:'Cajero'}]}
 const before=JSON.stringify(state)
 const business={licenseType:'permanent',plan:'pro',planExpiresAt:{seconds:1000}}
 const context={PLANS,timestampMillis,useMemo:fn=>fn(),useAuth:()=>({business,accessNow:1000000}),useApp:()=>({state})}
 vm.createContext(context)
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/hooks/usePlan.js'),'utf8').replace(/^import .*$/gm,'').replace('export function usePlan','function usePlan')+'\nresult=usePlan()',context)
 assert.equal(context.result.isBasic,true)
 assert.equal(context.result.isTrial,false)
 assert.equal(context.result.canAdd('products'),false)
 assert.equal(context.result.canAdd('users'),false)
 assert.equal(JSON.stringify(state),before)
})
