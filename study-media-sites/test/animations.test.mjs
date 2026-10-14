import test from 'node:test';
import assert from 'node:assert/strict';
import {modelState} from '../public/learning-animations.mjs';
test('fraction parts remain within one whole when denominator falls',()=>{assert.deepEqual(modelState('fractions',[9,4]),{values:[4,4],ratio:1});assert.equal(modelState('fractions',[0,0]).ratio,0);});
test('force model follows F=ma and distance from rest',()=>{const s=modelState('forces',[6,2],2);assert.equal(s.acceleration,3);assert.equal(s.distance,6);assert.equal(modelState('forces',[6,4],2).distance,3);assert.equal(modelState('forces',[0,2],3).distance,0);});
test('mean reacts to an outlying value with equal weights',()=>{assert.equal(modelState('mean',[2,4,6]).mean,4);assert.equal(modelState('mean',[2,4,9]).mean,5);});
test('invalid controls are bounded and cell index remains valid',()=>{assert.deepEqual(modelState('cells',[99]).values,[2]);assert.equal(modelState('forces',[NaN,0]).acceleration,6);assert.throws(()=>modelState('unknown',[]));});
