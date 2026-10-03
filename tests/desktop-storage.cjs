const { app, BrowserWindow } = require('electron')
const { createServer } = require('node:http')
const { readFileSync } = require('node:fs')
const path = require('node:path')

app.setPath('userData', path.resolve(__dirname, '../.test-desktop-profile'))
const phase = process.argv[2]
const sources = path.resolve(__dirname, '../src/services')
const mockConfig = `export const control = { epoch: 0, calls: [], failure: null, missingLiquid: null };
export const auth = { currentUser: { uid: 'test-user' } }; export const db = {}; export const functions = {};`
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  response.setHeader('Content-Type', pathname === '/' ? 'text/html' : 'application/javascript')
  if (pathname === '/') return response.end('<!doctype html><title>Prueba aislada de almacenamiento</title>')
  if (pathname.endsWith('/config/firebase')) return response.end(mockConfig)
  if (pathname === '/firebase-functions') return response.end(`import { control } from '/config/firebase'; export function httpsCallable(functions, name) { return async payload => { control.calls.push({name, payload}); if (control.failure) throw control.failure; if(name==='applyBusinessMutation' && payload.action==='update' && payload.documentId===control.missingLiquid) throw {code:'functions/not-found',message:'El registro ya no existe. [404]'}; return { data: {success:true} }; }; }`)
  if (pathname === '/firebase-firestore') return response.end(`import { control } from '/config/firebase'; export const doc = () => ({}); export const getDocFromServer = async () => ({exists:()=>true, data:()=>({active:true,dataEpoch:control.epoch})});`)
  const filename = pathname.split('/').pop()
  if (!['offlineStore', 'offlineStore.js', 'offlineSync.js', 'syncRecovery', 'syncRecovery.js', 'supportMode', 'supportMode.js'].includes(filename)) { response.statusCode = 404; return response.end() }
  let source = readFileSync(path.join(sources, filename.endsWith('.js') ? filename : `${filename}.js`), 'utf8')
  source = source.replace("'firebase/functions'", "'/firebase-functions'").replace("'firebase/firestore'", "'/firebase-firestore'")
  response.end(source)
})

