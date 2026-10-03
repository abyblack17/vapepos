const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),React=require('react')
const source=fs.readFileSync(path.resolve(__dirname,'../src/components/ui/Modal.jsx'),'utf8').replace(/^import .*$/gm,'').replace('export default function Modal','function Modal')
const code=require('esbuild').transformSync(source,{loader:'jsx'}).code
function fixture(){
 let calls=0;const handlers=new Map(),cleanups=[]
 const context={React,createPortal:x=>x,document:{body:{style:{overflow:'auto'}}},window:{addEventListener:(k,fn)=>handlers.set(k,fn),removeEventListener:(k,fn)=>{if(handlers.get(k)===fn)handlers.delete(k)}},useEffect:fn=>cleanups.push(fn())}
 vm.createContext(context);vm.runInContext(code,context)
 const render=(props={})=>context.Modal({title:'Nuevo líquido',onClose:()=>calls++,children:React.createElement('input',{defaultValue:'Mango'}),...props})
 return{render,context,handlers,cleanups,count:()=>calls}
}
test('outside clicks, drag ending outside and Escape never close a form by default',()=>{
 const f=fixture(),modal=f.render(),backdrop={}
 modal.props.onClick({target:backdrop,currentTarget:backdrop})
 modal.props.onClick({target:{},currentTarget:backdrop})
 f.handlers.get('keydown')({key:'Escape',defaultPrevented:false})
 f.handlers.get('keydown')({key:'Enter',defaultPrevented:false})
 assert.equal(f.count(),0)
 const panel=modal.props.children[0];assert.equal(panel.props.role,'dialog')
 let stopped=false;panel.props.onClick({stopPropagation:()=>stopped=true});assert.equal(stopped,true)
})
test('X remains an explicit close button and cannot accidentally submit a parent form',()=>{
 const f=fixture(),modal=f.render(),button=modal.props.children[0].props.children[0].props.children[1]
 assert.equal(button.props.type,'button');assert.equal(button.props['aria-label'],'Cerrar ventana')
 button.props.onClick();assert.equal(f.count(),1)
})
test('ordinary rerenders and effect cleanup do not invoke close and restore scrolling',()=>{
 const f=fixture();f.render();assert.equal(f.context.document.body.style.overflow,'hidden')
 f.cleanups.pop()();assert.equal(f.count(),0);assert.equal(f.context.document.body.style.overflow,'auto')
 f.render({children:React.createElement('input',{defaultValue:'Mango Ice'})});assert.equal(f.count(),0)
 f.cleanups.pop()();assert.equal(f.handlers.size,0)
})
test('optional dismissal only works when explicitly enabled, never for child clicks or handled Escape',()=>{
 const f=fixture(),modal=f.render({closeOnBackdrop:true,closeOnEscape:true}),backdrop={}
 modal.props.onClick({target:{},currentTarget:backdrop});assert.equal(f.count(),0)
 f.handlers.get('keydown')({key:'Escape',defaultPrevented:true});assert.equal(f.count(),0)
 modal.props.onClick({target:backdrop,currentTarget:backdrop});assert.equal(f.count(),1)
 f.handlers.get('keydown')({key:'Escape',defaultPrevented:false});assert.equal(f.count(),2)
})
