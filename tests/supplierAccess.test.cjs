const test=require('node:test'),assert=require('node:assert/strict');
test('supplier access command does not authenticate or search when settings are missing',async()=>{
  const {checkSupplierAccess}=await import('../scripts/check-supplier-access.mjs'),calls=[];
  const result=await checkSupplierAccess(async name=>{calls.push(name);return {hotels:{ready:false,missing:['TBO_PROXY_URL','TBO_USERNAME']},flights:{ready:false,missing:['TBO_PROXY_URL']}};});
  assert.deepEqual(calls,['tbo:connectionReadiness']);assert.equal(result.flights.authentication,'blocked');assert.equal(result.hotels.livePricingVerified,false);
});
test('configured flight access invokes only authentication and never counts it as verified prices',async()=>{
  const {checkSupplierAccess}=await import('../scripts/check-supplier-access.mjs'),calls=[];
  const result=await checkSupplierAccess(async name=>{calls.push(name);return name==='tbo:connectionReadiness'?{hotels:{ready:true,missing:[]},flights:{ready:true,missing:[]}}:{state:'authenticated',checkedAt:Date.now(),pricingVerified:false,token:'PRIVATE forbidden extra field'};});
  assert.deepEqual(calls,['tbo:connectionReadiness','tbo:verifyFlightAccess']);assert.equal(result.flights.authentication,'authenticated');assert.equal(result.flights.livePricingVerified,false);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
test('authentication failure and changed settings remain blocked, with only canonical setting names',async()=>{
  const {checkSupplierAccess}=await import('../scripts/check-supplier-access.mjs');
  for(const state of ['failed','blocked']){
    const result=await checkSupplierAccess(async name=>name==='tbo:connectionReadiness'?{hotels:{ready:true,missing:[]},flights:{ready:true,missing:[]}}:{state,missing:['PRIVATE address value','Valid TBO_PROXY_URL required'],pricingVerified:false});
    assert.equal(result.flights.authentication,state);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  }
});
