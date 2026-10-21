"""Build an isolated single-file Android demo from the same TSX App and domain model.
Uses local TypeScript compiler and vendored React16 UMD strictly for offline preview.
Production Vite build uses React19 dependencies declared in package.json.
"""
from pathlib import Path
from subprocess import run, PIPE
import json,zipfile
R=Path(__file__).resolve().parents[1]
NODE='''const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); const fs=require('fs'); const input=fs.readFileSync(process.argv[1],'utf8'); const o=ts.transpileModule(input,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true},reportDiagnostics:true});if(o.diagnostics.length){console.error(o.diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('\\n'));process.exit(2)}process.stdout.write(o.outputText);'''
def transpile(name):
 p=run(['node','-e',NODE,str(R/'src'/name)],capture_output=True,text=True)
 if p.returncode: raise RuntimeError(p.stderr)
 return p.stdout
react_assets=Path('/mnt/data/TASO-NEXT-REBUILT-SOURCE.zip')
with zipfile.ZipFile(react_assets) as z:
 react=z.read('taso-next/assets/react.production.min.js').decode()
 reactdom=z.read('taso-next/assets/react-dom.production.min.js').decode()
js='''(function(){var packages={};function make(name,code){var module={exports:{}};var exports=module.exports;var require=function(id){if(id==='react')return window.React;if(id==='./domain')return packages.domain;throw new Error('Unknown module '+id)};new Function('module','exports','require',code)(module,exports,require);packages[name]=module.exports;}'''+ 'make("domain",'+json.dumps(transpile('domain.ts'))+');make("App",'+json.dumps(transpile('App.tsx'))+');ReactDOM.render(React.createElement(packages.App.default),document.getElementById("root"));})();'
css=(R/'src/style.css').read_text()
html='<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>TASO NEXT | REBUILD LAB (OFFLINE DEMO)</title><style>'+css+'</style><div id="root"></div><script>'+react+'</script><script>'+reactdom+'</script><script>'+js+'</script>'
(R/'TASO-NEXT-LAB-ANDROID.html').write_text(html,encoding='utf8')
print('Created',R/'TASO-NEXT-LAB-ANDROID.html','bytes',len(html.encode()))