from pathlib import Path
import tarfile,json,hashlib,re
root=Path('/Users/boxser.shi/Documents/harness/desktop-canvas-plugin');stage=Path('/private/tmp/canvas-agent-task-1-4-3')
pack=json.loads((stage/'npm-pack.json').read_text())[0];archive=stage/'package'/pack['filename'];manifest=json.loads((root/'canvas-app/dist/canvas-service-manifest.json').read_text())
with tarfile.open(archive,'r:gz') as tar:
 actual=json.loads(tar.extractfile('package/canvas-app/dist/canvas-service-manifest.json').read());assert actual==manifest
 for name in manifest['staticChunks']:
  payload=tar.extractfile('package/canvas-app/dist/'+name).read();assert hashlib.sha256(payload).digest()==hashlib.sha256((root/'canvas-app/dist'/name).read_bytes()).digest(),name
 client=tar.extractfile('package/lib/client.js').read().decode()
 assert '__INSIGHT_CANVAS_RUNTIME_V1__' in client and '/desktop-canvas/canvas-service.js' in client
 normalized=re.sub(r'/\*.*?\*/','',client,flags=re.S);assert re.search(r'loadServiceModule\s*=\s*\(url\)\s*=>\s*import\(\s*url\s*\)',normalized)
 (stage/'packed-client.js').write_text(client)
result={'status':'passed','filename':pack['filename'],'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'archive_bytes':archive.stat().st_size,'entry':manifest['entry'],'staticChunks':manifest['staticChunks'],'client_runtime_loader_present':True,'native_dynamic_import_preserved':True,'archive_matches_final_build':True,'installed_to_user_profile':False}
(stage/'package-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
