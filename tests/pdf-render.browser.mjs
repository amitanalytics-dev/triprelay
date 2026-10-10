// Optional rendered-PDF check. Run after quotes.browser.cjs; set
// PDFJS_MODULE_PATH to the installed pdfjs-dist/legacy/build/pdf.mjs file.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {renderQuotePdf} from '../lib/quotePdf.mjs';
const require=createRequire(import.meta.url);
const modulePath=process.env.PDFJS_MODULE_PATH || require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
const {getDocument}=await import(pathToFileURL(modulePath).href);
fs.mkdirSync('tmp/quote-browser',{recursive:true});
const bytes=await renderQuotePdf({ready:true,quoteVersionId:'SAMPLE-VERSION',option:'balanced',quote:{
  branding:{businessName:'Test agency — Việt Nam SAMPLE',contactName:'Test',contactEmail:'test@triprelay.invalid',contactPhone:'0000000000'},
  prices:{currency:'INR',finalClientPriceMinor:12100,pricesCheckedAt:Date.now()-1000,validUntil:Date.now()+60000,items:[{description:'SAMPLE hotel',finalClientPriceMinor:12100}]},
  days:Array.from({length:7},(_,i)=>({date:'2026-11-'+String(i+9).padStart(2,'0'),title:'SAMPLE day '+(i+1),activities:['Sample itinerary details for pagination. '.repeat(8),'Sample meal and transfer plan. '.repeat(8)]})),
  inclusions:['Sample stay'],exclusions:['Visa services'],cancellationTerms:['Sample cancellation terms. '.repeat(12)]}});
fs.writeFileSync('tmp/quote-browser/long-sample-quote.pdf',bytes);
for(const input of ['sample-reviewed-quote.pdf','sample-logo-quote.pdf','long-sample-quote.pdf']){
  const task=getDocument({data:new Uint8Array(fs.readFileSync(path.join('tmp/quote-browser',input)))});
  const pdf=await task.promise;let text='';
  try{
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i);const content=await page.getTextContent();
      for(const item of content.items){
        if(!item.str)continue;text+=item.str+'\n';
        assert.ok(item.transform[4]>=43 && item.transform[4]+item.width<=553,'Text stays inside horizontal margins');
        assert.ok(item.transform[5]>=29 && item.transform[5]<=800,'Text stays inside vertical margins');
      }
      const viewport=page.getViewport({scale:1.5});const canvas=pdf.canvasFactory.create(viewport.width,viewport.height);
      await page.render({canvasContext:canvas.context,viewport}).promise;
      fs.writeFileSync(path.join('tmp/quote-browser',input+'-page-'+i+'.png'),canvas.canvas.toBuffer('image/png'));page.cleanup();
    }
    for(const required of ['GST included','INR 121.00','Cancellation terms','Test agency','Recheck required after','No booking'])assert.ok(text.includes(required),required);
    if(input.includes('long'))assert.ok(text.includes('Việt Nam'),'Vietnamese agency name survives PDF text encoding');
    for(const privateField of ['SYNTHETIC-PRIVATE-REFERENCE','supplierCostMinor','operatorSellingPriceMinor'])assert.equal(text.includes(privateField),false);
    console.log('PASS: '+input+'; '+pdf.numPages+' pages rendered; terms and final prices present; private fields absent; text within margins.');
  }finally{await task.destroy();}
}
