const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const vm=require('node:vm');
function load(relative,globals={},stubs={}){
  const file=path.resolve(__dirname,'../src',relative);
  const result={exports:{}};
  const requireLocal=name=>{
    if(Object.hasOwn(stubs,name))return stubs[name];
    if(name.startsWith('@/'))return load(name.slice(2)+'.ts',globals,stubs);
    return require(name);
  };
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{module:result,exports:result.exports,require:requireLocal,console,crypto:require('node:crypto').webcrypto,...globals},{filename:file});
  return result.exports;
}
module.exports={load};
