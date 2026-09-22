import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir,readFile } from 'node:fs/promises';
import { replay } from '../src/runtime/diagnostics.mjs';
const directory=new URL('./fixtures/captured/',import.meta.url);
for(const name of (await readdir(directory)).filter(x=>x.endsWith('.json'))){
  test('captured official Game 2.058: '+name,async()=>{
    const snapshot=JSON.parse(await readFile(new URL(name,directory),'utf8'));
    assert.equal((await replay(snapshot)).matches,true);
    assert.equal(snapshot.receipt.status,'confirmed');
  });
}
