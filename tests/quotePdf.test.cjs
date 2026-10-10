const test=require('node:test');
const assert=require('node:assert/strict');
const {PDFDocument}=require('pdf-lib');
const {renderQuotePdf}=require('../lib/quotePdf.mjs');
function sample(){return {ready:true,quoteVersionId:'SAMPLE-VERSION',option:'balanced',quote:{
  branding:{businessName:'SAMPLE AGENCY – Việt Nam',contactName:'Test',contactEmail:'test@triprelay.invalid',contactPhone:'0000000000'},
  prices:{currency:'INR',finalClientPriceMinor:12100,pricesCheckedAt:Date.now()-1000,validUntil:Date.now()+60000,
    items:[{description:'SAMPLE hotel stay',finalClientPriceMinor:12100}]},
  days:[{date:'2026-11-09',title:'SAMPLE arrival',activities:['Sample transfer']}],
  inclusions:['Sample hotel'],exclusions:['Visa services'],cancellationTerms:['Sample terms - not a live offer']}};}
test('PDF renderer creates a readable branded document with a Unicode font and paginates long text',async()=>{
  const result=sample();
  result.quote.days=Array.from({length:30},(_,i)=>({date:'2026-11-'+String(i+1).padStart(2,'0'),title:'SAMPLE day '+(i+1),activities:['Long sample detail '.repeat(50)]}));
  const bytes=await renderQuotePdf(result);
  const pdf=await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount()>5);assert.match(pdf.getTitle(),/SAMPLE AGENCY/);
  assert.equal(pdf.getAuthor(),result.quote.branding.businessName);
});
test('PDF renderer blocks expired, unapproved and invalid final-price data',async()=>{
  const expired=sample();expired.quote.prices.validUntil=Date.now()-1;
  await assert.rejects(()=>renderQuotePdf(expired),/fresh supplier/);
  await assert.rejects(()=>renderQuotePdf({...sample(),ready:false}),/fresh supplier/);
  const invalid=sample();invalid.quote.prices.finalClientPriceMinor=NaN;
  await assert.rejects(()=>renderQuotePdf(invalid),/prices/);
});
