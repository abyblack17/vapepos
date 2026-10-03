const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const path=require('node:path')
const React=require('react')
test('edit modal puts add-open below closed bottles, shows remaining ml and forwards it on save',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../src/pages/Refills.jsx'),'utf8')
 const start=source.indexOf('function LiquidFormModal(')
 const end=source.indexOf('function ConfirmDeleteModal(',start)
 const code=require('esbuild').transformSync(source.slice(start,end),{loader:'jsx'}).code
 let cursor=0;const states=[]
 const useState=initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value]}
 const context={React,useState,Modal:()=>null,genId:()=> 'new',toast:{error:()=>{}},uploadLiquidImage:()=>{},console}
 vm.createContext(context);vm.runInContext(code,context)
 const liquid={id:'mango',name:'Mango',activeCapacity:100,activeSaldo:60,closedBottles:2}
 let saved
 const render=()=>{cursor=0;return context.LiquidFormModal({liquid,settings:{},onSave:data=>saved=data,onClose:()=>{},title:'Editar: Mango'})}
 const flatten=node=>Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.props?.children)]:[node]
 let nodes=flatten(render())
 assert.ok(nodes.indexOf('Añadir frasco abierto')>nodes.indexOf('Botellas cerradas'))
 assert.equal(nodes.includes('ML restantes del frasco abierto'),false)
 const toggle=nodes.find(n=>n?.type==='input'&&n.props.type==='checkbox'&&n.props.checked===false&&!n.props.id&&n.props.disabled===false)
 assert.ok(toggle);toggle.props.onChange({target:{checked:true}})
 nodes=flatten(render())
 const ml=nodes.find(n=>n?.type==='input'&&n.props.placeholder==='Ej.: 35')
 assert.ok(ml);assert.equal(ml.props.max,100);ml.props.onChange({target:{value:'35'}})
 nodes=flatten(render())
 await nodes.find(n=>n?.type==='button'&&n.props.children==='Guardar Cambios').props.onClick()
 assert.equal(saved.id,'mango');assert.equal(saved.addOpenBottle,true);assert.equal(saved.openML,'35');assert.equal(saved.closedBottles,2)
})
