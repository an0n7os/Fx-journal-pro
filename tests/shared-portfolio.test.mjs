import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
const {sharedPortfolio,sharedBalanceCurve}=await tsImport('../src/lib/sharedPortfolio.ts',import.meta.url);
test('screenshot figures reconcile: 500 capital, 3445.94 P/L, 3945.94 balance, 689.19% growth',()=>{
 const account={name:'wdd',currency:'USD',startingBalance:500,currentBalance:3945.94,password:'must not be shared',login:123};
 const summary=sharedPortfolio(account);
 assert.equal(summary.startingCapital,500);assert.equal(summary.currentBalance,3945.94);
 assert.equal(summary.netProfit,3445.94);assert.equal(summary.growthPercent,689.19);
 assert.equal(summary.password,undefined);assert.equal(summary.login,undefined);
 const curve=sharedBalanceCurve([{date:'2026-10-01',profit:3455.94,commission:-10,swap:0}],500);
 assert.equal(curve[0].equity,500);assert.equal(curve.at(-1).equity,3945.94);
});
test('filtered balance curve carries prior P/L and cashflows into opening capital',()=>{
 const rows=[{date:'2026-01-01',profit:100,commission:-2},{date:'2026-02-01',type:'Deposit',profit:200},{date:'2026-10-01',profit:-50,swap:-1}];
 const curve=sharedBalanceCurve(rows,500,new Date('2026-09-01').getTime());
 assert.equal(curve[0].equity,798);assert.equal(curve.at(-1).equity,747);
});
test('missing account is not invented and zero starting capital has no fabricated growth',()=>{
 assert.equal(sharedPortfolio(null),null);
 assert.equal(sharedPortfolio({startingBalance:0,currentBalance:20}).growthPercent,null);
 assert.equal(sharedPortfolio({}).currentBalance,null);
});
