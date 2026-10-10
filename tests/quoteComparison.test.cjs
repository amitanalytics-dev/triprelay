const test=require('node:test');
const assert=require('node:assert/strict');
const {compareReviewedChoices}=require('../lib/quoteComparison.cjs');
const ids=Array.from({length:16},(_,i)=>`choice-${i}`);
const rows=()=>ids.map((optionId,i)=>({optionId,ready:true,currency:'INR',agentMarkupBps:1000,
  finalClientPriceMinor:10000+i,validUntil:2000000000000-i,supplierReference:'PRIVATE'}));
test('all 16 reviewed alternatives compare final prices, retain ties and earliest expiry without private fields',()=>{
  const data=rows();data[0].finalClientPriceMinor=10005;data[1].finalClientPriceMinor=10005;
  const result=compareReviewedChoices(ids,data.reverse(),1800000000000);
  assert.deepEqual(result.lowestOptionIds,['choice-2']);assert.equal(result.finalClientPriceMinor,10002);
  data.find(row=>row.optionId==='choice-3').finalClientPriceMinor=10002;
  assert.deepEqual(compareReviewedChoices(ids,data,1800000000000).lowestOptionIds,['choice-2','choice-3']);
  assert.equal(result.validUntil,1999999999985);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
test('missing, duplicate, unknown, stale/unapproved assessments and unequal markups never choose a winner',()=>{
  const variants=[rows().slice(1),[...rows(),rows()[0]],[],rows().map((r,i)=>i? r:{...r,optionId:'unknown'}),
    rows().map((r,i)=>i? r:{...r,optionId:ids[1]}),rows().map((r,i)=>i? r:{...r,ready:false}),
    rows().map((r,i)=>i? r:{...r,agentMarkupBps:2000})];
  for(const data of variants){const result=compareReviewedChoices(ids,data,1800000000000);assert.equal(result.complete,false);assert.deepEqual(result.lowestOptionIds,[]);assert.equal(result.finalClientPriceMinor,null);}
});
test('invalid currency, fractional/unsafe prices and malformed comparison scope fail closed',()=>{
  for(const patch of [{currency:'USD'},{finalClientPriceMinor:1.5},{finalClientPriceMinor:Number.MAX_SAFE_INTEGER+1},
    {finalClientPriceMinor:-1},{validUntil:NaN},{validUntil:1800000000000},{agentMarkupBps:-1}]){
    const data=rows();Object.assign(data[0],patch);assert.equal(compareReviewedChoices(ids,data,1800000000000).complete,false);
  }
  for(const scope of [[],[...ids,ids[0]],[''],Array.from({length:49},(_,i)=>`${i}`)])assert.equal(compareReviewedChoices(scope,rows(),1800000000000).complete,false);
});
