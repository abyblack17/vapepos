const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const source=fs.readFileSync(path.resolve(__dirname,'../src/services/liquidService.js'),'utf8').replace(/^import .*$/gm,'').replace(/export /g,'')
const context={};vm.createContext(context);vm.runInContext(source,context)
const settings={refillButtons:[{price:25,points:5},{price:50,points:10},{price:100,points:15}]}
const liquid={id:'one',name:'Frasco 1',sizeML:100,activeCapacity:100,costPerBottle:480,pricePerBottle:650,hasActive:true,activeSaldo:100,refillConsumption:{25:2,50:4,100:8}}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+' != '+expected)
test('user example: per-liquid consumption, fractional yield, cost, revenue and benefit',()=>{
 const rows=context.getRefillProjections(liquid,settings)
 assert.deepEqual(Array.from(rows,r=>r.price),[25,50,100])
 for(const [i,expected] of [50,25,12.5].entries()){
  close(rows[i].expected,expected);close(rows[i].profit,[15.4,30.8,61.6][i]);close(rows[i].revenue,1250);close(rows[i].benefit,770)
 }
 close(rows[2].complete,12);close(rows[2].remaining,4)
 close(context.getExpectedRecharges(liquid,100,settings),12.5)
 close(context.getTotalPotentialProfit(liquid,100,settings),770)
 const item=context.buildRefillCartItem(liquid,100,settings);close(item.points,8);close(item.cost,38.4)
})
test('30ml salt bottle consumes 3ml at the same RD100 price and yields 10 refills',()=>{
 const salt={...liquid,sizeML:30,activeCapacity:30,activeSaldo:30,costPerBottle:300,refillConsumption:{100:3}}
 const row=context.getRefillProjections(salt,settings).find(r=>r.price===100)
 close(row.expected,10);close(row.cost,30);close(row.profit,70);close(row.revenue,1000);close(row.benefit,700)
 close(context.buildRefillCartItem(salt,100,settings).points,3)
 salt.refillConsumption[100]=6;close(context.getExpectedRecharges(salt,100,settings),5)
 salt.refillConsumption[100]=1.5;close(context.getExpectedRecharges(salt,100,settings),20)
})
test('Settings owns prices; liquid override wins, legacy survives and new prices inherit defaults',()=>{
 close(context.getPointsForType({pointsR100:8},100,settings),8)
 close(context.getPointsForType({},100,settings),15)
 const changed={refillButtons:[{price:75,points:2.5}]}
 assert.deepEqual(Array.from(context.getRefillProjections(liquid,changed),r=>r.price),[75])
 close(context.getPointsForType(liquid,75,changed),2.5)
 close(context.getPointsForType(liquid,100,changed),0)
 assert.equal(context.canRefill(liquid,100,changed),false)
 assert.throws(()=>context.buildRefillCartItem(liquid,100,changed))
})
test('historic recorded cost is preserved and projections do not multiply by opened bottles',()=>{
 const report=context.getRendimientoReport({...liquid,totalOpenedBottles:5,totalRevenueAllTime:100,totalRechargesAllTime:1},[{liquidId:'one',price:100,pointsConsumed:8,cost:20}],settings)
 close(report.realNetProfit,80);close(report.totalPotential,770)
 close(context.getRendimientoReport({...liquid,totalRevenueAllTime:100},[{liquidId:'one',price:100,pointsConsumed:3}],settings).realNetProfit,85.6)
 assert.equal(context.fmtLiquidMoney(15.4).endsWith('15.40'),true)
})
test('ml conversion supports older point capacities without changing the stock scale',()=>{
 const old={...liquid,sizeML:30,activeCapacity:100,refillConsumption:{100:3/(30/100)}}
 close(context.getExpectedRecharges(old,100,settings),10)
 close(context.getPointsForType(old,100,settings)*old.sizeML/old.activeCapacity,3)
})
test('invalid and empty capacities do not produce NaN or infinite projections',()=>{
 for(const capacity of [0,'',null])for(const row of context.getRefillProjections({...liquid,activeCapacity:capacity},settings)){
  close(row.expected,0);close(row.revenue,0);close(row.benefit,0)
 }
})

test('rendered form uses configured prices and projections show each bottle consumption',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),esbuild=require('esbuild')
 const page=fs.readFileSync(path.resolve(__dirname,'../src/pages/Refills.jsx'),'utf8')
 const formSource=page.slice(page.indexOf('function LiquidFormModal('),page.indexOf('function ConfirmDeleteModal('))
 const projectionSource=page.slice(page.indexOf('function LiquidProjectionCard('))
 const ui={React,useState:React.useState,Modal:({children})=>React.createElement('div',null,children),genId:()=> 'new',
  getRefillButtons:context.getRefillButtons,getPointsForType:context.getPointsForType,getRefillProjections:context.getRefillProjections,fmtProjection:context.fmtProjection,fmtLiquidMoney:context.fmtLiquidMoney}
 vm.createContext(ui);vm.runInContext(esbuild.transformSync(formSource+'\n'+projectionSource,{loader:'jsx'}).code,ui)
 const html=renderToStaticMarkup(React.createElement(ui.LiquidFormModal,{settings,onSave:()=>{},onClose:()=>{}}))
 assert.doesNotMatch(html,/Proyecciones por frasco|Ingreso proyectado|Beneficio proyectado|Beneficio por recarga/)
 assert.match(html,/RD\$ 25/);assert.match(html,/RD\$ 50/);assert.match(html,/RD\$ 100/);assert.doesNotMatch(html,/RD\$150|RD\$ 150/)
 const salt={...liquid,name:'Sales 30',sizeML:30,activeCapacity:30,refillConsumption:{100:3}}
 const projection=renderToStaticMarkup(React.createElement(ui.LiquidProjectionCard,{liquid:salt,settings}))
 assert.match(projection,/Consume 3 pts \(3 ml\)/);assert.match(projection,/Rinde 10 recargas/)
 const example=renderToStaticMarkup(React.createElement(ui.LiquidProjectionCard,{liquid,settings}))
 assert.match(example,/RD\$15.40/);assert.match(example,/RD\$770.00/);assert.match(example,/12.5 recargas/)
})

 test('performance cards are only accessible within the Pro performance section',()=>{
 const page=fs.readFileSync(path.resolve(__dirname,'../src/pages/Refills.jsx'),'utf8')
 assert.equal((page.match(/<LiquidProjectionCard\b/g)||[]).length,1)
 const section=page.slice(page.indexOf("{tab === 'Rendimiento'"),page.indexOf('{/* ── Modals'))
 assert.match(section,/canViewRendimiento \?/);assert.match(section,/<LiquidProjectionCard/)
 const details=page.slice(page.indexOf('function LiquidDetailModal('),page.indexOf('function LiquidProjectionCard('))
 assert.doesNotMatch(details,/LiquidProjectionCard|getRendimientoReport|Ganancia real/)
 assert.match(page,/getPointsForType\(l, b.price, state.settings\)\)\)\.join\('\/'\)/)
 })
