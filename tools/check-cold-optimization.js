const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),tests=[];
const source=()=>({registry:fs.readFileSync(path.join(repo,'SeriesRegistry.js'),'utf8'),web:fs.readFileSync(path.join(repo,'Webアプリ.js'),'utf8')});
function context(after,encoder=text=>Buffer.byteLength(text,'utf8')){
 const blobCalls=[]; const x=vm.createContext({console:{log(){},error(){},warn(){}},Utilities:{newBlob:text=>{blobCalls.push(String(text));return{getBytes:()=>Array(encoder(String(text))).fill(0)};}},Date});
 vm.runInContext(fs.readFileSync(path.join(repo,'config.js'),'utf8'),x);const s=source(after);vm.runInContext(s.registry,x);vm.runInContext(s.web,x);if(!after)x.getUtf8ByteLength_=value=>x.Utilities.newBlob(String(value==null?'':value)).getBytes().length;return{x,blobCalls};
}
function test(name,fn){fn();tests.push({name,passed:true});}
function registryFixture(after){
 const {x,blobCalls}=context(after);let usageCalls=0,masterReads=0,aliasReads=0;
 const row=(id,name,key,status='ACTIVE')=>[id,name,'冒険','','','','','',''+status,'',key,'漫画',''];
 const masters=[row('series-1','Fixture Series','fixture'),row('series-2','Other Series','other'),row('merged','Merged','merged','MERGED'),row('dup','Duplicate','duplicate'),row('dup','Duplicate Again','duplicate-again')];
 const aliases=[['fixture','series-1'],['ambiguous','series-1'],['ambiguous','series-2'],['other','series-2'],['merged','merged'],['dangling','absent']];
 const sheet=(rows,isMaster)=>({getLastRow:()=>rows.length+1,getLastColumn:()=>isMaster?13:6,getMaxColumns:()=>isMaster?13:6,getRange:(r,c,n,w)=>({getDisplayValues:()=>{if(isMaster)masterReads++;else aliasReads++;return r===1?[vm.runInContext('SERIES_REGISTRY_CONFIG_.MASTER_HEADERS',x)]:rows.map(v=>Array.from({length:w},(_,i)=>v[c-1+i]||''));}})});
 const master=sheet(masters,true),alias=sheet(aliases,false);
 x.isSeriesRegistryV2Active_=()=>true;x.getLibrarySpreadsheet_=()=>({getSheetByName:name=>name==='series_master_v2'?master:alias});
 x.readSeriesRegistryCatalogUsage_=()=>{usageCalls++;return {complete:true,refsBySeriesId:new Map([['series-1',2]])};};
 return {x,blobCalls,get usageCalls(){return usageCalls;},get reads(){return{masterReads,aliasReads};}};
}
function datasetFixture(after,perf){
 const r=registryFixture(after),x=r.x;
 const book=(title,key,uuid)=>{const row=Array(20).fill('');row[0]=title;row[2]='著者';row[3]='出版社';row[6]='2020-03';row[12]=title;row[13]=uuid;row[14]='冒険';row[15]=key;return row;};
 x.loadMainBookData_=()=>[book('Fixture 1','fixture','book-1'),book('Fixture 2','fixture','book-2'),book('Unknown 1','unregistered','book-3'),book('Ambiguous 1','ambiguous','book-4'),book('Other 1','other','book-5')];
 x.getGenreMasterData_=()=>({genreToCategory:{'冒険':'ストーリー','漫画':'媒体'},options:{story:['冒険'],theme:[],mood:[],status:[],media:['漫画']}});x.getPublisherOptions_=()=>['出版社'];
 x.parseBookContributors_=a=>[String(a)];x.normalizeKana=s=>String(s);x.normalizeBookUuid_=s=>String(s);x.isValidBookUuid_=s=>/^book-/.test(s);
 x.loadSeriesOrderValues_=()=>[[],['','ignored title','series-1',''],['','ignored title','book-2','1'],['','ignored title','book-1','2']];
 const dataset=x.buildLibraryDataset_(perf);return{...r,dataset:JSON.parse(JSON.stringify(dataset)),usageCalls:r.usageCalls};
}
test('well formed UTF8 boundaries and coercion equal standard encoder without Blob calls',()=>{
 const a=context(true); for(const value of [null,undefined,'',0,false,'\0\x7f\x80\u07ff\u0800\ud7ff\ue000\uffff','日本語😈𝄞𐀀\u{10ffff}','e\u0301\r\n'])assert.equal(a.x.getUtf8ByteLength_(value),Buffer.byteLength(String(value==null?'':value),'utf8')); assert.equal(a.blobCalls.length,0);
});
test('all Unicode scalar values match UTF8 encoder in bounded batches',()=>{
 const a=context(true);for(let start=0;start<=0x10ffff;start+=4096){let text='';for(let cp=start;cp<Math.min(start+4096,0x110000);cp++)if(cp<0xd800||cp>0xdfff)text+=String.fromCodePoint(cp);assert.equal(a.x.getUtf8ByteLength_(text),Buffer.byteLength(text,'utf8'));}assert.equal(a.blobCalls.length,0);
});
test('malformed UTF16 preserves exact original whole-string Blob behavior under different encoders',()=>{
 for(const encoder of [s=>Buffer.byteLength(s,'utf8'),s=>Buffer.byteLength(s.replace(/[\ud800-\udfff]/g,'?'),'utf8')])for(const value of ['\ud800','\udc00','a\ud800z','a\udc00z','\ud800\ud800','😀\udc00']){const a=context(true,encoder),b=context(false,encoder);assert.equal(a.x.getUtf8ByteLength_(value),b.x.getUtf8ByteLength_(value));assert.deepEqual(a.blobCalls,[value]);}
});
test('surrogate pairs stay intact at byte boundaries and split output remains identical',()=>{
 const a=context(true),b=context(false);for(const value of ['a😀b日本語','\u{10ffff}😀a','a\ud800b','a\udc00😀z'])for(let limit=1;limit<=16;limit++){
 let old,newer,e1,e2;try{old=b.x.splitUtf8ByByteLimit_(value,limit);}catch(e){e1=e.message;}try{newer=a.x.splitUtf8ByByteLimit_(value,limit);}catch(e){e2=e.message;}assert.equal(e1,e2);if(!e1){assert.equal(JSON.stringify(newer),JSON.stringify(old));assert.equal(newer.join(''),value);for(const chunk of newer)assert(Buffer.byteLength(chunk,'utf8')<=limit);}
 }
});
test('deterministic mixed codepoint and malformed fuzz preserves split and byte lengths',()=>{
 let seed=42;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};const a=context(true),b=context(false);for(let i=0;i<400;i++){let text='';for(let j=0;j<50;j++){const cp=rand()%0x110000;text+=String.fromCodePoint(cp);}assert.equal(a.x.getUtf8ByteLength_(text),b.x.getUtf8ByteLength_(text));const limit=4+rand()%100;assert.equal(JSON.stringify(a.x.splitUtf8ByByteLimit_(text,limit)),JSON.stringify(b.x.splitUtf8ByByteLimit_(text,limit)));}
});
test('6MB cache-like JSON retains exact chunks metadata and uses no Blob conversion',()=>{
 const text=JSON.stringify({rows:Array(40000).fill(['日本語😈','a'.repeat(100),'\ud800'])});const a=context(true),b=context(false);const ac=a.x.splitUtf8ByByteLimit_(text,81920),bc=b.x.splitUtf8ByByteLimit_(text,81920);assert.equal(JSON.stringify(ac),JSON.stringify(bc));assert.equal(a.x.getUtf8ByteLength_(text),b.x.getUtf8ByteLength_(text));for(let i=0;i<ac.length;i++)assert.equal(a.x.getUtf8ByteLength_(ac[i]),b.x.getUtf8ByteLength_(bc[i]));assert.equal(a.blobCalls.length,0);
});
test('default and explicit true registry lookup retain catalog write-validation usage',()=>{
 for(const flag of [undefined,true]){const a=registryFixture(true);const lookup=a.x.loadSeriesRegistryLookup_(undefined,flag);assert.equal(a.usageCalls,1);assert(lookup.catalogUsage.complete);assert.equal(lookup.catalogUsage.refsBySeriesId.get('series-1'),2);}
});
test('web registry opt-out removes only catalog scan and retains resolution ambiguity safety',()=>{
 const a=registryFixture(true),perf={};const lookup=a.x.loadSeriesRegistryLookup_(perf,false);assert.equal(a.usageCalls,0);assert(!('catalogUsage'in lookup));assert.equal(a.x.resolveSeriesRegistryKey_('fixture',lookup).seriesId,'series-1');assert.equal(a.x.resolveSeriesRegistryKey_('ambiguous',lookup),null);assert.equal(a.x.resolveSeriesRegistryKey_('dangling',lookup),null);assert.equal(a.x.resolveSeriesRegistryKey_('unregistered',lookup),null);assert.equal(perf.seriesCatalogUsageMs,0);assert.equal(perf.seriesCatalogLastRowMs,0);assert.equal(perf.seriesCatalogColumnsMs,0);assert(a.reads.masterReads>0&&a.reads.aliasReads>0);
});
test('web dataset retains registry metadata unregistered aliases media and immutable order',()=>{
 const after=datasetFixture(true);assert.equal(after.usageCalls,0);assert.equal(after.dataset.rows.length,5);assert.equal(after.dataset.index[0].seriesKeyAuto,'series-1');assert.equal(after.dataset.index[0].seriesSearchTitle,'Fixture Series');assert.equal(after.dataset.index[0].seriesCount,2);assert.equal(after.dataset.index[0].seriesOrder,2);assert.equal(after.dataset.index[1].seriesOrder,1);assert.equal(after.dataset.index[2].seriesKeyAuto,'unregistered');assert.equal(after.dataset.index[3].seriesKeyAuto,'ambiguous');assert(after.dataset.index[0].genres.media.includes('漫画'));
});
test('opt-in dataset retains lookup and skipped catalog stage fields without payload changes',()=>{
 const perf={},a=datasetFixture(true,perf),b=datasetFixture(true);assert.equal(JSON.stringify(a.dataset),JSON.stringify(b.dataset));for(const key of ['seriesRegistryLookupMs','seriesCatalogUsageMs','seriesCatalogLastRowMs','seriesCatalogColumnsMs'])assert(Number.isFinite(perf[key]));assert.equal(perf.seriesCatalogUsageMs,0);
});
test('skip preserves existing accumulated perf fields and catalog default exceptions',()=>{
 const a=registryFixture(true),perf={seriesCatalogUsageMs:12,seriesCatalogLastRowMs:3,seriesCatalogColumnsMs:4};a.x.loadSeriesRegistryLookup_(perf,false);assert.equal(perf.seriesCatalogUsageMs,12);a.x.readSeriesRegistryCatalogUsage_=()=>{throw Error('fixture failure');};assert.throws(()=>a.x.loadSeriesRegistryLookup_(),/fixture failure/);assert.doesNotThrow(()=>a.x.loadSeriesRegistryLookup_(undefined,false));
});
console.log(JSON.stringify({passed:tests.length,testCount:tests.length,scope:'cold optimization regression checks'}));
