import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { jostBase64 } from './fonts/jost.mjs';
import { notoBase64 } from './fonts/noto.mjs';

// Only pass the authenticated, approved final-price projection to this renderer.
// It explicitly selects visible fields; private supplier objects are never used.
export async function renderQuotePdf(result, { logoBytes, logoType } = {}) {
  if (!result?.ready || !result.quote || result.quote.prices.validUntil <= Date.now()) {
    throw new Error('This quote needs fresh supplier checks and review before download.');
  }
  const q = result.quote;
  if (q.prices.currency !== 'INR' || !Number.isSafeInteger(q.prices.finalClientPriceMinor)) throw new Error('Quote prices need checking.');
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const jost = await doc.embedFont(jostBase64, { subset: true });
  const noto = await doc.embedFont(notoBase64, { subset: true });
  const jostCharacters = new Set(jost.getCharacterSet());
  const notoCharacters = new Set(noto.getCharacterSet());
  let font = jost;
  const ink = rgb(.03,.05,.04), teal = rgb(.05,.43,.39), cream = rgb(.98,.97,.95);
  const width = 595.28, height = 841.89, margin = 44, usable = width - margin * 2;
  let page, y;
  const addPage = () => {
    page = doc.addPage([width,height]);
    page.drawRectangle({x:0,y:0,width,height,color:cream});
    y = height - margin;
  };
  addPage();
  const line = (text, size = 11, color = ink) => {
    text = String(text).replace(/[\r\n\t]+/g,' ').trim();
    if (!text) return;
    const characters = [...text].map(char => char.codePointAt(0));
    font = characters.every(code => jostCharacters.has(code)) ? jost : noto;
    if (characters.some(code => !notoCharacters.has(code) && !jostCharacters.has(code))) throw new Error('A quote character cannot be rendered. Check the agency details and quote wording.');
    let chunk = '';
    for (const word of text.split(/\s+/)) {
      const joined = chunk ? chunk + ' ' + word : word;
      if (font.widthOfTextAtSize(joined,size) <= usable) { chunk = joined; continue; }
      if (chunk) { draw(chunk,size,color); chunk = ''; }
      for (const char of word) {
        if (chunk && font.widthOfTextAtSize(chunk+char,size)>usable) { draw(chunk,size,color); chunk=''; }
        chunk += char;
      }
    }
    if (chunk) draw(chunk.trimEnd(), size, color);
  };
  const draw = (text,size,color) => {
    if (y - size * 1.5 < 58) addPage();
    page.drawText(text,{x:margin,y:y-size,font,size,color});
    y -= size * 1.5;
  };
  const heading = text => { if (y < 115) addPage(); y -= 12; line(text,16,teal); y -= 4; };
  if (logoBytes) {
    const image = logoType === 'image/jpeg' ? await doc.embedJpg(logoBytes) : await doc.embedPng(logoBytes);
    if (image.width > 10000 || image.height > 10000) throw new Error('The agency logo is too large to render.');
    const size = image.scale(Math.min(120 / image.width, 55 / image.height));
    page.drawImage(image,{x:margin,y:y-size.height,width:size.width,height:size.height});
    y -= size.height + 14;
  }
  line(q.branding.businessName,24,teal);
  line(result.option === 'lowest' ? 'Lowest-price option - reviewed quote' : 'Balanced option - reviewed quote',12);
  line('Quote version: '+result.quoteVersionId,9);
  if(q.comparisonChoice){const choice=q.comparisonChoice;line(choice.startDate+' to '+choice.endDate+' | '+choice.hotelTier+' | '+choice.transport+' transport',11);
    line(choice.adults+' adults | '+choice.rooms.length+' rooms | '+choice.meals.join(', '),11);}
  heading('Final client total - GST included');
  const money = amount => {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Quote prices need checking.');
    return 'INR '+(amount / 100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  };
  line(money(q.prices.finalClientPriceMinor),24,teal);
  const time = value => new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(value)+' IST';
  line('Prices checked: '+time(q.prices.pricesCheckedAt),10);
  line('Recheck required after: '+time(q.prices.validUntil),10);
  heading('Included trip prices');
  for (const item of q.prices.items) line(item.description+' - '+money(item.finalClientPriceMinor));
  heading('Day-by-day plan');
  for (const day of q.days) {
    line(day.date+' - '+day.title,12,teal);
    for (const activity of day.activities) line('- '+activity);
    y -= 7;
  }
  for (const [title, items] of [['Inclusions',q.inclusions],['Exclusions',q.exclusions],['Cancellation terms',q.cancellationTerms]]) {
    heading(title); for (const item of items) line('- '+item);
  }
  heading('Your agency');
  line(q.branding.contactName);
  line(q.branding.contactEmail+' | '+q.branding.contactPhone);
  heading('Price and availability');
  line('Prices and availability require rechecking after the stated time. No booking has been made. Payment, booking and visa services are outside this quote service.');
  for (const [index, p] of doc.getPages().entries()) {
    p.drawText('Reviewed quote | '+(index+1)+' / '+doc.getPageCount(),{x:margin,y:30,font:jost,size:9,color:teal});
  }
  if (q.prices.validUntil <= Date.now()) throw new Error('The price-check period ended while preparing the PDF. Recheck this quote.');
  doc.setTitle(q.branding.businessName+' - reviewed trip quote');
  doc.setAuthor(q.branding.businessName);
  doc.setSubject('Final client prices, itinerary and cancellation terms');
  return doc.save();
}
