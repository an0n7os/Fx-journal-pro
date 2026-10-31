import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
const { selectSharedTrades } = await tsImport('../src/lib/sharedTradeScope.ts', import.meta.url);
test('shared scope rejects foreign, conflicting, unowned and wrong-portfolio rows', () => {
 const accounts=[{id:'a',userId:'owner'},{id:'b',userId:'owner'},{id:'foreign',userId:'viewer'}];
 const rows=[{id:'correct',userId:'owner',accountId:'a'}, {id:'otherportfolio',userId:'owner',accountId:'b'},
 {id:'foreign',userId:'viewer',accountId:'foreign'}, {id:'conflict',userId:'viewer',accountId:'a'},
 {id:'foreignaccount',userId:'owner',accountId:'foreign'}, {id:'legacy',accountId:'a'}, {id:'unowned'}];
 assert.deepEqual(selectSharedTrades(rows,accounts,'owner','a').map(t=>t.id),['correct','legacy']);
 assert.deepEqual(selectSharedTrades(rows,accounts,'owner').map(t=>t.id),['correct','otherportfolio','legacy']);
 assert.deepEqual(selectSharedTrades(rows,accounts,'viewer','a'),[]);
});
test('snake-case legacy rows obey the same ownership boundary', () => {
 assert.deepEqual(selectSharedTrades([{id:1,user_id:'owner',account_id:'a'}, {id:2,user_id:'other',account_id:'a'}], [{id:'a',user_id:'owner'}], 'owner','a').map(t=>t.id),[1]);
});
