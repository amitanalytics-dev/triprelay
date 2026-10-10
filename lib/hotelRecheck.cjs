'use strict';
// A recheck result is still private, unverified source evidence. It never
// authorizes NET/GST treatment, freshness deadlines or human review.
function matchHotelRecheck(selected,result){
  if(!selected || !result || !Array.isArray(result.rates) || !Number.isSafeInteger(result.checkedAt) || result.checkedAt<0 ||
    ![true,false,null].includes(result.rateChanged) || result.source!=='TBO')throw Error('Hotel recheck evidence is incomplete.');
  const matches=result.rates.filter(rate=>rate.hotelCode===selected.hotelCode && rate.bookingCode===selected.bookingCode &&
    JSON.stringify(rate.roomNames)===JSON.stringify(selected.roomNames));
  if(matches.length!==1)throw Error('The recheck must identify exactly the selected complete bookable unit.');
  const rate=matches[0];
  if(!Number.isFinite(rate.supplierTotal) || rate.supplierTotal<0 || !/^[A-Z]{3}$/.test(rate.currency))throw Error('The selected recheck needs valid reported price facts.');
  return {source:'TBO',checkedAt:result.checkedAt,selectedRate:rate,supplierReportedRateChanged:result.rateChanged,
    priceChanged:selected.supplierTotal!==rate.supplierTotal || selected.currency!==rate.currency,
    detailsChanged:JSON.stringify(selected)!==JSON.stringify(rate),quoteReady:false};
}
module.exports={matchHotelRecheck};
