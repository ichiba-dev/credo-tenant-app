import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function setup({ authorized = true, imageOk = true } = {}) {
  const events=[]; const documents=[]; const exports={};
  const repair = { id:17, property_name:"A", room_number:"1", photo_url:null,
    repair_photos:[{ photo_url:"fresh-signed", sort_order:1 }] };
  const imports = {
    "react": { useRef: value=>({current:value}), useState: value=>[value,()=>{}] },
    "react/jsx-runtime": { jsx:(type,props)=>({type,props}), jsxs:(type,props)=>({type,props}) },
    "./photo-actions": { refreshRepairPhotos: async id=>{ events.push(["authorize",id]); return authorized ? {ok:true,repair} : {ok:false}; } },
    "@/app/pdf/RepairReport": { default:"Report" },
    "@react-pdf/renderer": { pdf: document=>{ documents.push(document); return {toBlob:async()=>new Blob()}; } },
  };
  const source=ts.transpileModule(readFileSync(new URL("./repair-pdf-button.tsx",import.meta.url),"utf8"), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  vm.runInNewContext(source, { exports, Blob,
    require(name){ assert.ok(name in imports,name); return imports[name]; },
    fetch:async url=>{events.push(["fetch",url]);return {ok:imageOk,blob:async()=>new Blob()};},
    FileReader:class {readAsDataURL(){this.result="data:image/png;base64,IMAGE";this.onload();}},
    URL:{createObjectURL:()=>"blob:pdf",revokeObjectURL(){}},setTimeout(){},
    document:{createElement:()=>({click(){events.push(["download"]);}})},
  });
  return {click:exports.default({repairId:17}).props.children[0].props.onClick,events,documents};
}
test("PDF click obtains fresh URLs then embeds bytes in the unchanged report component",async()=>{
  const s=setup(); await s.click();
  assert.deepEqual(s.events,[["authorize",17],["fetch","fresh-signed"],["download"]]);
  assert.equal(s.documents[0].props.repair.repair_photos[0].photo_url,"data:image/png;base64,IMAGE");
});
test("authorization or image retrieval failure prevents PDF download",async()=>{
  for(const options of [{authorized:false},{imageOk:false}]){
    const s=setup(options);await s.click();assert.equal(s.documents.length,0);
    assert.ok(s.events.every(event=>event[0]!=="download"));
  }
});