app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(17820, '127.0.0.1', resolve))
  const window = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:offline-test', contextIsolation: true, nodeIntegration: false, sandbox: true } })
  await window.loadURL('http://127.0.0.1:17820/')
  const result = await window.webContents.executeJavaScript(`(async () => {
    const store = await import('/services/offlineStore.js');
    const check = (condition, message) => { if (!condition) throw new Error(message) };
    if (${JSON.stringify(phase)} === 'write') {
      for (const op of await store.listOperations()) await store.writeLocal('operation:'+op.id, undefined);
      await store.writeLocal('queue-sequence', 0);
      await Promise.all(Array.from({length:40}, (_, index) => store.enqueueLocal({id:'test-'+index,createdAt:1,uid:'test-user',businessId:'biz',epoch:0}, {key:'snapshot-test',state:{value:index}})));
      const ops = await store.listOperations();
      check(ops.length === 40, 'Concurrent operations were lost');
      check(ops.every((op,index)=>op.id==='test-'+index), 'Operations lost FIFO order');
      await store.writeLocal('session-test',{uid:'test-user',businessId:'biz'});
      return '40 operaciones concurrentes guardadas en orden; sesión y estado persistidos.';
    }
    if (${JSON.stringify(phase)} === 'read') {
      check((await store.listOperations()).length===40,'Queue did not survive restart');
      check((await store.readLocal('session-test')).uid==='test-user','Session did not survive restart');
      check((await store.readLocal('snapshot-test')).value===39,'Atomic snapshot did not survive restart');
      return 'Sesión, cola y estado recuperados después de cerrar y reiniciar Electron.';
    }
    for (const op of await store.listOperations()) await store.writeLocal('operation:'+op.id,undefined);
    Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true});
    const sync = await import('/services/offlineSync.js');
    const {control}=await import('/config/firebase');
    sync.setSyncContext({businessId:'biz',epoch:0});
    await sync.queueOperation('applyBusinessMutation',{documentId:'one'});
    await sync.queueOperation('commitSale',{sale:{id:'sale1'}});
    check(control.calls.length===0,'Operations contacted server while offline');
    check((await store.listOperations()).length===2,'Offline operations were not durable');
    Object.defineProperty(navigator,'onLine',{get:()=>true,configurable:true});
    await sync.flushOperations();
    check(control.calls.length===2 && control.calls[0].payload.documentId==='one','Queue replay out of order');
    check((await store.listOperations()).length===0,'Acknowledged operations not removed');
    Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true});
    await sync.queueOperation('commitSale',{sale:{id:'oldSale'}});
    control.epoch=1;
    Object.defineProperty(navigator,'onLine',{get:()=>true,configurable:true});
    await sync.flushOperations();
    check(control.calls.length===2,'Stale sale uploaded after reset');
    check((await store.listOperations()).length===1,'Stale operation was silently lost');
    sync.setSyncContext({businessId:'biz',epoch:1});
    await sync.flushOperations();
    check((await store.listOperations())[0].error.includes('Archivada'),'Stale operation was not archived');
    control.failure={code:'functions/failed-precondition',message:'Stock insuficiente'};
    await sync.queueOperation('commitSale',{sale:{id:'conflict'}});
    await sync.flushOperations();
    check((await store.listOperations()).some(op=>op.error==='Stock insuficiente'),'Rejected sale was lost');
    for (const op of await store.listOperations()) await store.writeLocal('operation:'+op.id,undefined);
    Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true});
    control.failure=null;
    let prevented=false;
    try { await sync.queueOperation('applyBusinessMutation',{collection:'liquids',action:'update',data:{activeSaldo:30}}) } catch { prevented=true }
    check(prevented && (await store.listOperations()).length===0,'New direct liquid mutation was queued');
    const legacy={id:'legacy-recovery-test',name:'applyBusinessMutation',businessId:'biz',uid:'test-user',epoch:1,createdAt:Date.now(),payload:{collection:'liquids',documentId:'mango',action:'update',data:{activeSaldo:30}},error:'Usa los movimientos de líquidos para cambiar el saldo. [403]'};
    await store.enqueueLocal(legacy);
    await sync.queueOperation('commitSale',{sale:{id:'after-legacy'}});
    Object.defineProperty(navigator,'onLine',{get:()=>true,configurable:true});
    const before=control.calls.length;
    await sync.separateRejectedLiquid(legacy.id);
    check(control.calls.length===before+1 && control.calls.at(-1).name==='commitSale','Valid operation after conflict did not upload');
    check((await store.listOperations()).length===0,'Recovered queue still blocked');
    const archived=(await store.listReviewOperations()).find(op=>op.id===legacy.id);
    check(archived.payload.data.activeSaldo===30 && archived.reviewRequired,'Rejected balance was not preserved for review');
    Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true});
    control.missingLiquid='deleted-liquid';
    const missing={...legacy,id:'missing-recovery-test',payload:{collection:'liquids',documentId:'deleted-liquid',action:'update',data:{activeSaldo:95}},error:'El registro ya no existe. [404]'};
    await store.enqueueLocal(missing);
    await sync.queueOperation('applyBusinessMutation',{collection:'customers',documentId:'customer',action:'update',data:{totalSpent:500}});
    await sync.queueOperation('applyBusinessMutation',{collection:'liquids',documentId:'deleted-liquid',action:'delete'});
    await sync.queueOperation('applyBusinessMutation',{collection:'liquids',documentId:'replacement-liquid',action:'set',data:{name:'Uva helada',activeSaldo:0}});
    await sync.queueOperation('openLiquidBottle',{liquidId:'replacement-liquid'});
    const recoveryStart=control.calls.length;
    Object.defineProperty(navigator,'onLine',{get:()=>true,configurable:true});
    await sync.flushOperations();
    check((await store.listOperations()).length===0,'Missing liquid still blocks ordered synchronization');
    const recovered=(await store.listReviewOperations()).find(op=>op.id===missing.id);
    check(recovered.payload.data.activeSaldo===95 && recovered.recoveryReason,'Missing liquid payload was lost');
    const recoveredCalls=control.calls.slice(recoveryStart);
    check(recoveredCalls.length===5 && recoveredCalls[2].payload.action==='delete' && recoveredCalls[3].payload.action==='set' && recoveredCalls[4].name==='openLiquidBottle','Delete/create/open order changed');
    check(!recoveredCalls.some(call=>call.payload.documentId==='deleted-liquid' && call.payload.action==='set'),'Deleted liquid was recreated');
    await sync.flushOperations();
    check(control.calls.length===recoveryStart+5,'Successful operations replayed twice');
    return 'Cola sin conexión, envío ordenado, rechazo tras restauración y conservación de conflictos verificados.';
  })()`)
  console.log(`PASS ${phase}: ${result}`)
  window.destroy()
  server.close()
  app.quit()
}).catch(error => {
  console.error(error)
  server.close()
  app.exit(1)
})
