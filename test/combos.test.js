import test from 'node:test';
import assert from 'node:assert/strict';
import { canBuild, scoringCombos } from '../src/game/combos.js';

const c=(container,operation,kind='container-function')=>({container,operation,kind,label:`${container}.${operation}`});

test('Maybe Monad can be built from exact cards',()=>{
  const cards=['map','ap','pure','chain'].map(op=>c('Maybe',op));
  assert.equal(canBuild(cards,'Maybe',['map','ap','pure','chain']),true);
  assert.equal(scoringCombos(cards).find(x=>x.container==='Maybe'&&x.family==='base').name,'Monad');
});

test('operation wildcard fills matching operation',()=>{
  const cards=[c('Maybe','map'),c('Maybe','ap'),c('Maybe','pure'),{kind:'operation-wildcard',container:'*',operation:'chain',label:'*.chain'}];
  assert.equal(canBuild(cards,'Maybe',['map','ap','pure','chain']),true);
});

test('*.* fills any missing slot',()=>{
  const cards=[c('List','map'),c('List','reduce'),{kind:'wildcard',container:'*',operation:'*',label:'*.*'}];
  assert.equal(canBuild(cards,'List',['map','reduce','traverse']),true);
});
