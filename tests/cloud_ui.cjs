const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const pause=()=>new Promise(r=>setTimeout(r,5));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await pause();}throw new Error('UI state did not settle');}
class Element {
  constructor(){this.listeners={};this.dataset={};this.value='';this.textContent='';this.hidden=false;this.disabled=false;}
  addEventListener(name,fn){this.listeners[name]=fn;}
  fire(name){return this.listeners[name]?.({preventDefault(){}});}
  showModal(){this.open=true;}close(){this.open=false;}
}
async function run(){
  const ids=[...fs.readFileSync(`${__dirname}/../docs/index.html`,'utf8').matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  let authCallback,account=null,activeStore=null,localUsed=0,imports=0,exports=0,syncs=0,remoteFn;
  const states=new Map(), email='reader@example.test',password='test-only-password';
  const client={auth:{onAuthStateChange(fn){authCallback=fn;return {};},async getSession(){return {data:{session:account}};},
    async signInWithPassword(input){assert.equal(input.email,email);assert.equal(input.password,password);account={user:{id:'one',email}};authCallback('SIGNED_IN',account);return {data:{session:account}};},
    async signOut(){account=null;authCallback('SIGNED_OUT',null);return {};}}};
  const context={URL,console,setTimeout,clearTimeout,setInterval:()=>0,addEventListener(){},confirm:()=>true,
    document:{getElementById:id=>elements[id],addEventListener(){},visibilityState:'visible'},
    PaperCloudConfig:{url:'https://example.supabase.co',publishableKey:'public-test-key'},supabase:{createClient:()=>client},
    CloudStore:{async open({userId,onStatus}){
      const s=states.get(userId)||{papers:[],analysis_settings:{},sync:null};states.set(userId,s);
      return {async read(){return s;},async status(){return {papers:s.papers.length,works:0};},
        async initialize(){s.sync={initialized:true,queue:[]};},async sync(){syncs++;onStatus({state:'synced',revision:syncs});},
        async analysis(){return {items:[]};},async resolve(choice,backup){if(choice==='local')await backup(s);},close(){}};
    }} };
  vm.createContext(context);vm.runInContext(fs.readFileSync(`${__dirname}/../docs/cloud-ui.js`,'utf8'),context);
  await context.CloudUI.init({normalizePaper:p=>p,localSnapshot:async()=>({papers:[{id:'private-local'}],analysis_settings:{}}),
    async useStore(s){activeStore=s;},async useLocal(){activeStore=null;localUsed++;},async importLocal(){imports++;},
    async exportCurrent(){exports++;},async exportSnapshot(){exports++;},setRemoteAnalysis:fn=>remoteFn=fn});
  await until(()=>elements.cloudMessage.textContent.includes('当前使用'));
  assert.equal(imports,0);
  elements.cloudEmail.value=email;elements.cloudPassword.value=password;elements.cloudLoginForm.fire('submit');
  await until(()=>elements.cloudMessage.textContent.includes('本地 1 篇'));
  assert.equal(elements.cloudPassword.value,'','Password field is cleared after login');
  assert.equal(activeStore,null,'Signing in previews counts before enabling/uploading');
  assert.equal(imports,0);
  elements.cloudMigrate.fire('click');await until(()=>elements.cloudButton.textContent==='已同步');
  assert.equal(imports,1);assert.ok(activeStore);assert.ok(await remoteFn({}));
  elements.cloudLogout.fire('click');await until(()=>elements.cloudMessage.textContent.includes('当前使用'));
  assert.equal(localUsed,1);assert.equal(activeStore,null);assert.equal(await remoteFn({}),null);
  // Reopening a previously initialized account resumes it without reimporting local papers.
  elements.cloudPassword.value=password;elements.cloudLoginForm.fire('submit');
  await until(()=>elements.cloudButton.textContent==='已同步');assert.equal(imports,1);
  elements.cloudKeepLocal.fire('click');await until(()=>exports===2);
  console.log('Cloud UI: login/password clearing, migration preview, opt-in import, logout, cached account resume and conflict backups passed.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
